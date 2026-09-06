/**
 * THE ONLY writer of module state, and the only place the rest of the codebase
 * reads it from.
 *
 * Reads go straight through settings.mjs, which normalizes. Writes go through the
 * relay: a GM applies directly, a player hands off to the designated GM. Nothing
 * above this file needs to know which of those happened.
 *
 * Entities are flat arrays joined by id — plots, nodes, forces, assets — with the
 * trees derived on read. That is the battle-decks decks/deckFolders pattern, and
 * it is why deletes here have to sweep references by hand: nothing else will.
 */

import { LIFECYCLE } from '../constants.mjs';
import * as S from '../settings.mjs';
import { registerOperations, requestWrite } from './relay.mjs';
import { buildExample } from './example-plot.mjs';
import {
    resolveMode, addToPool, tickClock, addForForce, concludeThread, reopenThread
} from '../logic/progress.mjs';
import { MODE } from '../constants.mjs';

// ── reads ────────────────────────────────────────────────────────────────────

/** One snapshot, already normalized. Every render should take exactly one of these. */
export function readBoard() {
    return {
        plots: S.getPlots(),
        nodes: S.getNodes(),
        forces: S.getForces(),
        assets: S.getAssets(),
        turn: S.getTurn()
    };
}

const bySort = (a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name);

export const plotById = (board, id) => board.plots.find((p) => p.id === id) ?? null;
export const forceById = (board, id) => board.forces.find((f) => f.id === id) ?? null;
export const nodeById = (board, id) => board.nodes.find((n) => n.id === id) ?? null;

/** Archived plots are excluded from the board entirely; a filter surfaces them. */
export const visiblePlots = (board, { includeArchived = false } = {}) =>
    board.plots
        .filter((p) => includeArchived || p.lifecycle !== LIFECYCLE.ARCHIVED)
        .sort(bySort);

export const nodesForPlot = (board, plotId) =>
    board.nodes.filter((n) => n.plotId === plotId).sort(bySort);

export const forcesForPlot = (board, plot) =>
    (plot?.forceIds ?? []).map((id) => forceById(board, id)).filter(Boolean).sort(bySort);

export const assetsForForce = (board, forceId) =>
    board.assets.filter((a) => a.forceId === forceId).sort(bySort);

/** Assets committed to one node — the ones whose modifiers actually apply. */
export const assetsForNode = (board, nodeId) =>
    board.assets.filter((a) => a.nodeId === nodeId).sort(bySort);

/** Only ACTIVE plots are paid by Advance Turn. Paused, resolved and archived sit it out. */
export const activePlots = (board) =>
    board.plots.filter((p) => p.lifecycle === LIFECYCLE.ACTIVE);

/** Every force engaged in at least one active plot, deduped. */
export function forcesOnActivePlots(board) {
    const ids = new Set(activePlots(board).flatMap((p) => p.forceIds));
    return board.forces.filter((f) => ids.has(f.id));
}

// ── write helpers ────────────────────────────────────────────────────────────

const nextSort = (rows) => (rows.length ? Math.max(...rows.map((r) => r.sort)) + 1 : 0);

/** Insert or replace by id. Returns the new array; never mutates the input. */
function upsertRow(rows, patch) {
    const id = patch.id ?? foundry.utils.randomID();
    const index = rows.findIndex((r) => r.id === id);
    if (index === -1) return [...rows, { ...patch, id, sort: patch.sort ?? nextSort(rows) }];
    const next = [...rows];
    next[index] = { ...next[index], ...patch, id };
    return next;
}

/** Replace rows sharing an id, append the rest. Order of existing rows is kept. */
function mergeById(rows, incoming) {
    const byId = new Map(incoming.map((r) => [r.id, r]));
    const merged = rows.map((r) => byId.get(r.id) ?? r);
    for (const r of incoming) if (!rows.some((x) => x.id === r.id)) merged.push(r);
    return merged;
}

// ── operations (GM side) ─────────────────────────────────────────────────────
// These run on a GM client only — either the caller is a GM, or the relay handed
// the payload to the designated GM. They are the only functions that call setters.

