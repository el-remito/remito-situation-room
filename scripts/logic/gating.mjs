/**
 * Whether a Thread is open, and which gate is shut when it is not.
 *
 * Pure. No Foundry globals, no DOM. `node`-importable, and exercised by
 * tools/check-gating.mjs.
 *
 * THERE ARE THREE GATES AND THEY ARE INDEPENDENT. A Thread can be shut because
 * the GM shut it, because the Plot's State has reached a Phase that shuts it, or
 * because a Thread it requires has not concluded. Any one of them is enough, and
 * they are asked separately so the board can say WHICH — "requires: Breach the
 * Wall" is an answer a table can act on, and a bare padlock is not.
 *
 * NOTHING HERE IS STORED. An earlier draft of this milestone had a Phase crossing
 * write `status` onto the Threads it named, firing on the transition the way the
 * phase notes will. That is wrong for the same reason a cached rule is wrong
 * elsewhere in this module: the moment State is nudged back for a correction, or
 * a prerequisite is reopened, or a Phase's threshold is edited, the stored answer
 * is stale and the board lies about why a Thread will not open. So the gate is
 * derived on every read, from the Plot as it stands now.
 *
 * The consequence worth knowing: a gate can REOPEN. State falls back below the
 * Phase that locked a Thread and the Thread is available again. That is the
 * honest reading — the situation receded — and it is the price of never being
 * stale.
 */

import { NODE_STATUS } from '../constants.mjs';
import { phaseFor } from './state-track.mjs';

/**
 * The Phases whose gates have fired: every Phase from the floor of the ladder up
 * to and including the one the Plot is currently in.
 *
 * Deliberately anchored on `phaseFor` rather than on `threshold <= state`
 * directly, so the Phase the chip NAMES is always the last one applied. A ladder
 * whose lowest threshold sits above its own floor would otherwise chip "Calm"
 * while Calm's reveal list had not fired, which is the kind of quiet disagreement
 * a GM would spend an evening not finding.
 */
export function reachedPhases(plot) {
    const phases = plot?.phases ?? [];
    const current = phaseFor(phases, plot?.state ?? 0);
    if (!current) return [];
    const index = phases.findIndex((p) => p.id === current.id);
    return phases.slice(0, index + 1);
}

/**
 * What the ladder below the current State has done to the Threads it names.
 *
 * CUMULATIVE, and the last mention wins. A Phase at 50 that reveals a Thread has
 * still revealed it at State 90, because the situation that opened the door did
 * not un-happen; a Phase at 80 that locks the same Thread shuts it again, because
 * it is the later word on the subject. Within one Phase a Thread named in both
 * lists is locked — withholding wins, as it does everywhere else here — though
 * the pickers refuse to author that, so it only ever fires on a hand-edited world.
 */
export function phaseGate(plot) {
    const revealed = [];
    const locked = [];
    const verdict = new Map();

    for (const phase of reachedPhases(plot)) {
        for (const id of phase.revealNodeIds ?? []) verdict.set(id, 'reveal');
        for (const id of phase.lockNodeIds ?? []) verdict.set(id, 'lock');
    }

    for (const [id, which] of verdict) (which === 'lock' ? locked : revealed).push(id);
    return { revealed, locked };
}

/**
 * The prerequisites this Thread is still owed.
 *
 * An id that resolves to nothing is not owed. A deleted Thread is swept out of
 * every prereq list by `state.mjs`, so this only fires on a world edited by hand
 * — and a requirement that no longer exists cannot be met, so treating it as
 * outstanding would shut a Thread for good with nothing on screen to undo.
 */
export function unmetPrereqs(node, nodes) {
    const byId = new Map((nodes ?? []).map((n) => [n.id, n]));
    return (node?.prereqNodeIds ?? []).filter((id) => {
        const prereq = byId.get(id);
        return prereq ? prereq.status !== NODE_STATUS.CONCLUDED : false;
    });
}

/**
 * The whole question, answered once.
 *
 * `manual` is the GM's own switch — the stored `locked` status, which is what the
 * Thread editor writes and what it has always meant. A Phase's reveal list
 * CLEARS it, and that is the point of a reveal list: the GM authors a Thread shut
 * and names it in the Phase that opens it. A reveal does not clear a prerequisite
 * — the plan calls the two gates independent and they stay that way, or a GM who
 * revealed a Thread would silently be skipping the chain they built in front of
 * it.
 */
export function gateOf(node, plot, nodes) {
    const { revealed, locked } = phaseGate(plot);
    const revealedHere = revealed.includes(node?.id);
    const phaseLocked = locked.includes(node?.id);
    const manual = node?.status === NODE_STATUS.LOCKED;
    const unmet = unmetPrereqs(node, nodes);

    return {
        open: !phaseLocked && unmet.length === 0 && !(manual && !revealedHere),
        manual,
        revealed: revealedHere,
        phaseLocked,
        unmet
    };
}

/** A concluded Thread is finished, not shut: nothing here should re-close it. */
export const isShut = (node, plot, nodes) =>
    node?.status !== NODE_STATUS.CONCLUDED && !gateOf(node, plot, nodes).open;

// ── the dependency graph ─────────────────────────────────────────────────────
// An edge runs prerequisite -> dependent: `node.prereqNodeIds` names what must
// finish before this one may start.

/** Everything that requires this Thread, directly or through a chain. */
export function dependentsOf(nodeId, nodes) {
    const rows = nodes ?? [];
    const found = new Set();
    const queue = [nodeId];

    while (queue.length) {
        const current = queue.shift();
        for (const row of rows) {
            if (found.has(row.id)) continue;
            if (!(row.prereqNodeIds ?? []).includes(current)) continue;
            found.add(row.id);
            queue.push(row.id);
        }
    }
    return [...found];
}

/**
 * Would naming `prereqId` as a prerequisite of `nodeId` close a loop?
 *
 * It would if the candidate already waits on this Thread, at any depth — or if it
 * IS this Thread, which no amount of graph walking would catch.
 */
export const wouldCycle = (nodeId, prereqId, nodes) =>
    nodeId === prereqId || dependentsOf(nodeId, nodes).includes(prereqId);

/**
 * The Threads that can never open, because the chain in front of them never ends.
 *
 * Kahn's peel: strip every Thread whose prerequisites are all accounted for, and
 * repeat. What will not strip is either in a ring or waiting behind one — and
 * from the reader's side those are the same fact, so they are reported together
 * rather than split into a distinction nobody can act on differently.
 */
export function cyclesIn(nodes) {
    const rows = nodes ?? [];
    const known = new Set(rows.map((n) => n.id));
    const settled = new Set();

    let moved = true;
    while (moved) {
        moved = false;
        for (const row of rows) {
            if (settled.has(row.id)) continue;
            const waiting = (row.prereqNodeIds ?? [])
                .filter((id) => known.has(id) && !settled.has(id));
            if (waiting.length === 0) {
                settled.add(row.id);
                moved = true;
            }
        }
    }

    return rows.filter((n) => !settled.has(n.id)).map((n) => n.id);
}
