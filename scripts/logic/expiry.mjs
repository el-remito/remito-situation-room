/**
 * How long a Thread has left, and which clock takes it away.
 *
 * Pure. No Foundry globals, no writes. `node`-importable, exercised by
 * tools/check-expiry.mjs.
 *
 * WHY THIS IS ITS OWN FILE. logic/progress.mjs answers how a Thread advances and
 * knows nothing about cycles; logic/economy.mjs answers what a cycle does and
 * knows nothing about Threads. A deadline is the one thing that is both, so it
 * sits between them and imports neither's opinions — `assetsOnTheClock` in
 * economy.mjs is the shape this is modelled on, because an Asset's condition
 * timer is the same problem already solved once: a countdown that belongs to one
 * clock among several, and has to be asked which.
 *
 * A DEADLINE IS NOT A MODE. It is not in `MODE_SHAPE` and it never will be. The
 * four modes answer how a Thread comes ON; this answers how it runs OUT, and the
 * Narrative Thread that tracks nothing at all can be given three cycles exactly
 * as readily as the clock can. That is also why there is no per-mode branch
 * anywhere below.
 *
 * WHAT RUNNING OUT DOES: nothing, by itself. `isExpired` is a reading, the way
 * `isFull` is a reading. The row says so, the cycle bill says so before it
 * happens and the pre-cycle check says so afterwards, and the GM presses the
 * button — because a window closing is a fact and what it means for the fiction
 * is a decision. Nothing on this board has ever concluded itself and this does
 * not start.
 */

import { EXPIRY_CLOCK, TURN_BEHAVIOUR, NODE_STATUS } from '../constants.mjs';