const operations = {
    async 'plot.upsert'({ patch }) {
        await S.setPlots(upsertRow(S.getPlots(), patch));
    },

    /** Deleting a plot takes its nodes with it and releases any asset committed to them. */
    async 'plot.delete'({ plotId }) {
        const doomedNodes = new Set(S.getNodes().filter((n) => n.plotId === plotId).map((n) => n.id));
        await S.setPlots(S.getPlots().filter((p) => p.id !== plotId));
        await S.setNodes(S.getNodes().filter((n) => n.plotId !== plotId));
        await S.setAssets(S.getAssets().map((a) => (
            a.plotId === plotId || doomedNodes.has(a.nodeId)
                ? { ...a, plotId: null, nodeId: null }
                : a
        )));
    },

    async 'node.upsert'({ patch }) {
        await S.setNodes(upsertRow(S.getNodes(), patch));
    },

    /** A deleted node must vanish from every prereq list and release its assets. */
    async 'node.delete'({ nodeId }) {
        await S.setNodes(
            S.getNodes()
                .filter((n) => n.id !== nodeId)
                .map((n) => (n.prereqNodeIds.includes(nodeId)
                    ? { ...n, prereqNodeIds: n.prereqNodeIds.filter((x) => x !== nodeId) }
                    : n))
        );
        await S.setPlots(S.getPlots().map((p) => ({
            ...p,
            phases: p.phases.map((ph) => ({
                ...ph,
                revealNodeIds: ph.revealNodeIds.filter((x) => x !== nodeId),
                lockNodeIds: ph.lockNodeIds.filter((x) => x !== nodeId)
            }))
        })));
        await S.setAssets(S.getAssets().map((a) => (
            a.nodeId === nodeId ? { ...a, nodeId: null } : a
        )));
    },

    async 'force.upsert'({ patch }) {
        await S.setForces(upsertRow(S.getForces(), patch));
    },

    /**
     * A deleted force leaves references in three places: plot rosters, node
     * outcomes and per-force progress, and its own assets. Sweep all of them or
     * the board renders phantom contenders.
     */
    async 'force.delete'({ forceId }) {
        await S.setForces(S.getForces().filter((f) => f.id !== forceId));
        await S.setPlots(S.getPlots().map((p) => ({
            ...p, forceIds: p.forceIds.filter((id) => id !== forceId)
        })));
        await S.setNodes(S.getNodes().map((n) => {
            const { [forceId]: _dropped, ...byForce } = n.progress.byForce;
            return {
                ...n,
                progress: { ...n.progress, byForce },
                outcomes: n.outcomes.filter((o) => o.forceId !== forceId),
                concludedBy: n.concludedBy === forceId ? null : n.concludedBy
            };
        }));
        await S.setAssets(S.getAssets().filter((a) => a.forceId !== forceId));
    },

    async 'asset.upsert'({ patch }) {
        await S.setAssets(upsertRow(S.getAssets(), patch));
    },

    async 'asset.delete'({ assetId }) {
        await S.setAssets(S.getAssets().filter((a) => a.id !== assetId));
    },

    /**
     * Push a Thread along. The mode decides which pile the amount lands in, and
     * logic/progress.mjs does the arithmetic — this only reads, routes and writes.
     */
    async 'node.advance'({ nodeId, forceId = null, amount = 1 }) {
        const nodes = S.getNodes();
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const plot = S.getPlots().find((p) => p.id === node.plotId) ?? null;
        const assets = S.getAssets().filter((a) => a.nodeId === nodeId);
        const mode = resolveMode(node, plot);

        let progress;
        if (mode === MODE.CLOCK) progress = tickClock(node, amount, assets);
        else if (mode === MODE.CONTESTED) {
            if (!forceId) return;               // contested spending must name a spender
            progress = addForForce(node, forceId, amount, assets);
        } else progress = addToPool(node, amount, assets);

        await S.setNodes(nodes.map((n) => (n.id === nodeId ? { ...n, progress } : n)));
    },

    /**
     * Conclude a Thread and move the Plot. Both writes happen here so a conclusion
     * can never land with the State change missing.
     */
    async 'node.conclude'({ nodeId, forceId = null }) {
        const nodes = S.getNodes();
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const plots = S.getPlots();
        const plot = plots.find((p) => p.id === node.plotId);
        if (!plot) return;

        const result = concludeThread(plot, node, forceId);
        await S.setNodes(nodes.map((n) => (n.id === nodeId
            ? { ...result.node, appliedDelta: result.delta }
            : n)));
        await S.setPlots(plots.map((p) => (p.id === plot.id
            ? { ...p, state: result.plotState }
            : p)));
    },

    /** Undo a conclusion, reversing the delta that was actually applied. */
    async 'node.reopen'({ nodeId }) {
        const nodes = S.getNodes();
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const plots = S.getPlots();
        const plot = plots.find((p) => p.id === node.plotId);
        if (!plot) return;

        const result = reopenThread(plot, node, node.appliedDelta);
        await S.setNodes(nodes.map((n) => (n.id === nodeId
            ? { ...result.node, appliedDelta: 0 }
            : n)));
        await S.setPlots(plots.map((p) => (p.id === plot.id
            ? { ...p, state: result.plotState }
            : p)));
    },

    async 'turn.set'({ count }) {
        await S.setTurn({ count });
    },

    /**
     * Builds the Help tab's example. Ids in the fixture are stable, so pressing
     * Generate twice overwrites the example in place rather than growing a second
     * copy of it — and never touches a hand-authored row.
     */
    async 'example.generate'() {
        const { plots, nodes, forces, assets } = buildExample();
        await S.setForces(mergeById(S.getForces(), forces));
        await S.setPlots(mergeById(S.getPlots(), plots));
        await S.setNodes(mergeById(S.getNodes(), nodes));
        await S.setAssets(mergeById(S.getAssets(), assets));
    },

    /**
     * Deletes exactly what the Help tab generated and nothing else. This is why
     * isExample is on every entity rather than tracked in a side list — a side
     * list can drift out of step with the data it points at.
     */
    async 'example.remove'() {
        await S.setPlots(S.getPlots().filter((p) => !p.isExample));
        await S.setNodes(S.getNodes().filter((n) => !n.isExample));
        await S.setForces(S.getForces().filter((f) => !f.isExample));
        await S.setAssets(S.getAssets().filter((a) => !a.isExample));
    }
};

