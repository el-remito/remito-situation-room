/**
 * What a given viewer is allowed to know.
 *
 * Pure. `node`-importable, exercised by tools/check-visibility.mjs.
 *
 * THE RULE: withheld data must never reach a player's render context. Not hidden
 * with CSS, not rendered and then covered — absent. Anything that reaches the
 * context can be read out of the DOM by anyone who opens devtools, and a player
 * reading the GM's unrevealed plans out of the page source is the one failure this
 * module cannot come back from.
 *
 * So every projection here DROPS or REPLACES fields rather than flagging them, and
 * the templates receive only what is already safe to print.
 *
 * Two independent axes, deliberately:
 *   visibility  visible | masked (identity withheld) | hidden (existence withheld)
 *   hideValues  whether the numbers show, orthogonal to the above
 * A Thread can be visible-but-numberless: the table knows grain is being smuggled
 * and does not know how close it is.
 */

import { VISIBILITY } from '../constants.mjs';

export const isHidden = (entity, isGM) =>
    !isGM && entity?.visibility === VISIBILITY.HIDDEN;

export const isMasked = (entity, isGM) =>
    !isGM && entity?.visibility === VISIBILITY.MASKED;

/** Existence is public. */
export const canSee = (entity, isGM) => !isHidden(entity, isGM);

/** Drop everything the viewer must not know exists. */
export const visibleRows = (rows, isGM) =>
    (Array.isArray(rows) ? rows : []).filter((r) => canSee(r, isGM));

/** Whether numbers may be printed. A GM always sees their own bookkeeping. */
export const showValues = (entity, isGM) => isGM || !entity?.hideValues;

/**
 * The safe projection of one entity's identity.
 *
 * A masked entity keeps its shape — the row still renders, so the table knows
 * something is there — but loses its name and description entirely. They are
 * replaced, not blanked and not passed through, because a blank field still
 * carries the original in the context object it came from.
 *
 * @param {object} entity
 * @param {boolean} isGM
 * @param {string} maskedLabel  already-localized stand-in, e.g. "???"
 */
export function projectIdentity(entity, isGM, maskedLabel = '???') {
    const masked = isMasked(entity, isGM);
    return {
        masked,
        name: masked ? maskedLabel : (entity?.name ?? ''),
        description: masked ? '' : (entity?.description ?? '')
    };
}

/**
 * The safe projection of a progress reading.
 *
 * When values are withheld the bar still renders — the shape of the situation is
 * public even when its arithmetic is not — but current and total are dropped from
 * the context rather than sent and left unprinted.
 */
export function projectProgress({ current, total, isGM, entity }) {
    if (!showValues(entity, isGM)) {
        return { showValues: false, percent: percentOf(current, total) };
    }
    return { showValues: true, current, total, percent: percentOf(current, total) };
}

/** Rounded so a re-render does not churn the DOM over a fractional pixel. */
export function percentOf(current, total) {
    const t = Number(total);
    if (!Number.isFinite(t) || t <= 0) return 0;
    const c = Math.min(t, Math.max(0, Number(current) || 0));
    return Math.round((c / t) * 100);
}

/**
 * Whether a Force may be named on a Plot's roster. Masked Forces render as an
 * anonymous marker so the table can count sides without knowing who they are.
 */
export function projectForceChip(force, isGM, maskedLabel = '???') {
    if (isHidden(force, isGM)) return null;
    const { masked, name } = projectIdentity(force, isGM, maskedLabel);
    return { id: masked ? null : force.id, name, masked };
}
