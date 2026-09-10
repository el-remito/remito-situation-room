/**
 * What is standing at its line, waiting to be resolved.
 *
 * Pure. No Foundry globals, no writes. `node`-importable, exercised by
 * tools/check-resolvable.mjs.
 *
 * WHY THIS EXISTS. The cycle button is the loudest press on this board and it
 * looked at nothing. It pays every Force, winds every Plot and counts down every
 * timer without once asking whether something was already standing at its line —
 * and every one of those effects is somewhere the GM is not looking. A GM who
 * meant to conclude the assault before turning the cycle found out afterwards,
 * by which point the assault had spent a Cycle of its deadline and the purses had
 * moved.
 *
 * SO THIS IS A WARNING, NOT A GATE. It names what could be resolved first and
 * the press goes through on confirm. The board has never concluded anything on
 * its own and this does not start: "ready" is a reading, and whether a reading
 * means the thing is over is a fiction question. Refusing the cycle would be
 * answering it on the GM's behalf.
 *
 * EVERY ROW CARRIES ITS REASON. "Three things could be resolved" is not
 * something a GM can act on at the moment of pressing — they need to know that
 * the assault is at its threshold, the ford has run out of time, and the Long
 * Road has nothing left running on it, because those are three different
 * decisions and two of them may be fine.
 */

import { LIFECYCLE, MODE, NODE_STATUS } from '../constants.mjs';
import {
    resolveMode, isFull, effectiveThreshold, investmentOf, consequenceFull
} from './progress.mjs';
import { isExpired } from './expiry.mjs';
import { gateOf } from './gating.mjs';
import { phaseFor } from './state-track.mjs';

/**
 * The reasons a Thread can be standing at its line, as bare ids. The caller
 * localizes; this layer has no i18n, like every other pure module here.
 */
export const REASON = {
    FULL: 'full',
    CONSEQUENCE: 'consequence',
    EXPIRED: 'expired',
    // Contested has no `isFull` of its own — it never auto-concludes — so a side
    // reaching the threshold is exactly the case a GM is most likely to walk
    // past, and exactly what this check is for.
    CONTEST: 'contest'
};

/** The reasons a Plot can be. */
export const PLOT_REASON = {
    THREADS_DONE: 'threadsDone',
    // State has climbed to the top rung of the ladder, or fallen to the bottom.
    // The GM built the ladder to say where this Plot ends, and it has got there.
    LADDER_END: 'ladderEnd'
};

/**
 * Every reason this Thread could be resolved, or [] when none.
 *
 * A SHUT THREAD IS NEVER NAMED, whatever its numbers read — with the deliberate
 * exception of nothing: a Thread behind a gate cannot be concluded at all (see
 * `node.conclude` in data/state.mjs, which refuses it), so offering it as
 * something to resolve first would be pointing at a button the GM cannot press.
 * A deadline on a shut Thread still runs out; it just is not a thing to do
 * anything about before pressing the cycle.
 */
export function reasonsFor(node, plot, assets, nodes) {
    if (!node || node.status === NODE_STATUS.CONCLUDED) return [];
    if (!gateOf(node, plot, nodes).open) return [];

    const out = [];
    if (isFull(node, plot, assets)) out.push(REASON.FULL);

    // Contested's own version of the same fact, which `isFull` deliberately
    // never reports because a contest does not conclude itself.
    if (resolveMode(node, plot) === MODE.CONTESTED) {
        const line = effectiveThreshold(node, assets);
        if ((plot?.forceIds ?? []).some((id) => investmentOf(node, id) >= line)) {
            out.push(REASON.CONTEST);
        }
    }

    if (consequenceFull(node, plot)) out.push(REASON.CONSEQUENCE);
    if (isExpired(node)) out.push(REASON.EXPIRED);
    return out;
}

/**
 * The Threads standing at a line, with the reasons each one is.
 *
 * `plotId` scopes it: null reads the whole board, which is what the world's
 * cycle moves, and an id reads that Plot alone, which is what its own button
 * moves. A GM pressing one Plot's cycle is not being asked about another Plot's
 * business.
 *
 * @returns {{node: object, plot: object|null, reasons: string[]}[]}
 */