registerOperations(operations);

// ── public write API ─────────────────────────────────────────────────────────
// Thin by design: every one of these is the same single line, so there is no
// second path a mutation could take.

const write = (op, payload) => requestWrite(op, payload);

export const upsertPlot = (patch) => write('plot.upsert', { patch });
export const deletePlot = (plotId) => write('plot.delete', { plotId });
export const upsertNode = (patch) => write('node.upsert', { patch });
export const deleteNode = (nodeId) => write('node.delete', { nodeId });
export const upsertForce = (patch) => write('force.upsert', { patch });
export const deleteForce = (forceId) => write('force.delete', { forceId });
export const upsertAsset = (patch) => write('asset.upsert', { patch });
export const deleteAsset = (assetId) => write('asset.delete', { assetId });
export const advanceNode = (nodeId, amount, forceId = null) =>
    write('node.advance', { nodeId, amount, forceId });
export const concludeNode = (nodeId, forceId = null) => write('node.conclude', { nodeId, forceId });
export const reopenNode = (nodeId) => write('node.reopen', { nodeId });
export const setTurnCount = (count) => write('turn.set', { count });
export const generateExample = () => write('example.generate', {});
export const removeExample = () => write('example.remove', {});

/** A read, so no relay: any client can ask whether the example is currently present. */
export const hasExample = (board = readBoard()) => board.plots.some((p) => p.isExample);

/** Exposed for tools/ and for the console API; not used by the UI. */
export const OPERATION_NAMES = Object.keys(operations);
