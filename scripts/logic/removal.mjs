/**
 * What a deletion takes with it.
 *
 * Pure. No Foundry globals, no DOM. `node`-importable, and exercised by
 * tools/check-removal.mjs.
 *
 * A delete is the one board action with no undo and consequences that are not on
 * screen when you press it. `node.delete` sweeps three places — it strips the id
 * out of every prerequisite list, out of every Phase's reveal and lock lists, and
 * releases every Asset committed to it — and it does that silently. A GM standing
 * in the Thread's editor can see none of it: the Asset is drawn on a different
 * Force's card, the prerequisite is a line in a different Thread's editor, the
 * Phase list is three clicks into the Plot.
 *
 * All four deletes have that shape, and for a while only the Thread said so.
 * A Plot takes every Thread under it and everything those Threads were holding;
 * a Force takes every Asset it ever raised, outright, with no refund; an Asset
 * takes a discount off a Thread standing on another screen. So there are four
 * reports, and they share one shape so that one reader can print any of them.
 *
 * So this file answers the question the confirmation ought to be asking: what
 * else moves. It reads the board and reports, without changing anything.
 *
 * TWO RULES ABOUT ITS SHAPE.
 *
 * It mirrors `node.delete`, and the mirror is the whole risk. Every consequence
 * listed here is one the operation actually performs; if a future edit teaches
 * the operation a fourth sweep and forgets this file, the dialog quietly starts
 * under-reporting — which is worse than not reporting, because a GM who has read
 * one of these lists twice will stop reading it. tools/check-removal.mjs pins
 * each branch against a fixture for that reason.
 *
 * And it reports ROWS, never rendered text. Every name here goes on to be
 * escaped and localised by the caller, and a report that carried sentences would
 * have to know the reader's language and the reader's role. It knows neither.
 */

import { NODE_STATUS } from '../constants.mjs';
import { gateOf } from './gating.mjs';

const rowsOf = (v) => (Array.isArray(v) ? v : []);

/**
 * The board as it would be a moment after the delete.
 *
 * Built by hand rather than imported from state.mjs, which is a writer and would
 * drag Foundry in with it. It is the same three sweeps, and check-removal.mjs
 * asserts the two agree on a fixture — the assertion exists precisely because
 * this is a copy.
 */
function without(nodeId, board) {
    const nodes = rowsOf(board?.nodes)
        .filter((n) => n.id !== nodeId)
        .map((n) => (rowsOf(n.prereqNodeIds).includes(nodeId)
            ? { ...n, prereqNodeIds: n.prereqNodeIds.filter((x) => x !== nodeId) }
            : n));

    const plots = rowsOf(board?.plots).map((p) => ({
        ...p,
        phases: rowsOf(p.phases).map((ph) => ({
            ...ph,
            revealNodeIds: rowsOf(ph.revealNodeIds).filter((x) => x !== nodeId),
            lockNodeIds: rowsOf(ph.lockNodeIds).filter((x) => x !== nodeId)
        }))
    }));

    return { nodes, plots };
}

/**
 * Deleting a Thread: everything else that changes, and how.
 *
 * Returns a report whether or not the Thread exists — `found: false` for a stale
 * id, so a caller that raced a second GM's delete has something to read rather
 * than a null to guard.
 *
 * `frees` on a dependent is the interesting one. A Thread waiting on this one
 * loses a requirement it can now never meet, so the delete can OPEN it — and
 * that is a thing a GM would want to know before pressing, because it is the
 * opposite of what "delete" sounds like it does. It is only true where the gate
 * was shut before and is open after: a Thread still held by a Phase lock, or by
 * a second prerequisite, or by the GM's own switch, stays shut and says nothing.
 */