export function resolvableThreads(board, { plotId = null } = {}) {
    const plots = new Map((board?.plots ?? []).map((p) => [p.id, p]));
    const nodes = board?.nodes ?? [];
    const rows = [];

    for (const node of nodes) {
        if (plotId && node.plotId !== plotId) continue;
        const plot = plots.get(node.plotId) ?? null;
        // An archived Plot is not on the board at all, so nothing standing on
        // it is worth interrupting a cycle for.
        if (plot?.lifecycle === LIFECYCLE.ARCHIVED) continue;
        const assets = (board?.assets ?? []).filter((a) => a.nodeId === node.id);
        const reasons = reasonsFor(node, plot, assets, nodes);
        if (reasons.length) rows.push({ node, plot, reasons });
    }
    return rows;
}

/**
 * Every reason this Plot could be resolved, or [].
 *
 * Only an ACTIVE Plot. One the GM has paused is one they have set down on
 * purpose, one already Resolved has been answered, and one Archived is off the
 * board — none of the three wants a prompt about finishing it.
 *
 * The two rules are the GM's own two ways of saying where a Plot ends. Either
 * every Thread on it has concluded — there is nothing left running — or State
 * has reached the end of the ladder they built to measure it. A Plot with no
 * Threads at all is not "all its Threads concluded": it is a Plot nobody has
 * written yet.
 */
export function reasonsForPlot(plot, nodes) {
    if (!plot || plot.lifecycle !== LIFECYCLE.ACTIVE) return [];
    const out = [];

    const own = (nodes ?? []).filter((n) => n.plotId === plot.id);
    const anyConcluded = own.some((n) => n.status === NODE_STATUS.CONCLUDED);
    if (own.length > 0 && own.every((n) => n.status === NODE_STATUS.CONCLUDED)) {
        out.push(PLOT_REASON.THREADS_DONE);
    }

    // Anchored on `phaseFor` rather than on the raw thresholds, so this agrees
    // with the Phase the board is actually chipping — the same reason
    // `reachedPhases` in gating.mjs is anchored there. A ladder of one rung is
    // both ends at once and is not an end at all, so it is excluded: a GM who
    // wrote a single Phase wrote a label, not a finish line.
    const phases = plot.phases ?? [];
    if (phases.length > 1) {
        const here = phaseFor(phases, plot.state ?? 0);
        const at = phases.findIndex((p) => p.id === here?.id);

        /**
         * THE TWO ENDS ARE NOT SYMMETRICAL, and assuming they were is the bug
         * this guard exists to fix.
         *
         * Reaching the TOP rung always means something moved State there, so it
         * is an arrival and worth saying.
         *
         * Sitting in the BOTTOM rung usually means nothing has happened yet. A
         * new Plot is seeded at its own floor, so every Plot in the world begins
         * life in its lowest Phase — and a check that named all of them would be
         * turned off inside a session, taking the useful half with it.
         *
         * So the floor counts only once this Plot has a HISTORY: at least one
         * Thread on it has concluded. "The situation subsided back to nothing"
         * and "the situation has not started" are the same reading of State and
         * different facts about the campaign, and a concluded Thread is the only
         * evidence on the board that tells them apart.
         */
        const top = at === phases.length - 1;
        const floor = at === 0 && anyConcluded;
        if (top || floor) out.push(PLOT_REASON.LADDER_END);
    }
    return out;
}

/**
 * The Plots standing at a line. Scoped the same way the Threads are.
 *
 * @returns {{plot: object, reasons: string[]}[]}
 */
export function resolvablePlots(board, { plotId = null } = {}) {
    const rows = [];
    for (const plot of board?.plots ?? []) {
        if (plotId && plot.id !== plotId) continue;
        const reasons = reasonsForPlot(plot, board?.nodes ?? []);
        if (reasons.length) rows.push({ plot, reasons });
    }
    return rows;
}

/** Whether the cycle has anything to say at all — the test the dialog branches on. */
export const anythingResolvable = (board, scope = {}) =>
    resolvableThreads(board, scope).length > 0 || resolvablePlots(board, scope).length > 0;