const int = (v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : 0;
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// ── readings ─────────────────────────────────────────────────────────────────

/** How long this Thread was given. Never below one — a deadline of nothing is not one. */
export const expirySize = (node) => Math.max(1, int(node?.expirySize) || 1);

/** How much of it has been spent. */
export const expirySpent = (node) => Math.max(0, int(node?.progress?.expiry));

/**
 * Whether this Thread keeps a deadline at all.
 *
 * A CONCLUDED Thread does not, whatever its config says. Time cannot run out on
 * something that has already ended, and a cycle that kept counting one down
 * would eventually print "the assault ran out of time" about an assault that
 * succeeded three cycles ago.
 */
export const hasExpiry = (node) =>
    !!node?.expiryOn && node?.status !== NODE_STATUS.CONCLUDED;

/** Whether the time is gone. A reading, not an event — see the file header. */
export const isExpired = (node) => hasExpiry(node) && expirySpent(node) >= expirySize(node);

/** How much is left, clamped, for a row that counts down rather than up. */
export const expiryLeft = (node) => Math.max(0, expirySize(node) - expirySpent(node));

// ── which clock ──────────────────────────────────────────────────────────────

/**
 * Whether `plotId`'s cycle moves this Thread's clock.
 *
 * Pass null for the world's cycle, a Plot id for that Plot's own. The rule,
 * stated once and in one place:
 *
 *   FIAT   never. The GM's own control is the only thing that moves it, and that
 *          control is drawn whatever this says.
 *   WORLD  the world's cycle, whatever clock its Plot keeps. A Thread on an
 *          isolated Plot may still be counting down in the campaign's own time —
 *          the envoy's journey is measured in months and the ultimatum waiting
 *          at the end of it still expires on the day it said it would.
 *   PLOT   that Plot's own cycle, and ONLY while the Plot is actually keeping
 *          one. A Plot on the world's clock has no button of its own to press,
 *          and a Plot keeping NO clock is one the GM has said is not about
 *          elapsed time — so in both cases the deadline simply does not move.
 *          The editor does not offer the option outside an isolated Plot, so
 *          this only bites on a Plot changed afterwards; `isStranded` below is
 *          how the row says so rather than going quiet.
 */
export function ridesClock(node, plot, plotId = null) {
    if (!hasExpiry(node)) return false;
    const on = node.expiryClock ?? EXPIRY_CLOCK.WORLD;
    if (on === EXPIRY_CLOCK.FIAT) return false;
    if (on === EXPIRY_CLOCK.PLOT) {
        return !!plotId
            && plot?.id === plotId
            && (plot?.turnBehaviour ?? TURN_BEHAVIOUR.DEFAULT) === TURN_BEHAVIOUR.ISOLATED;
    }
    // WORLD, which is the world's cycle and nobody else's.
    return plotId === null;
}

/**
 * A deadline waiting on a clock that is not being kept.
 *
 * The GM set this Thread to its Plot's own cycle and has since put that Plot
 * back on the world's — or taken it off the calendar entirely — so the clock is
 * running on nothing. Reported rather than silently repaired, and reported to the
 * GM alone: it is a fact about their own authoring, like `shutBy`, and the fix is
 * a decision (move the Thread to the world's clock, or the Plot back onto its
 * own) rather than something this file may take on their behalf.
 */
export const isStranded = (node, plot) =>
    hasExpiry(node)
    && (node.expiryClock ?? EXPIRY_CLOCK.WORLD) === EXPIRY_CLOCK.PLOT
    && (plot?.turnBehaviour ?? TURN_BEHAVIOUR.DEFAULT) !== TURN_BEHAVIOUR.ISOLATED;

// ── one turn of the clock ────────────────────────────────────────────────────

/**
 * One cycle of one Thread's deadline, or null when nothing moves.
 *
 * Returns the fields that changed, exactly as `condition.mjs` `tick` does, so
 * the caller writes only the rows that actually moved and the two countdowns on
 * this board are applied by the same shape of loop.
 *
 * A clock already at its size does not move. It has run out; there is no such
 * thing as running out further, and a count climbing past the size would make
 * the reading on the row a lie about how overdue something is.
 */
export function tick(node) {
    if (!hasExpiry(node)) return null;
    const spent = expirySpent(node);
    const size = expirySize(node);
    if (spent >= size) return null;
    return { progress: { ...node.progress, expiry: spent + 1 } };
}

/**
 * The GM moving a deadline by hand: what the count BECOMES, given the number
 * they typed.
 *
 * DISPLAY DIRECTION IN, STORAGE DIRECTION OUT, and here it is unconditional —
 * `pushSign` performs the same inversion for a depleting Thread only when the
 * GM asked for one, because a Thread may be read either way. A deadline may
 * not: it is always read as what is LEFT, because nobody counts up to a door
 * closing.
 *
 * So the box the GM types into is filled in the direction the row moves — −1
 * takes a Cycle off the clock — and what is stored is how much has been SPENT,
 * which climbs. Getting this backwards makes the button labelled "spend a
 * Cycle" hand one back, and it fails silently: the reading simply drifts the
 * wrong way over an evening. That is the failure the sign convention at the top
 * of logic/progress.mjs was written about, and the reason this inversion is a
 * named function here rather than an expression at the write.
 *
 * Clamped at both ends: a deadline cannot be spent past its own size, and time
 * cannot be handed back that was never taken.
 */
export function spendBy(node, typed) {
    const size = expirySize(node);
    const raw = expirySpent(node) - Math.trunc(Number(typed) || 0);
    return Math.min(size, Math.max(0, raw));
}

/**
 * Every Thread whose deadline this cycle moves, as {node, change, expires} rows.
 *
 * `expires` is whether this is the turn it runs OUT, which is the same
 * distinction the Asset timers draw between counting down and arriving: only one
 * of the two is a development, and only one of them earns a line in the
 * chronicle or a sentence in the bill.
 *
 * Pass a plotId for one Plot's own cycle, or null for the world's.
 */
export function expiringOn(nodes, plots, plotId = null) {
    const byId = new Map((plots ?? []).map((p) => [p.id, p]));
    const rows = [];
    for (const node of nodes ?? []) {
        if (!ridesClock(node, byId.get(node.plotId) ?? null, plotId)) continue;
        const change = tick(node);
        if (!change) continue;
        rows.push({ node, change, expires: change.progress.expiry >= expirySize(node) });
    }
    return rows;
}

// ── what it is called ────────────────────────────────────────────────────────

/**
 * The word for a Thread that has run out: this Thread's own, else the world's,
 * else ''.
 *
 * Deliberately incomplete, exactly like `clockName` in economy.mjs: the final
 * fallback is a localized string and this layer has no i18n, so what comes back
 * is a word somebody typed or nothing at all, and the caller supplies the
 * built-in. ui/clock.mjs is where that join happens, beside the other clock
 * words, which keeps the one Foundry-shaped part of this at the call sites that
 * already localize instead of dragging game.i18n into a module node imports.
 */
export const expiryWord = (node, constants) =>
    text(node?.expiryLabel) || text(constants?.expiryLabel);