export function threadRemoval(nodeId, board) {
    const nodes = rowsOf(board?.nodes);
    const plots = rowsOf(board?.plots);
    const node = nodes.find((n) => n.id === nodeId) ?? null;

    const empty = {
        found: false, kind: 'thread', id: nodeId, name: '', plot: null,
        threads: [], assets: [], dependents: [], phases: [],
        plotsCast: [], contests: [], outcomes: [], credits: [],
        commitment: null, rosterCount: 0, logCount: 0, isEmpty: true
    };
    if (!node) return empty;

    const plotOf = (id) => plots.find((p) => p.id === id) ?? null;
    const nameOf = (row) => row?.name ?? '';
    const home = plotOf(node.plotId);

    // 1. Assets committed to it. They are RELEASED, not deleted — the sweep sets
    //    nodeId to null and leaves the Asset on its Force, where the GM will not
    //    think to look for it. Named with its owner for that reason.
    const forces = rowsOf(board?.forces);
    const assets = rowsOf(board?.assets)
        .filter((a) => a.nodeId === nodeId)
        .map((a) => ({
            id: a.id,
            name: nameOf(a),
            forceName: nameOf(forces.find((f) => f.id === a.forceId)),
            fate: 'released'
        }));

    // 2. Threads that require it. The prerequisite is stripped rather than
    //    inherited, so the chain does not close over the gap: a Thread that
    //    waited on this one now waits on nothing it used to wait on.
    const after = without(nodeId, board);
    const dependents = nodes
        .filter((n) => n.id !== nodeId && rowsOf(n.prereqNodeIds).includes(nodeId))
        .map((n) => {
            const before = gateOf(n, plotOf(n.plotId), nodes);
            const later = after.nodes.find((x) => x.id === n.id) ?? n;
            const laterPlot = after.plots.find((p) => p.id === n.plotId) ?? null;
            const opened = gateOf(later, laterPlot, after.nodes);
            return {
                id: n.id,
                name: nameOf(n),
                plotName: nameOf(plotOf(n.plotId)),
                concluded: n.status === NODE_STATUS.CONCLUDED,
                frees: !before.open && opened.open && n.status !== NODE_STATUS.CONCLUDED
            };
        });

    // 3. Phases that name it. A Phase's two lists are the GM's authored plan for
    //    a State band they may not have reached yet, which is exactly why losing
    //    a line out of one is worth saying out loud.
    const phases = [];
    for (const plot of plots) {
        for (const phase of rowsOf(plot.phases)) {
            const reveals = rowsOf(phase.revealNodeIds).includes(nodeId);
            const locks = rowsOf(phase.lockNodeIds).includes(nodeId);
            if (!reveals && !locks) continue;
            phases.push({
                plotId: plot.id,
                plotName: nameOf(plot),
                phaseLabel: phase.label ?? '',
                reveals,
                locks
            });
        }
    }

    // 4. The chronicle. Nothing sweeps it — the log is the record of what was
    //    done, and rewriting history to match the board would be the one edit
    //    this module never makes. Counted so the dialog can say the lines stay.
    const logCount = rowsOf(board?.log).filter((e) => e.nodeId === nodeId).length;

    return {
        found: true, kind: 'thread', id: node.id, name: nameOf(node),
        plot: home ? { id: home.id, name: nameOf(home) } : null,
        threads: [], assets, dependents, phases,
        plotsCast: [], contests: [], outcomes: [], credits: [],
        commitment: null, rosterCount: 0, logCount,
        isEmpty: assets.length === 0 && dependents.length === 0 && phases.length === 0
    };
}

/**
 * The board as it would be a moment after a Plot is deleted.
 *
 * The same shape as `without`, and for the same reason: `plot.delete` drops the
 * Plot, drops every Thread in it, and sweeps those Threads out of the
 * prerequisite lists and Phase lists that named them from OUTSIDE. Whether a
 * Thread elsewhere is freed by that can only be answered by building the board
 * that is left and asking its gates.
 */
function withoutPlot(plotId, board) {
    const doomed = new Set(rowsOf(board?.nodes)
        .filter((n) => n.plotId === plotId).map((n) => n.id));
    const kept = (ids) => rowsOf(ids).filter((id) => !doomed.has(id));

    const nodes = rowsOf(board?.nodes)
        .filter((n) => n.plotId !== plotId)
        .map((n) => ({ ...n, prereqNodeIds: kept(n.prereqNodeIds) }));

    const plots = rowsOf(board?.plots)
        .filter((p) => p.id !== plotId)
        .map((p) => ({
            ...p,
            phases: rowsOf(p.phases).map((ph) => ({
                ...ph,
                revealNodeIds: kept(ph.revealNodeIds),
                lockNodeIds: kept(ph.lockNodeIds)
            }))
        }));

    return { nodes, plots, doomed };
}

/**
 * Deleting a Plot: everything else that changes, and how.
 *
 * The one deletion whose scale is genuinely hidden. A Plot on screen is a name
 * and a State bar; what goes with it is every Thread underneath, and everything
 * every one of those Threads was holding. The Thread report answers this
 * question for one Thread — this answers it for all of them at once, which is
 * why the rows are collapsed by kind rather than repeated per Thread.
 *
 * Assets are RELEASED, not deleted: a Force keeps what it raised, and both the
 * Plot link and the Thread link are cleared. That is worth saying out loud
 * precisely because it is the merciful half of an otherwise total delete.
 */
