/**
 * How a Thread advances, and what happens when it concludes.
 *
 * Pure. No Foundry globals, no writes — every function returns a new value and
 * data/state.mjs decides what to persist. `node`-importable, exercised by
 * tools/check-progress.mjs.
 *
 * SIGN CONVENTION, stated once and loudly: an outcome's `delta` is applied to the
 * Plot's State by ADDITION. A Force whose success should calm a Plot declares a
 * negative delta. Getting this backwards is the easiest mistake to make in this
 * file, and it fails silently — the bar just drifts the wrong way over a session.
 *
 * The four modes and what each actually tracks:
 *
 *   fiat       nothing. The GM concludes it when the fiction says so.
 *   invest     one shared pool against a threshold. Any Force may add to it.
 *   clock      discrete ticks against a segment count.
 *   contested  a separate pool per Force. Nobody's spending helps anyone else.
 *
 * invest auto-fills; contested never does. Contested is GM-adjudicated by design:
 * the standings inform the call, they do not make it, because "who won this" is a
 * fiction question and the numbers are only one input to it.
 */

import { ASSET_MODIFIER, MODE, NODE_STATUS } from '../constants.mjs';
import { effectiveValue } from './condition.mjs';

/** A Thread's mode, resolving the inherit case. `null` on the node means inherit. */
export const resolveMode = (node, plot) => node?.mode ?? plot?.defaultMode ?? MODE.FIAT;

// ── asset modifiers ──────────────────────────────────────────────────────────

// The one place an Asset's condition reaches the arithmetic. Every modifier
// question in this file goes through here, so a Damaged battalion halves its
// discount, halves its investment and halves its ticks — and a Suppressed one
// contributes nothing — without any of those three having to know that conditions
// exist. The Asset arrives with its rule already resolved; see condition.mjs for
// why that is the read funnel's job rather than an argument threaded down here.
const sumModifier = (assets, kind) => (assets ?? [])
    .filter((a) => a?.modifier?.kind === kind)
    .reduce((total, a) => total + effectiveValue(a, a.modifier.value), 0);

/**
 * What this Thread actually costs once committed Assets are counted.
 *
 * Never drops below 1. A Thread that costs nothing would conclude the instant it
 * was created, which reads as a bug rather than as a very well-supplied Force.
 */
export function effectiveThreshold(node, assets) {
    const reduction = sumModifier(assets, ASSET_MODIFIER.COST_REDUCTION);
    return Math.max(1, (node?.threshold ?? 1) - reduction);
}

/** Extra progress each contribution carries, from Assets committed to this Thread. */
export const investBonus = (assets) => sumModifier(assets, ASSET_MODIFIER.BONUS_INVEST);

/** Extra ticks each clock advance carries. */
export const tickBonus = (assets) => sumModifier(assets, ASSET_MODIFIER.BONUS_TICK);

// ── readings ─────────────────────────────────────────────────────────────────

export const investmentOf = (node, forceId) =>
    Number(node?.progress?.byForce?.[forceId]) || 0;

/** Total across every Force, for contested — the shared pool is a different field. */
export const contestedTotal = (node) =>
    Object.values(node?.progress?.byForce ?? {}).reduce((t, v) => t + (Number(v) || 0), 0);

/**
 * Contested standings, highest first. Ties keep the Forces' own order so the list
 * does not reshuffle on every render.
 */
export function standings(node, forceIds) {
    return (forceIds ?? [])
        .map((id, index) => ({ forceId: id, invested: investmentOf(node, id), index }))
        .sort((a, b) => (b.invested - a.invested) || (a.index - b.index))
        .map(({ forceId, invested }) => ({ forceId, invested }));
}

/** The Force currently ahead, or null when nobody has spent anything or it is a draw. */
export function leader(node, forceIds) {
    const table = standings(node, forceIds);
    if (table.length === 0 || table[0].invested === 0) return null;
    if (table.length > 1 && table[1].invested === table[0].invested) return null;
    return table[0].forceId;
}

/**
 * Whether the Thread has met its own bar.
 *
 * Contested is deliberately excluded: it never auto-concludes, no matter how far
 * ahead someone is. A GM presses the button.
 */
export function isFull(node, plot, assets) {
    const mode = resolveMode(node, plot);
    if (mode === MODE.CLOCK) return (node?.progress?.pool ?? 0) >= (node?.segments ?? 1);
    if (mode === MODE.INVEST) return (node?.progress?.pool ?? 0) >= effectiveThreshold(node, assets);
    return false;
}

/** Whether the GM may be offered a Conclude button at all. */
export const canConclude = (node) => node?.status !== NODE_STATUS.CONCLUDED;

// ── depleting ──────────────────────────────────────

/**
 * Which modes have a reading that can be run backwards.
 *
 * Every mode that keeps a number, which is every mode but `fiat`. Fiat tracks
 * nothing at all, so it has nothing to say in either direction.
 *
 * Contested was excluded in the first build, on the grounds that "what is left"
 * has no answer when two sides fill separate piles toward the same line. It
 * does have one: each side's own. Two Forces spending down their own stores,
 * each waiting for the other to run dry, is a shape tables actually play, and
 * it is exactly the shape the exclusion was refusing to draw. Every pile counts
 * down from the same threshold, and a side at nothing is a side that cannot go
 * on. Contested still never auto-concludes, so reaching zero is something the
 * GM reads rather than something that fires.
 */
