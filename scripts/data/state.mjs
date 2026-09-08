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

import { LIFECYCLE, LOG_KIND, VISIBILITY } from '../constants.mjs';
import * as Cond from '../logic/condition.mjs';
import * as S from '../settings.mjs';
import { registerOperations, requestWrite } from './relay.mjs';
import { buildExample } from './example-plot.mjs';
import {
    resolveMode, pushSign, addToPool, tickClock, addForForce, concludeThread, reopenThread
} from '../logic/progress.mjs';
import * as Econ from '../logic/economy.mjs';
import * as Gate from '../logic/gating.mjs';
import * as Log from '../logic/log.mjs';
import * as Cycle from '../logic/cycle.mjs';
import { MODE } from '../constants.mjs';

// ── reads ────────────────────────────────────────────────────────────────────

/** One snapshot, already normalized. Every render should take exactly one of these. */
export function readBoard() {
    return {
        plots: S.getPlots(),
        nodes: S.getNodes(),
        forces: S.getForces(),
        assets: S.getAssets(),
        turn: S.getTurn(),
        constants: S.getConstants(),
        conditions: S.getConditions(),
        log: S.getLog()
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
/**
 * The gate on one Thread: whether it is open, and which of the three shut it.
 *
 * Derived on every read and stored nowhere — see logic/gating.mjs for why. It
 * lives here rather than in the app because the app is not the only caller: the
 * two write operations below ask the same question before they run, and a guard
 * that consulted a different function than the one that drew the button would
 * eventually disagree with it.
 */
export const gateFor = (board, node) =>
    Gate.gateOf(node, plotById(board, node?.plotId), board.nodes);

export const assetsForNode = (board, nodeId) =>
    board.assets.filter((a) => a.nodeId === nodeId).sort(bySort);

/**
 * The Plots that are live on the board. Not an economic distinction — income has
 * been the Force's own business since M4, and which clock a Plot keeps is
 * `turnBehaviour` rather than lifecycle.
 */
export const activePlots = (board) =>
    board.plots.filter((p) => p.lifecycle === LIFECYCLE.ACTIVE);

/** Every force engaged in at least one active plot, deduped. */
export function forcesOnActivePlots(board) {
    const ids = new Set(activePlots(board).flatMap((p) => p.forceIds));
    return board.forces.filter((f) => ids.has(f.id));
}

/** The full roster, in board order. The Cockpit lists every Force, engaged or not. */
export const allForces = (board) => [...board.forces].sort(bySort);

/** Which Plots a Force is on — the Cockpit's answer to "is this Force in play?". */
export const plotsForForce = (board, forceId) =>
    board.plots.filter((p) => p.forceIds.includes(forceId)).sort(bySort);

/**
 * What Advance Turn would pay, without paying it. A read, so no relay: the
 * confirmation shows the GM the bill before they sign it.
 */
/**
 * What the next cycle does to every Force, without doing it. A read, so no relay.
 * The full roster comes back, including the Forces it will not move, because
 * "why did nobody pay the Guard?" is answered by the row the Guard is on.
 */
export const turnPreview = (board = readBoard()) => Econ.incomeRoster(board.forces);

/**
 * The other half of the bill: the condition timers a cycle is about to move, and
 * what each Asset arrives at when its timer runs out.
 *
 * `Cond.ticking` is pure and takes no side effects, so previewing a cycle is the
 * same call the cycle itself makes — the GM is shown the operation rather than a
 * description of it. Pass a plotId for one Plot's own cycle.
 */
export const turnTimers = (board = readBoard(), plotId = null) =>
    Cond.ticking(board.conditions, Econ.assetsOnTheClock(board.assets, board.plots, plotId));

/** The Plots the world's cycle will not move, with the reason each one sits out. */
export const turnSkips = (board = readBoard()) => Econ.sittingOut(board.plots);

/** The chronicle, newest first. Already normalized; the viewer is applied on render. */
export const readLog = (board = readBoard(), count = 30) => Log.recent(board.log, count);
/** The GM's condition table, for a form that needs to offer it. */
export const readConditions = () => S.getConditions();

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

/**
 * Write one line of the chronicle.
 *
 * Called from inside the operations, never from the UI: a development is recorded
 * by the same write that made it, so the log cannot disagree with the board. What
 * is stored is references and a kind — the sentence is built at render time, when
 * the viewer is known. See logic/log.mjs.
 *
 * Returns the id it wrote. A cycle keeps the ids of its own lines, because those
 * lines still standing at the top of the chronicle is the proof that nothing has
 * happened since — which is what makes the cycle safe to take back.
 */
async function record(patch) {
    const row = Log.entry({
        ...patch,
        turn: S.getTurn().count,
        at: Date.now(),
        // The seal is taken here rather than passed in, so no operation can
        // forget it: this is the only place a line is written, which makes it the
        // only place that has to know what was public when it was.
        sealed: Log.sealOf(namedBy(patch))
    });
    const id = foundry.utils.randomID();
    await S.setLog(Log.append(S.getLog(), { id, ...row }));
    return id;
}

/** The rows a line names, looked up so `sealOf` can ask what they were then. */
function namedBy({ plotId = null, nodeId = null, forceId = null, assetId = null }) {
    return [
        plotId ? S.getPlots().find((p) => p.id === plotId) : null,
        nodeId ? S.getNodes().find((n) => n.id === nodeId) : null,
        forceId ? S.getForces().find((f) => f.id === forceId) : null,
        assetId ? S.getAssets().find((a) => a.id === assetId) : null
    ];
}

// ── operations (GM side) ─────────────────────────────────────────────────────
// These run on a GM client only — either the caller is a GM, or the relay handed
// the payload to the designated GM. They are the only functions that call setters.

const operations = {
    async 'plot.upsert'({ patch }) {
        const plots = S.getPlots();
        // A Plot is born on the cycle the world is already on. Starting every new
        // Plot at zero would read as a fresh calendar for something that began
        // this evening, and would put a Plot set loose in its first session
        // eleven cycles behind the board it is sitting on.
        const seeded = plots.some((p) => p.id === patch.id)
            ? patch
            : { turnCount: S.getTurn().count, ...patch };
        await S.setPlots(upsertRow(plots, seeded));
    },

    /** Deleting a plot takes its nodes with it and releases any asset committed to them. */
    /**
     * Delete a Plot and everything that only existed inside it.
     *
     * Its Threads go with it, and so this has to perform every sweep
     * `node.delete` performs — once, for all of them. It did not, and the gap was
     * only invisible because most prerequisite chains live inside one Plot: a
     * Thread in ANOTHER Plot that required one of these read the dangling id
     * forever after. `unmetPrereqs` forgives an id that resolves to nothing, so
     * the board did not lie, but the stored lists carried names of Threads that
     * no longer existed and the prerequisite picker had a blank row in it.
     */
    async 'plot.delete'({ plotId }) {
        const doomedNodes = new Set(S.getNodes().filter((n) => n.plotId === plotId).map((n) => n.id));
        const kept = (ids) => (ids ?? []).filter((id) => !doomedNodes.has(id));

        await S.setPlots(S.getPlots()
            .filter((p) => p.id !== plotId)
            .map((p) => ({
                ...p,
                phases: p.phases.map((ph) => ({
                    ...ph,
                    revealNodeIds: kept(ph.revealNodeIds),
                    lockNodeIds: kept(ph.lockNodeIds)
                }))
            })));
        await S.setNodes(S.getNodes()
            .filter((n) => n.plotId !== plotId)
            .map((n) => (n.prereqNodeIds.some((id) => doomedNodes.has(id))
                ? { ...n, prereqNodeIds: kept(n.prereqNodeIds) }
                : n)));
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

    /**
     * Developing an Asset costs its Force whatever the world says an Asset costs.
     *
     * Charged on CREATION only, and never on an edit: renaming a battalion is not
     * raising a second one. The affordability guard is here as well as in the
     * editor, because the purse can change between opening a form and saving it.
     */
    async 'asset.upsert'({ patch }) {
        const assets = S.getAssets();
        const before = assets.find((a) => a.id === patch.id) ?? null;
        const isNew = !patch.id || !before;
        const cost = isNew ? S.getConstants().assetCost : 0;

        if (cost > 0) {
            const forces = S.getForces();
            const owner = forces.find((f) => f.id === patch.forceId) ?? null;
            if (!owner || !Econ.canAfford(owner, cost)) return;
            await S.setForces(forces.map((f) => (f.id === owner.id
                ? { ...f, resources: Econ.spend(f, cost) }
                : f)));
        }

        // The editor does not own the condition. asset.setCondition does, because
        // putting an Asset into one releases it, starts a timer and writes a line
        // in the chronicle, and none of those belong to "the GM saved a form".
        await S.setAssets(upsertRow(assets, patch));
    },

    /**
     * Put an Asset into a condition.
     *
     * Its own operation for three reasons that all point the same way: it releases
     * the Asset when the condition is out of play, it starts that condition's
     * timer, and it is a development the chronicle records with a note and an
     * audience of the GM's choosing.
     */
    async 'asset.setCondition'({
        assetId, condition, cycles = null, note = '', visibility = VISIBILITY.VISIBLE
    }) {
        const assets = S.getAssets();
        const asset = assets.find((a) => a.id === assetId) ?? null;
        if (!asset) return;

        const row = Cond.rowFor(S.getConditions(), condition);
        // An id the table does not hold would silently resolve to the fallback,
        // which is the opposite of what the GM pressed. Refused instead.
        if (row.id !== condition) return;

        const asked = Number.isFinite(Number(cycles)) ? Math.max(0, Math.trunc(cycles)) : null;
        const next = {
            ...asset,
            condition: row.id,
            conditionCycles: asked ?? row.cycles,
            // Out of play means off whatever it was on, in the same write that set
            // it. The alternative is a Thread rendering a destroyed battalion until
            // someone notices, and a rule every caller has to remember.
            ...(row.inPlay === false ? { plotId: null, nodeId: null } : {})
        };
        await S.setAssets(assets.map((a) => (a.id === assetId ? next : a)));

        // Only a CHANGE is a development, and a re-set that restarts a timer is
        // one. A note makes anything worth recording.
        const still = asset.condition === row.id
            && asset.conditionCycles === next.conditionCycles;
        if (still && !note) return;
        await record({
            kind: LOG_KIND.CONDITION,
            plotId: asset.plotId, nodeId: asset.nodeId,
            forceId: asset.forceId, assetId,
            condition: row.id, note, visibility,
            isExample: asset.isExample
        });
    },

    /**
     * Replace the GM's condition table.
     *
     * `moves` maps an Asset id to the condition it should end up in, which is how
     * deleting a condition that Assets are standing in is resolved: the GM says
     * what each of them becomes, one at a time, and both writes land in the same
     * operation so the table can never be saved while Assets point at a row that
     * is gone.
     */
    async 'condition.setAll'({ rows, moves = {} }) {
        await S.setConditions(rows);
        const ids = Object.keys(moves);
        if (!ids.length) return;

        const conditions = S.getConditions();
        const assets = S.getAssets();
        await S.setAssets(assets.map((a) => {
            if (!ids.includes(a.id)) return a;
            const row = Cond.rowFor(conditions, moves[a.id]);
            return {
                ...a,
                condition: row.id,
                conditionCycles: 0,
                ...(row.inPlay === false ? { plotId: null, nodeId: null } : {})
            };
        }));
    },

    async 'asset.delete'({ assetId }) {
        await S.setAssets(S.getAssets().filter((a) => a.id !== assetId));
    },

    /**
     * Push a Thread along. The mode decides which pile the amount lands in, and
     * logic/progress.mjs does the arithmetic — this only reads, routes and writes.
     *
     * Both halves of a push are explicit. `amount` is how far the needle moves;
     * `resourceDelta` is what it does to the Force's purse, and it is a separate
     * number because those are not the same question. Most pushes cost what they
     * move, some cost nothing, and a Force that has just sacked a supply train
     * gains by pushing. Passing null for resourceDelta falls back to the automatic
     * charge — the intent capped by what actually moved — which is the figure the
     * push dialog offers as its starting point.
     *
     * `amount` ARRIVES IN THE DIRECTION THE THREAD IS READ. On a depleting Thread
     * that is the opposite of the direction its pool moves, and this function is
     * the one place the two are reconciled: `applied` goes into the arithmetic,
     * and what the arithmetic gives back is turned around again before it is
     * charged for or written down. See `pushSign` for why the typed number is the
     * one that got to keep its meaning.
     */
    async 'node.advance'({
        nodeId, forceId = null, amount = 1, resourceDelta = null, note = '',
        visibility = VISIBILITY.VISIBLE
    }) {
        const nodes = S.getNodes();
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const plot = S.getPlots().find((p) => p.id === node.plotId) ?? null;
        const assets = S.getAssets().filter((a) => a.nodeId === nodeId);
        const mode = resolveMode(node, plot);
        // Display direction in, storage direction out. 1 on an ordinary Thread,
        // so this is a no-op everywhere it is not needed.
        const sign = pushSign(node, plot);
        const applied = Math.trunc(Number(amount) || 0) * sign;

        // A shut gate refuses the write outright, for the same reason an
        // unaffordable push does: the render that offered the control can be a
        // Phase crossing out of date by the time the button is pressed. The UI
        // does not offer it either, and neither of those is sufficient alone.
        if (Gate.isShut(node, plot, S.getNodes())) return;

        // The dialog refuses what a Force cannot afford, so this guard catches the
        // case where the purse changed under a stale render — it refuses rather
        // than half-applies. Only a spend can overdraw; a gain never needs checking.
        const forces = S.getForces();
        const spender = forceId ? forces.find((f) => f.id === forceId) ?? null : null;
        const asked = Number.isFinite(resourceDelta) ? Math.trunc(resourceDelta) : null;
        if (spender && asked !== null && asked < 0 && !Econ.canAfford(spender, -asked)) return;

        let progress;
        if (mode === MODE.CLOCK) progress = tickClock(node, applied, assets);
        else if (mode === MODE.CONTESTED) {
            if (!forceId) return;               // contested progress must name a side
            progress = addForForce(node, forceId, applied, assets);
        } else progress = addToPool(node, applied, assets);

        await S.setNodes(nodes.map((n) => (n.id === nodeId ? { ...n, progress } : n)));

        // What actually moved, which is not always what was asked for: a tick into
        // a full clock moves nothing, and an Asset's bonus progress is not billed.
        const realized = mode === MODE.CONTESTED
            ? (progress.byForce[forceId] ?? 0) - (node.progress.byForce[forceId] ?? 0)
            : progress.pool - node.progress.pool;

        // A negative delta is a spend, a positive one a windfall. With nothing
        // passed, the Force pays for what it moved, exactly as it always did.
        // Billed on the STORAGE pair, both figures pointing the same way. What a
        // push costs is what it bought in progress toward the conclusion, and
        // that is the same purchase whichever direction the Thread prints it in
        // — charging on the typed number would refund a Force for depleting.
        const delta = asked !== null
            ? asked
            : (spender ? -Econ.chargeFor(applied, realized) : 0);

        if (spender && delta !== 0) {
            await S.setForces(forces.map((f) => (f.id === spender.id
                ? { ...f, resources: Econ.adjust(f, delta) }
                : f)));
        }

        // A push that moved nothing, cost nothing and said nothing is not a
        // development, and recording it would bury the ones that are.
        if (realized === 0 && delta === 0 && !note) return;
        await record({
            kind: LOG_KIND.PUSH,
            plotId: node.plotId, nodeId, forceId,
            // Written down the way it was read out. The chronicle prints this
            // beside the Thread's own name, so a line saying +1 under a row that
            // just fell from 5 to 4 would be the same lie the dialog told.
            amount: realized * sign, cost: delta, note, visibility,
            isExample: node.isExample
        });
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
        // Concluding a Thread is how a prerequisite gets met, so a Thread behind
        // its own shut gate must not be able to reach past it. Committing an
        // Asset to one still is allowed — standing a battalion by ahead of a
        // door opening is exactly what a GM does with a gate they can see.
        if (Gate.isShut(node, plot, nodes)) return;

        const result = concludeThread(plot, node, forceId);
        await S.setNodes(nodes.map((n) => (n.id === nodeId
            ? { ...result.node, appliedDelta: result.delta }
            : n)));
        await S.setPlots(plots.map((p) => (p.id === plot.id
            ? { ...p, state: result.plotState }
            : p)));

        // The outcome note is the fiction the GM already wrote for this ending, so
        // the chronicle says what happened rather than that something happened.
        const outcome = node.outcomes.find((o) => o.forceId === forceId) ?? null;
        await record({
            kind: LOG_KIND.CONCLUDE,
            plotId: plot.id, nodeId, forceId,
            amount: result.delta, note: outcome?.note ?? '',
            isExample: node.isExample
        });
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

        await record({
            kind: LOG_KIND.REOPEN,
            plotId: plot.id, nodeId,
            isExample: node.isExample
        });
    },

    /** Pause or resume a Force's income. The only thing that stops a Force earning. */
    async 'force.setActive'({ forceId, isActive }) {
        await S.setForces(S.getForces().map((f) => (f.id === forceId
            ? { ...f, isActive: !!isActive }
            : f)));
    },

    /**
     * World-wide defaults, the per-kind default visibility among them. One object,
     * one write, and it goes through the relay like everything else — a player
     * must not be able to set what new rows show the table.
     */
    async 'constants.set'({ patch }) {
        await S.setConstants({ ...S.getConstants(), ...patch });
    },

    /** GM fiat on a Force's purse — the escape hatch for everything the model misses. */
    async 'force.adjust'({ forceId, delta }) {
        await S.setForces(S.getForces().map((f) => (f.id === forceId
            ? { ...f, resources: Econ.adjust(f, delta) }
            : f)));
    },

    /**
     * Move an Asset. Committing to a Thread commits it to that Thread's Plot in the
     * same write, so the two fields can never disagree; passing neither releases it.
     */
    async 'asset.commit'({ assetId, nodeId = null, plotId = null }) {
        const node = nodeId ? S.getNodes().find((n) => n.id === nodeId) ?? null : null;
        const plot = !node && plotId ? S.getPlots().find((p) => p.id === plotId) ?? null : null;
        const where = Econ.commitment(node, plot);
        const assets = S.getAssets();
        const asset = assets.find((a) => a.id === assetId) ?? null;
        if (!asset) return;
        // Refused rather than half-applied, for the same reason an unaffordable
        // push is: the tray does not offer an out-of-play Asset, but a render can
        // be stale by the time the drag lands. Releasing one is always allowed.
        const committing = !!(where.nodeId || where.plotId);
        if (committing && !Cond.isInPlay(asset)) return;
        await S.setAssets(assets.map((a) => (a.id === assetId ? { ...a, ...where } : a)));

        // Committing and releasing are the same write and read as opposite
        // developments, which is what the two kinds are for.
        await record({
            kind: where.nodeId || where.plotId ? LOG_KIND.COMMIT : LOG_KIND.RELEASE,
            plotId: where.plotId ?? asset.plotId,
            nodeId: where.nodeId,
            forceId: asset.forceId,
            assetId,
            isExample: asset.isExample
        });
    },

    /**
     * The one global clock. Every Force that is not paused is paid its income, and
     * the counter and the purses move in a single operation so a cycle can never be
     * counted without being paid.
     */
    async 'turn.advance'() {
        const plots = S.getPlots();
        const was = S.getTurn();
        const result = Econ.advanceTurn({ forces: S.getForces(), turn: was, plots });
        if (result.payments.length) await S.setForces(result.forces);
        // Every Plot on the world's clock takes the world's count. The ones
        // sitting it out keep theirs, which is the whole point of them —
        // advanceTurn hands those back by reference, so this asks whether any
        // row actually moved rather than rewriting the setting to say nothing.
        const wound = plots.filter((p, i) => p !== result.plots[i]);
        if (wound.length) await S.setPlots(result.plots);

        // Every running condition timer moves with the clock — every timer this
        // cycle owns, that is. An Asset committed to a Plot that keeps its own
        // clock is moved by that Plot's button and not by this one. Applied
        // before the counter, so an Asset that finishes recovering has already
        // finished by the time anyone reads the line about the cycle it finished in.
        const assets = S.getAssets();
        const moved = Cond.ticking(S.getConditions(), Econ.assetsOnTheClock(assets, plots));
        if (moved.length) {
            const byId = new Map(moved.map((m) => [m.asset.id, m.change]));
            await S.setAssets(assets.map((a) => (byId.has(a.id) ? { ...a, ...byId.get(a.id) } : a)));
        }

        await S.setTurn({ count: result.turn.count, chapters: was.chapters });
        // Recorded after the counter moves, so the entry names the cycle it opened.
        const lines = [await record({ kind: LOG_KIND.CYCLE, amount: result.payments.length })];

        // One line per Asset that actually arrived somewhere, not per Asset whose
        // counter merely went down. A countdown is not a development; arriving is.
        for (const { asset, change } of moved) {
            if (change.condition === undefined) continue;
            lines.push(await record({
                kind: LOG_KIND.CONDITION,
                plotId: asset.plotId, nodeId: asset.nodeId,
                forceId: asset.forceId, assetId: asset.id,
                condition: change.condition,
                isExample: asset.isExample
            }));
        }

        // What all of that was, written down so it can be taken back. Last, and
        // deliberately a SECOND write of the same setting: the counter has to
        // move before the lines above are stamped with it, and the undo must not
        // exist until everything it claims to reverse has actually happened.
        //
        // The values are the ones from BEFORE — `payments` carries each purse as
        // it stood, and `moved` carries each Asset as it stood — because a purse
        // that stopped at its floor is not recoverable by subtracting the income
        // it was nominally paid.
        await S.setTurn({
            count: result.turn.count,
            // Carried through untouched. A cycle turning is not a page turning,
            // and every write of this setting rebuilds the whole shape.
            chapters: was.chapters,
            undo: Cycle.record({
                count: was.count,
                forces: result.payments.map((p) => ({ id: p.forceId, resources: p.from })),
                plots: wound,
                assets: moved.map(({ asset }) => asset),
                logIds: lines
            })
        });
    },

    /**
     * One Plot's own cycle.
     *
     * Refused unless the Plot is actually on its own clock. The button is only
     * drawn for an isolated Plot, but a render can be stale — a second GM may
     * have set it back to the world's clock while this one was reading — and the
     * same rule that refuses an unaffordable push applies here: the writer
     * checks, because the writer is the only thing that cannot be looking at an
     * old screen.
     *
     * No purse moves and none should. Income is the Force's, and a Force standing
     * on two Plots with two clocks has no sensible answer to which of them pays it.
     */
    async 'plot.turn'({ plotId }) {
        const plots = S.getPlots();
        const plot = plots.find((p) => p.id === plotId) ?? null;
        if (!plot || !Econ.hasOwnTurn(plot)) return;

        const next = Econ.advancePlotTurn(plot);
        await S.setPlots(plots.map((p) => (p.id === plotId ? next : p)));

        // Only the timers this Plot owns: an Asset committed to it, or to one of
        // its Threads. An Asset sitting uncommitted in its owner's hand is on the
        // world's clock and is not this button's business.
        const assets = S.getAssets();
        const moved = Cond.ticking(S.getConditions(), Econ.assetsOnTheClock(assets, plots, plotId));
        if (moved.length) {
            const byId = new Map(moved.map((m) => [m.asset.id, m.change]));
            await S.setAssets(assets.map((a) => (byId.has(a.id) ? { ...a, ...byId.get(a.id) } : a)));
        }

        // The Plot's own count, not the world's, which has not moved. `amount`
        // carries it because the entry's `turn` is stamped with the world's.
        const lines = [await record({
            kind: LOG_KIND.CYCLE,
            plotId,
            amount: next.turnCount,
            isExample: plot.isExample
        })];

        for (const { asset, change } of moved) {
            if (change.condition === undefined) continue;
            lines.push(await record({
                kind: LOG_KIND.CONDITION,
                plotId: asset.plotId, nodeId: asset.nodeId,
                forceId: asset.forceId, assetId: asset.id,
                condition: change.condition,
                isExample: asset.isExample
            }));
        }

        // One undo record for the whole board, whichever clock wrote it — see
        // logic/cycle.mjs. `count` is the world's count UNCHANGED, so reverting
        // this writes it back as it is and the world's clock never moves.
        const turn = S.getTurn();
        await S.setTurn({
            count: turn.count,
            chapters: turn.chapters,
            undo: Cycle.record({
                plotId,
                count: turn.count,
                plots: [plot],
                assets: moved.map(({ asset }) => asset),
                logIds: lines
            })
        });
    },

    /**
     * Take back the last cycle, whichever clock turned it.
     *
     * The one destructive operation on this board that is an UNDO rather than an
     * edit, and it is narrow on purpose. It replays a record written by the
     * advance itself — purses, counts, timers and the lines it wrote — and it
     * refuses outright once anything else has been recorded since.
     *
     * The refusal is checked HERE and not only on the button. A second GM may
     * have pushed a Thread while this one was reading a stale screen, and the
     * writer is the only thing in this module that cannot be looking at an old
     * render. Same rule as the unaffordable push and the shut gate.
     */
    async 'turn.revert'() {
        const turn = S.getTurn();
        const log = S.getLog();
        if (!Cycle.canRevert(turn.undo, log)) return;

        const forces = S.getForces();
        const plots = S.getPlots();
        const assets = S.getAssets();
        const back = Cycle.reverse(turn.undo, {
            forces, plots, assets, log, chapters: turn.chapters
        });

        // Rows the record does not name come back by reference, so each of these
        // asks whether anything actually moved rather than rewriting a setting —
        // and a world-clock revert therefore touches no Assets at all when
        // nothing was on a timer.
        if (back.forces.some((f, i) => f !== forces[i])) await S.setForces(back.forces);
        if (back.plots.some((p, i) => p !== plots[i])) await S.setPlots(back.plots);
        if (back.assets.some((a, i) => a !== assets[i])) await S.setAssets(back.assets);

        // The cycle did not happen, so the chronicle stops saying it did. A line
        // saying it began followed by a line saying it was undone is the GM's
        // bookkeeping in a record the table reads.
        await S.setLog(back.log);

        // Last, and it clears the record: an undo that could be pressed twice
        // would pay the same purse back twice. `back.chapters` has already lost
        // any mark standing above the restored count — a Segment cannot open on
        // a cycle that is being taken back.
        await S.setTurn({ count: back.count, chapters: back.chapters, undo: null });
    },

    /** Wipe the chronicle. The board is untouched — this only forgets. */
    async 'log.clear'() {
        await S.setLog([]);
    },

    async 'turn.set'({ count }) {
        // The marks stay. This writes the count by hand and says nothing about
        // where the campaign's pages turned; a revert is the operation that
        // unmakes a cycle, and only that one takes a mark with it.
        await S.setTurn({ count, chapters: S.getTurn().chapters });
    },

    /**
     * Open a Segment on the cycle the board is standing on.
     *
     * NOT a development, and deliberately writes no chronicle line. A mark
     * records nothing that happened — it changes how the running count is READ,
     * exactly as renaming the clock does — and a line here would refuse the very
     * revert a GM reaches for next, because the undo survives only while the
     * cycle's own lines are still the top of the chronicle.
     *
     * A cycle already marked is left alone rather than marked twice. The button
     * is drawn disabled in that case, but a render can be stale — a second GM
     * may have marked it — and the writer is the one thing in this module that
     * cannot be looking at an old screen.
     */
    async 'chapter.begin'({ name = '' } = {}) {
        const turn = S.getTurn();
        const at = Cycle.nextMark(turn.count);
        if (Cycle.hasMark(turn.chapters, at)) return;
        await S.setTurn({ ...turn, chapters: [...turn.chapters, { at, name }] });
    },

    /** The whole list, as the Settings tab edited it. Normalize does the sorting. */
    async 'chapter.set'({ chapters }) {
        await S.setTurn({ ...S.getTurn(), chapters });
    },

    /**
     * Builds the Help tab's example. Ids in the fixture are stable, so pressing
     * Generate twice overwrites the example in place rather than growing a second
     * copy of it — and never touches a hand-authored row.
     */
    async 'example.generate'() {
        const { plots, nodes, forces, assets, log } = buildExample();
        await S.setForces(mergeById(S.getForces(), forces));
        await S.setPlots(mergeById(S.getPlots(), plots));
        await S.setNodes(mergeById(S.getNodes(), nodes));
        await S.setAssets(mergeById(S.getAssets(), assets));
        // A few developments of its own, so the chronicle has something in it the
        // first time a GM looks at the board. Replaces the previous example's
        // entries rather than stacking a second copy of them.
        //
        // The GM's own lines are kept whole and the EXAMPLE's are what gets cut
        // when the two together overflow. Trimming the combined list would push
        // real history off the end of a full chronicle to make room for a demo,
        // and Remove Example could not bring it back — which would make
        // Generate a destructive button in the one place it promises not to be.
        const mine = S.getLog().filter((e) => !e.isExample);
        const room = Math.max(0, Log.LOG_LIMIT - mine.length);
        await S.setLog([...log.slice(0, room), ...mine].slice(0, Log.LOG_LIMIT));
    },

    /**
     * Deletes exactly what the Help tab generated and nothing else. This is why
     * isExample is on every entity rather than tracked in a side list — a side
     * list can drift out of step with the data it points at.
     */
    async 'example.remove'() {
        // The same sweeps the four deletes perform, run once for the whole
        // fixture. Without them a GM who wired one of their own Threads to an
        // example Thread — which is exactly what the example is FOR — would be
        // left with an id pointing at nothing after pressing Remove.
        const goneNodes = new Set(S.getNodes().filter((n) => n.isExample).map((n) => n.id));
        const goneForces = new Set(S.getForces().filter((f) => f.isExample).map((f) => f.id));
        const gonePlots = new Set(S.getPlots().filter((p) => p.isExample).map((p) => p.id));
        const kept = (ids) => (ids ?? []).filter((id) => !goneNodes.has(id));

        await S.setPlots(S.getPlots()
            .filter((p) => !p.isExample)
            .map((p) => ({
                ...p,
                forceIds: p.forceIds.filter((id) => !goneForces.has(id)),
                phases: p.phases.map((ph) => ({
                    ...ph,
                    revealNodeIds: kept(ph.revealNodeIds),
                    lockNodeIds: kept(ph.lockNodeIds)
                }))
            })));

        await S.setNodes(S.getNodes()
            .filter((n) => !n.isExample)
            .map((n) => {
                const byForce = Object.fromEntries(Object.entries(n.progress.byForce)
                    .filter(([forceId]) => !goneForces.has(forceId)));
                return {
                    ...n,
                    prereqNodeIds: kept(n.prereqNodeIds),
                    progress: { ...n.progress, byForce },
                    outcomes: n.outcomes.filter((o) => !goneForces.has(o.forceId)),
                    concludedBy: goneForces.has(n.concludedBy) ? null : n.concludedBy
                };
            }));

        await S.setForces(S.getForces().filter((f) => !f.isExample));

        // An Asset belonging to an example Force goes with it, the way it would
        // under force.delete. One of the GM's own that was standing on example
        // ground is released rather than deleted.
        await S.setAssets(S.getAssets()
            .filter((a) => !a.isExample && !goneForces.has(a.forceId))
            .map((a) => (goneNodes.has(a.nodeId) || gonePlots.has(a.plotId)
                ? { ...a, nodeId: null, plotId: null }
                : a)));

        await S.setLog(S.getLog().filter((e) => !e.isExample));
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
export const setAssetCondition = (
    assetId,
    { condition, cycles = null, note = '', visibility = VISIBILITY.VISIBLE } = {}
) => write('asset.setCondition', { assetId, condition, cycles, note, visibility });
export const setConditions = (rows, moves = {}) => write('condition.setAll', { rows, moves });
export const deleteAsset = (assetId) => write('asset.delete', { assetId });
export const advanceNode = (
    nodeId,
    {
        amount = 1, forceId = null, resourceDelta = null, note = '',
        visibility = VISIBILITY.VISIBLE
    } = {}
) => write('node.advance', { nodeId, amount, forceId, resourceDelta, note, visibility });
export const concludeNode = (nodeId, forceId = null) => write('node.conclude', { nodeId, forceId });
export const reopenNode = (nodeId) => write('node.reopen', { nodeId });
export const adjustForceResources = (forceId, delta) => write('force.adjust', { forceId, delta });
export const setForceActive = (forceId, isActive) =>
    write('force.setActive', { forceId, isActive });
export const setConstants = (patch) => write('constants.set', { patch });
export const commitAsset = (assetId, { nodeId = null, plotId = null } = {}) =>
    write('asset.commit', { assetId, nodeId, plotId });
export const releaseAsset = (assetId) => write('asset.commit', { assetId });
export const advanceTurn = () => write('turn.advance', {});
export const advancePlotTurn = (plotId) => write('plot.turn', { plotId });
export const revertTurn = () => write('turn.revert', {});
/** Sets the count by hand, and drops the undo with it: nothing is being taken back. */
export const setTurnCount = (count) => write('turn.set', { count });

export const beginChapter = (name = '') => write('chapter.begin', { name });

export const setChapters = (chapters) => write('chapter.set', { chapters });
export const generateExample = () => write('example.generate', {});
export const removeExample = () => write('example.remove', {});
export const clearLog = () => write('log.clear', {});

/** The world's defaults, for a form that needs to seed a new row from them. */
export const readConstants = () => S.getConstants();

/** A read, so no relay: any client can ask whether the example is currently present. */
export const hasExample = (board = readBoard()) => board.plots.some((p) => p.isExample);

/** Exposed for tools/ and for the console API; not used by the UI. */
export const OPERATION_NAMES = Object.keys(operations);