export function plotRemoval(plotId, board) {
    const plots = rowsOf(board?.plots);
    const nodes = rowsOf(board?.nodes);
    const forces = rowsOf(board?.forces);
    const plot = plots.find((p) => p.id === plotId) ?? null;
    const nameOf = (row) => row?.name ?? '';

    const empty = {
        found: false, kind: 'plot', id: plotId, name: '',
        threads: [], assets: [], dependents: [], phases: [],
        plotsCast: [], contests: [], outcomes: [], credits: [],
        commitment: null, rosterCount: 0, logCount: 0, isEmpty: true
    };
    if (!plot) return empty;

    const after = withoutPlot(plotId, board);
    const doomed = after.doomed;

    // 1. The Threads. Deleted outright, and the only rows here that are.
    const threads = nodes
        .filter((n) => n.plotId === plotId)
        .map((n) => ({
            id: n.id,
            name: nameOf(n),
            concluded: n.status === NODE_STATUS.CONCLUDED
        }));

    // 2. Assets. Released rather than deleted — named with their owner, because
    //    the Force's card is where the GM will next find them and not look.
    const assets = rowsOf(board?.assets)
        .filter((a) => a.plotId === plotId || doomed.has(a.nodeId))
        .map((a) => ({
            id: a.id,
            name: nameOf(a),
            forceName: nameOf(forces.find((f) => f.id === a.forceId)),
            fate: 'released'
        }));

    // 3. Threads in other Plots that required one of these. Same reading as the
    //    Thread report: the interesting ones are those the delete OPENS.
    const plotOf = (id) => plots.find((p) => p.id === id) ?? null;
    const dependents = nodes
        .filter((n) => n.plotId !== plotId && rowsOf(n.prereqNodeIds).some((id) => doomed.has(id)))
        .map((n) => {
            const before = gateOf(n, plotOf(n.plotId), nodes);
            const later = after.nodes.find((x) => x.id === n.id) ?? n;
            const laterPlot = after.plots.find((p) => p.id === n.plotId) ?? null;
            const opened = gateOf(later, laterPlot, after.nodes);
            return {
                id: n.id,
                name: nameOf(n),
                plotName: nameOf(plotOf(n.plotId)),
                concluded: n.status === NODE_STATUS.CONCLUDED,
                frees: !before.open && opened.open && n.status !== NODE_STATUS.CONCLUDED
            };
        });

    // 4. Phases in other Plots that name one of these Threads.
    const phases = [];
    for (const other of plots) {
        if (other.id === plotId) continue;
        for (const phase of rowsOf(other.phases)) {
            const reveals = rowsOf(phase.revealNodeIds).some((id) => doomed.has(id));
            const locks = rowsOf(phase.lockNodeIds).some((id) => doomed.has(id));
            if (!reveals && !locks) continue;
            phases.push({
                plotId: other.id, plotName: nameOf(other),
                phaseLabel: phase.label ?? '', reveals, locks
            });
        }
    }

    // 5. The roster. The Forces themselves survive — only their casting in this
    //    Plot is lost — so this is a count and not a list of names to mourn.
    const rosterCount = rowsOf(plot.forceIds).length;

    const logCount = rowsOf(board?.log).filter((e) => e.plotId === plotId).length;

    return {
        found: true, kind: 'plot', id: plot.id, name: nameOf(plot),
        threads, assets, dependents, phases,
        plotsCast: [], contests: [], outcomes: [], credits: [],
        commitment: null, rosterCount, logCount,
        isEmpty: threads.length === 0 && assets.length === 0
            && dependents.length === 0 && phases.length === 0 && rosterCount === 0
    };
}

/**
 * Deleting a Force: everything else that changes, and how.
 *
 * The most destructive of the four, and the one whose old confirmation said the
 * least. A Force is a name and a purse on screen; what goes with it is every
 * Asset it ever raised — DELETED, not released, because an Asset belongs to a
 * Force the way a Thread belongs to a Plot and there is no one left to own it.
 * Nothing refunds. That is the line the GM most needs in front of them.
 *
 * The rest is quieter but real: the Force is struck from every Plot's roster, a
 * contested Thread loses the pool it had built for this side, an authored
 * outcome for this Force is dropped from the Thread that held it, and a Thread
 * this Force concluded keeps its conclusion but forgets who did it.
 */
