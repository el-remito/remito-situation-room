/**
 * What state an Asset is in, and what that stops.
 *
 * Pure. `node`-importable, exercised by tools/check-condition.mjs.
 *
 * THE ONE DESIGN DECISION HERE. The conditions are a table the GM owns, not an
 * enum the module owns — so every consumer would otherwise need the table passed
 * to it, and `effectiveThreshold(node, assets)` would become
 * `effectiveThreshold(node, assets, conditions)` all the way down, with a default
 * argument quietly giving the wrong answer at any call site that forgot.
 *
 * Instead the table is applied ONCE, at the read funnel: settings.mjs `getAssets`
 * hands every Asset out with its resolved rule attached. Nothing downstream takes
 * a new argument, nothing can forget, and the rule cannot be stale because it is
 * computed on the same read that produced the row. `normalizeAsset` builds a fresh
 * object from known keys, so the attached rule is dropped again on write and never
 * reaches storage.
 */

import { ASSET_CONDITION, CONDITION_EFFECT, DEFAULT_CONDITIONS } from '../constants.mjs';

const int = (v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : 0;
};

/**
 * The row every unrecognised condition falls back to.
 *
 * Built from the table when it has one, so a GM who re-switches Ready gets what
 * they asked for, and from the module's own default when the table is empty or
 * has been emptied of it.
 */
export const fallbackOf = (conditions) =>
    (conditions ?? []).find((c) => c.id === ASSET_CONDITION.READY)
    ?? DEFAULT_CONDITIONS[0];

/**
 * What to print for a condition.
 *
 * A built-in that has never been renamed yields its i18n KEY, and a name the GM
 * typed yields itself. Both are safe to hand to `localize`, which returns an
 * unknown key unchanged — which is exactly the behaviour a custom label wants,
 * and is what lets this stay pure while still being localizable.
 */
export const labelOf = (row) => row?.label || row?.labelKey || '';

/** The rules row for one condition id. */
export const rowFor = (conditions, id) =>
    (conditions ?? []).find((c) => c.id === id) ?? fallbackOf(conditions);

/**
 * Attach each Asset's rule. Called at the read funnel and nowhere else.
 *
 * `isDefault` is what the board draws on: a badge on every row saying "Ready" has
 * spent the reader's attention on the case that means nothing happened.
 */
export function resolveConditions(assets, conditions) {
    const fallback = fallbackOf(conditions);
    return (assets ?? []).map((asset) => {
        const row = rowFor(conditions, asset.condition);
        return {
            ...asset,
            rule: { ...row, isDefault: row.id === fallback.id }
        };
    });
}

/** The rule of an already-resolved Asset, or the module default for a bare one. */
export const ruleFor = (asset) => asset?.rule ?? DEFAULT_CONDITIONS[0];

/**
 * One modifier value, scaled by the Asset's condition.
 *
 * HALF rounds toward zero: half of a 1-point discount is nothing, which is the
 * right answer, because rounding it up would make Damaged free on exactly the
 * Assets whose benefit was marginal to begin with.
 */
export function scaleOf(effect, value) {
    const n = int(value);
    if (effect === CONDITION_EFFECT.NONE) return 0;
    if (effect === CONDITION_EFFECT.HALF) return Math.trunc(n / 2);
    return n;
}

/** What this Asset's modifier is actually worth right now. */
export const effectiveValue = (asset, value) => scaleOf(ruleFor(asset).effect, value);

/** Whether the modifier is being scaled down at all — what the board strikes. */
export const isReduced = (asset) => ruleFor(asset).effect !== CONDITION_EFFECT.FULL;

/**
 * Whether this Asset may be committed, and whether it stays committed.
 *
 * Turning this off is not a display rule: state.mjs releases the Asset in the same
 * write that sets the condition, so a Thread never renders one that is out of play
 * and the release cannot be forgotten by a caller.
 */
export const isInPlay = (asset) => ruleFor(asset).inPlay !== false;

/** Whether the GM has said anything about it at all. */
export const isDefault = (asset) => ruleFor(asset).isDefault !== false;

/** Set aside rather than in hand — a Final condition, drawn in its own group. */
export const isFinal = (asset) => ruleFor(asset).isFinal === true;

// ── the timer ────────────────────────────────────────────────────────────────

/**
 * One Cycle of one Asset's timer.
 *
 * Returns the fields that changed, or null when nothing did — which is almost
 * every Asset almost every Cycle, and is what lets the caller write only the rows
 * that actually moved.
 *
 * At zero the Asset becomes its condition's successor and the timer stops. The
 * successor's own default `cycles` is deliberately NOT started: a table where
 * A becomes B and B becomes A would otherwise tick forever, and a GM who wants a
 * staged recovery is better served saying so than discovering it.
 *
 * A successor that is out of play releases the Asset, exactly as setting one by
 * hand does — the rule belongs to the condition, not to the button that set it.
 */
export function tick(conditions, asset) {
    const left = int(asset?.conditionCycles);
    if (left <= 0) return null;
    if (left > 1) return { conditionCycles: left - 1 };

    const row = rowFor(conditions, asset.condition);
    const next = row.becomes ? rowFor(conditions, row.becomes) : null;
    if (!next || next.id === asset.condition) return { conditionCycles: 0 };

    return {
        condition: next.id,
        conditionCycles: 0,
        ...(next.inPlay === false ? { plotId: null, nodeId: null } : {})
    };
}

/** Every Asset whose timer moves this Cycle, as {asset, change} pairs. */
export const ticking = (conditions, assets) => (assets ?? [])
    .map((asset) => ({ asset, change: tick(conditions, asset) }))
    .filter((row) => row.change !== null);
