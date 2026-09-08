/**
 * What a deletion takes with it.
 *
 * Pure. No Foundry globals, no DOM. `node`-importable, and exercised by
 * tools/check-removal.mjs.
 *
 * Deleting a Thread is the one board action with no undo and consequences that
 * are not on screen when you press it. `node.delete` in state.mjs already sweeps
 * three places — it strips the id out of every prerequisite list, out of every
 * Phase's reveal and lock lists, and releases every Asset committed to it — and
 * it does that silently. A GM standing in the Thread's editor can see none of it:
 * the Asset is drawn on a different Force's card, the prerequisite is a line in
 * a different Thread's editor, the Phase list is three clicks into the Plot.
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
        found: false,
        id: nodeId,
        name: '',
        plot: null,
        assets: [],
        dependents: [],
        phases: [],
        logCount: 0,
        isEmpty: true
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
            forceName: nameOf(forces.find((f) => f.id === a.forceId))
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
        found: true,
        id: node.id,
        name: nameOf(node),
        plot: home ? { id: home.id, name: nameOf(home) } : null,
        assets,
        dependents,
        phases,
        logCount,
        isEmpty: assets.length === 0 && dependents.length === 0 && phases.length === 0
    };
}