export function forceRemoval(forceId, board) {
    const nodes = rowsOf(board?.nodes);
    const plots = rowsOf(board?.plots);
    const force = rowsOf(board?.forces).find((f) => f.id === forceId) ?? null;
    const nameOf = (row) => row?.name ?? '';
    const plotOf = (id) => plots.find((p) => p.id === id) ?? null;

    const empty = {
        found: false, kind: 'force', id: forceId, name: '',
        threads: [], assets: [], dependents: [], phases: [],
        plotsCast: [], contests: [], outcomes: [], credits: [],
        commitment: null, rosterCount: 0, logCount: 0, isEmpty: true
    };
    if (!force) return empty;

    // 1. Its Assets. Deleted outright — the one place in the module where a
    //    delete cascades into rows the GM did not name.
    const assets = rowsOf(board?.assets)
        .filter((a) => a.forceId === forceId)
        .map((a) => ({
            id: a.id,
            name: nameOf(a),
            forceName: nameOf(force),
            nodeName: nameOf(nodes.find((n) => n.id === a.nodeId)),
            fate: 'deleted'
        }));

    // 2. Plots it is cast in. The Plot survives; the casting does not.
    const plotsCast = plots
        .filter((p) => rowsOf(p.forceIds).includes(forceId))
        .map((p) => ({ id: p.id, name: nameOf(p) }));

    // 3. Contested Threads holding a pool for this side. The number vanishes,
    //    and on a contest that is half the reading.
    const contests = nodes
        .filter((n) => Number(n?.progress?.byForce?.[forceId] ?? 0) !== 0)
        .map((n) => ({
            id: n.id,
            name: nameOf(n),
            plotName: nameOf(plotOf(n.plotId)),
            pool: Number(n.progress.byForce[forceId])
        }));

    // 4. Authored outcomes. A Thread that said what happens if THIS Force wins
    //    loses that answer, which is fiction the GM wrote and will not get back.
    const outcomes = nodes
        .filter((n) => rowsOf(n.outcomes).some((o) => o.forceId === forceId))
        .map((n) => ({
            id: n.id,
            name: nameOf(n),
            plotName: nameOf(plotOf(n.plotId))
        }));

    // 5. Threads it concluded. The conclusion stands — it happened — but the
    //    board stops being able to say whose it was.
    const credits = nodes
        .filter((n) => n.concludedBy === forceId)
        .map((n) => ({
            id: n.id,
            name: nameOf(n),
            plotName: nameOf(plotOf(n.plotId))
        }));

    const logCount = rowsOf(board?.log).filter((e) => e.forceId === forceId).length;

    return {
        found: true, kind: 'force', id: force.id, name: nameOf(force),
        threads: [], assets, dependents: [], phases: [],
        plotsCast, contests, outcomes, credits,
        commitment: null, rosterCount: 0, logCount,
        isEmpty: assets.length === 0 && plotsCast.length === 0
            && contests.length === 0 && outcomes.length === 0 && credits.length === 0
    };
}

/**
 * Deleting an Asset: everything else that changes, and how.
 *
 * The shallowest of the four — `asset.delete` sweeps nothing, because nothing
 * else stores an Asset's id. It still gets a report, for two reasons.
 *
 * A committed Asset is doing something. It is lowering the cost of a push on the
 * Thread it stands with, and that discount disappears with it; the Thread is on
 * a different screen from the Force's card the delete is pressed on.
 *
 * And nothing is refunded. Developing an Asset cost the Force a real number out
 * of its purse, and deleting it does not put that back — a GM deleting one to
 * "undo" raising it is about to find that out, and would rather find it out here.
 */
export function assetRemoval(assetId, board) {
    const asset = rowsOf(board?.assets).find((a) => a.id === assetId) ?? null;
    const nameOf = (row) => row?.name ?? '';

    const empty = {
        found: false, kind: 'asset', id: assetId, name: '',
        threads: [], assets: [], dependents: [], phases: [],
        plotsCast: [], contests: [], outcomes: [], credits: [],
        commitment: null, rosterCount: 0, logCount: 0, isEmpty: true
    };
    if (!asset) return empty;

    const node = rowsOf(board?.nodes).find((n) => n.id === asset.nodeId) ?? null;
    const plot = rowsOf(board?.plots)
        .find((p) => p.id === (node?.plotId ?? asset.plotId)) ?? null;

    // Where it stands, or null for one sitting in reserve. A Plot without a
    // Thread is a real commitment too — an Asset can be lent to a Plot at large.
    const commitment = (node || plot)
        ? {
            nodeId: node?.id ?? null,
            nodeName: nameOf(node),
            plotId: plot?.id ?? null,
            plotName: nameOf(plot)
        }
        : null;

    const logCount = rowsOf(board?.log).filter((e) => e.assetId === assetId).length;

    return {
        found: true, kind: 'asset', id: asset.id, name: nameOf(asset),
        threads: [], assets: [], dependents: [], phases: [],
        plotsCast: [], contests: [], outcomes: [], credits: [],
        commitment, rosterCount: 0, logCount,
        forceName: nameOf(rowsOf(board?.forces).find((f) => f.id === asset.forceId)),
        isEmpty: commitment === null
    };
}
