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
 * **The row may name its own mask.** A bare "???" tells a player that something
 * is being withheld and nothing about what KIND of something, which is a worse
 * answer than the module can give: "Unknown activity — ???" says a Thread is
 * running. The default comes from the caller, because kinds are the app's idea
 * and not this module's, and `maskLabel` on the row itself beats it — so a GM
 * can call one Thread *Something at the east gate* without any call site here
 * gaining an argument to forget.
 *
 * @param {object} entity
 * @param {boolean} isGM
 * @param {string} maskedLabel  already-localized stand-in for this KIND of row
 */
export function projectIdentity(entity, isGM, maskedLabel = '???') {
    const masked = isMasked(entity, isGM);
    const own = typeof entity?.maskLabel === 'string' ? entity.maskLabel.trim() : '';
    return {
        masked,
        name: masked ? (own || maskedLabel) : (entity?.name ?? ''),
        description: masked ? '' : (entity?.description ?? '')
    };
}

/**
 * What the table is told in place of a reading, or ''.
 *
 * A masked row keeps its bar by default, and that is usually right: the table
 * knows something is being attempted and can see it moving. Sometimes it is
 * wrong — they have heard a rumour, not watched a siege — and then a bar is a
 * precision nobody has earned. So a mask note replaces the reading outright: no
 * bar, no pips, no contested standings, just the line the GM wrote.
 *
 * Writing the line IS the switch, which is why there is no second toggle beside
 * it. A GM who wants the bar back deletes the sentence, and a GM who wants the
 * bar gone has to say what the table hears instead — which is the question they
 * should be answering anyway.
 */
export function maskNoteOf(entity, isGM) {
    if (!isMasked(entity, isGM)) return '';
    return typeof entity?.maskNote === 'string' ? entity.maskNote.trim() : '';
}

/**
 * The safe projection of a progress reading.
 *
 * When values are withheld the bar still renders — the shape of the situation is
 * public even when its arithmetic is not — but current and total are dropped from
 * the context rather than sent and left unprinted.
 *
 * A DEPLETING Thread is inverted HERE and nowhere else. The stored progress
 * still climbs; what this hands back is what is LEFT, and the bar drains from
 * the right the way any reserve does. Doing it at the one funnel every reading
 * already passes through is what keeps it out of the templates: `node-row.hbs`
 * prints `current / total` over a bar of `percent` either way, and a second
 * markup branch for a depleting Thread would be a second thing to keep in step
 * with the first.
 */
export function projectProgress({ current, total, isGM, entity, countdown = false }) {
    // Measured off what is LEFT rather than as 100 minus what is spent, so the
    // width and the printed number are rounded from the same figure — and so a
    // total of zero comes back as an empty bar rather than a full one.
    const percent = countdown
        ? percentOf(leftOf(current, total), total)
        : percentOf(current, total);
    // The flag itself is NOT passed on. It has already done its work here, and
    // check-visibility asserts the exact key set of a withheld reading — which
    // is how a `current` sneaking back in gets caught. A field nothing renders
    // is not worth blunting that assertion for.
    if (!showValues(entity, isGM)) return { showValues: false, percent };
    return { showValues: true, current: countdown ? leftOf(current, total) : current, total, percent };
}

/**
 * What is left of `total` once `current` has been spent against it.
 *
 * Clamped both ways for the same reason `percentOf` clamps: a push past a full
 * clock is the ordinary way to say "and then some", and a reading of -2 rations
 * left is arithmetic showing through the fiction.
 */
export function leftOf(current, total) {
    const t = Math.max(0, Math.trunc(Number(total) || 0));
    const c = Math.min(t, Math.max(0, Math.trunc(Number(current) || 0)));
    return t - c;
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

/**
 * The Phase's tone, for a viewer who may not be allowed to know the Phase.
 *
 * Found in the M5 sweep. A masked Plot dropped its Phase LABEL and kept the tone
 * that label was painted in, so the State bar went red at "Rain of Fire" and the
 * table read the mood of a Phase whose name was being withheld. A tone is a
 * one-word summary of the thing the mask exists to withhold, so it goes with it.
 */
export const projectTone = (entity, isGM, tone) =>
    (isMasked(entity, isGM) ? 'neutral' : (tone || 'neutral'));

/**
 * The mode a viewer may know a Thread is running on, or null.
 *
 * Found in M5 round 3. A masked Thread was still wearing its mode chip, so a row
 * the table was told nothing about announced that it was Contested — which is
 * not a detail, it is the nature of the thing: contested means somebody is being
 * opposed, invest means somebody is paying, a clock means somebody is running
 * out of time. The mask exists to withhold exactly that.
 *
 * Returning null rather than a flag is the point: the caller has nothing left to
 * build a chip out of, and the shape it draws instead falls through to the one
 * plain bar every withheld reading already falls back to. A masked clock's pips
 * and a masked contest's column of named contenders name the mode as loudly as
 * the chip did.
 */
export const projectMode = (entity, isGM, mode) =>
    (isMasked(entity, isGM) ? null : (mode ?? null));

/**
 * Whether a viewer may see this Thread running DOWN.
 *
 * The same rule as projectMode, for the same reason, and it has to be stated
 * separately because the direction survives everything else the mask takes. A
 * masked Thread already gives up its chip and its shape so that every withheld
 * row on the board draws identically — and a bar that drains while its
 * neighbours fill is not identical. It also says the loudest thing a mode chip
 * could have said: this one is running out. So a masked Thread fills, like all
 * the others, whatever it is really counting.
 *
 * `hideValues` alone is a different question and keeps the drain: that setting
 * withholds arithmetic, and which way a bar moves is shape.
 */
export const projectCountdown = (entity, isGM, countdown) =>
    (isMasked(entity, isGM) ? false : !!countdown);

/**
 * A clock reading. The same as projectProgress, plus the pips.
 *
 * Also found in the M5 sweep, and the sharper of the two. A continuous bar is a
 * deliberate exception to hideValues — the SHAPE of a situation is public even
 * when its arithmetic is not, and a width is a fuzzy read. Pips are not: four
 * filled dots out of six is the exact number, printed as dots, and the table can
 * count them. So a clock whose numbers are withheld renders as a plain bar, like
 * every other Thread whose numbers are withheld, and the pips never leave here.
 */
export function projectClock({ current, total, isGM, entity, countdown = false }) {
    const reading = projectProgress({ current, total, isGM, entity, countdown });
    if (!reading.showValues) return { ...reading, pips: null };
    const size = Math.max(0, Math.trunc(Number(total) || 0));
    // `reading.current` is already what the viewer is being told — ticks spent,
    // or segments left. The pips are that number drawn as dots, so a depleting
    // clock empties from the right as it runs down, which is the same gesture as
    // its bar and the opposite of the one beside it.
    const filled = Math.min(size, Math.max(0, Math.trunc(Number(reading.current) || 0)));
    return { ...reading, pips: Array.from({ length: size }, (_, i) => ({ filled: i < filled })) };
}