export const canDeplete = (mode) => mode !== MODE.FIAT;

/**
 * Whether this Thread's reading counts down.
 *
 * DEPLETING IS A READING, NOT A MODE. Nothing about the arithmetic changes: the
 * pool still climbs, the threshold is still the line it climbs to, and
 * `isFull`, `chargeFor`, `advance` and every conclusion behave identically. What
 * changes is the direction the number is SAID in — 8 of 8 rations down to 0 is
 * the same Thread as 0 of 8 breaches up to 8, and a GM should be able to write
 * whichever one the table is living in.
 *
 * Three more modes would have been the other build, and they would have been
 * three copies: invest-down, clock-down and contested-down duplicating their
 * neighbours in every branch that asks what a Thread is, for no difference
 * below the label.
 */
export const depletes = (node, plot) =>
    !!node?.countdown && canDeplete(resolveMode(node, plot));

/**
 * The multiplier between the number a GM TYPES and the way the pool moves.
 *
 * −1 on a depleting Thread, 1 everywhere else, and this is the only place that
 * fact is named.
 *
 * The first build had the typed number travel in STORAGE direction — positive
 * always moved a Thread toward its conclusion, on whichever kind of Thread —
 * so that a delta in the chronicle would mean one thing everywhere. It bought
 * that consistency at the worst possible price: a GM typed +1 into a dialog
 * reading 5 / 8 and watched the row fall to 4. A control has to move the number
 * it is pointed at, and no amount of consistency underneath survives a board
 * that argues with the hand on it.
 *
 * So the typed number is in the direction the Thread is READ, and the inversion
 * happens once, at the write. What comes back out — the realised move that goes
 * into the chronicle — is turned the same way, so every figure a human ever
 * sees on a depleting Thread counts down. The pool underneath still only
 * climbs, and nothing else in this file needs to know.
 */
export const pushSign = (node, plot) => (depletes(node, plot) ? -1 : 1);

// ── transforms (pure: return the new progress, write nothing) ────────────────

/**
 * Add to the shared pool. Used by invest, and by fiat if a GM wants a bar anyway.
 * Clamped at zero — a Thread cannot be pushed into negative progress.
 */
export function addToPool(node, amount, assets) {
    const bonus = amount > 0 ? investBonus(assets) : 0;
    const pool = Math.max(0, (node?.progress?.pool ?? 0) + amount + bonus);
    return { ...node.progress, pool };
}

/** Advance or reverse a clock. Clamped to 0..segments; ticks cannot overflow. */
export function tickClock(node, delta, assets) {
    const bonus = delta > 0 ? tickBonus(assets) : 0;
    const raw = (node?.progress?.pool ?? 0) + delta + bonus;
    const pool = Math.min(node?.segments ?? 1, Math.max(0, raw));
    return { ...node.progress, pool };
}

/** Add to one Force's own pile, for contested. Clamped at zero. */
export function addForForce(node, forceId, amount, assets) {
    const bonus = amount > 0 ? investBonus(assets) : 0;
    const current = investmentOf(node, forceId);
    return {
        ...node.progress,
        byForce: { ...node.progress.byForce, [forceId]: Math.max(0, current + amount + bonus) }
    };
}

// ── conclusion ───────────────────────────────────────────────────────────────

/** The outcome a given Force concluding this Thread would produce, if one is declared. */
export const outcomeFor = (node, forceId) =>
    (node?.outcomes ?? []).find((o) => o.forceId === forceId) ?? null;

/**
 * What the Plot's State becomes if `forceId` concludes this Thread.
 *
 * Clamped to the Plot's declared range, so a large delta cannot push State somewhere
 * the bar has no way to draw. A Force with no declared outcome moves nothing —
 * that is a legitimate choice, not an error.
 */
export function stateAfterConclusion(plot, node, forceId) {
    const outcome = outcomeFor(node, forceId);
    const delta = outcome ? outcome.delta : 0;
    const min = plot?.stateMin ?? 0;
    const max = plot?.stateMax ?? 100;
    return Math.min(max, Math.max(min, (plot?.state ?? 0) + delta));
}

/**
 * Everything a conclusion changes, computed in one place so the caller can apply it
 * atomically and so the tests can assert on it without touching Foundry.
 *
 * @returns {{node: object, plotState: number, previousState: number, delta: number}}
 */
export function concludeThread(plot, node, forceId) {
    const previousState = plot?.state ?? 0;
    const plotState = stateAfterConclusion(plot, node, forceId);
    return {
        node: {
            ...node,
            status: NODE_STATUS.CONCLUDED,
            concludedBy: forceId ?? null
        },
        plotState,
        previousState,
        // The realised change, which is not the declared delta when State hit a bound.
        delta: plotState - previousState
    };
}

/**
 * Undo a conclusion. The State change is reversed by the delta that was ACTUALLY
 * applied, not the declared one — otherwise reopening a Thread that had been
 * clamped at a bound would invent State that never existed.
 */
export function reopenThread(plot, node, appliedDelta = 0) {
    const min = plot?.stateMin ?? 0;
    const max = plot?.stateMax ?? 100;
    return {
        node: { ...node, status: NODE_STATUS.ACTIVE, concludedBy: null },
        plotState: Math.min(max, Math.max(min, (plot?.state ?? 0) - appliedDelta))
    };
}
