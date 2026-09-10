/**
 * The chronicle: what has happened on the board, in the order it happened.
 *
 * Pure. `node`-importable, exercised by tools/check-log.mjs.
 *
 * An entry stores REFERENCES, never a finished sentence. Two reasons, and both
 * are load-bearing:
 *
 *  - The sentence has to be localizable, and a string frozen at write time is
 *    frozen in whatever language the GM's client was running.
 *  - Visibility is not fixed either. A Force public today may be hidden tomorrow,
 *    and it has to take its name back out of every line it appears in — which is
 *    only possible if the names are resolved at render time. A pre-rendered string
 *    would keep printing a name that is now secret.
 *
 * Resolving at render time is not the same as widening at render time, and the
 * difference is the `sealed` flag below: a line written while something it names
 * was withheld never opens up, however public that row later becomes.
 *
 * So this file builds and trims records. Turning one into a sentence is the
 * application's job, because that is where the viewer is known.
 */

import { ASSET_CONDITION, LOG_KIND, TRACK, VISIBILITY } from '../constants.mjs';

/** Re-exported so a caller needs one import to write an entry. */
export { LOG_KIND };

/**
 * How many entries the world keeps. The log is a running account of a campaign,
 * not an audit trail: it is read from the top, and an unbounded array would grow
 * inside a world setting that is replicated to every client on every change.
 */
export const LOG_LIMIT = 200;

const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * One record. Everything is optional except the kind, because the kinds differ in
 * what they are about: a cycle names no Thread, a release names no amount.
 */
export function entry({
    kind, turn = 0, at = 0, plotId = null, nodeId = null, forceId = null,
    assetId = null, amount = 0, cost = 0, note = '', isExample = false,
    visibility = VISIBILITY.VISIBLE, sealed = false,
    condition = ASSET_CONDITION.READY, track = TRACK.PROGRESS
} = {}) {
    return {
        kind,
        turn: int(turn),
        at: int(at),
        plotId: plotId ?? null,
        nodeId: nodeId ?? null,
        forceId: forceId ?? null,
        assetId: assetId ?? null,
        amount: int(amount),
        cost: int(cost),
        note: typeof note === 'string' ? note : '',
        // Which condition an Asset was put into, for the one kind that records it.
        // The key, not the label — the sentence is built at read time like every
        // other, and in the reader's language.
        condition: Object.values(ASSET_CONDITION).includes(condition)
            ? condition
            : ASSET_CONDITION.READY,
        // Which of a Thread's readings a push moved. Stored rather than derived,
        // because the track can be switched off afterwards and a line about
        // complications that no longer have a counter still happened.
        track: Object.values(TRACK).includes(track) ? track : TRACK.PROGRESS,
        // What the table reads of this one line. VISIBLE lets it say what moved,
        // MASKED keeps only the note, HIDDEN keeps the whole line off a player's
        // screen. Set per development, because the same push can be a public rout
        // or a quiet manoeuvre and only the GM pressing the button knows which.
        visibility: oneOfVisibility(visibility),
        // Whether anything this line names was withheld from the table at the
        // moment it was written. See `sealOf`.
        sealed: !!sealed,
        isExample: !!isExample
    };
}

const oneOfVisibility = (v) =>
    Object.values(VISIBILITY).includes(v) ? v : VISIBILITY.VISIBLE;

/**
 * Whether a line about these rows must be sealed.
 *
 * Visibility is not a property of the past, and for a while this module took that
 * one step too far: names were resolved against CURRENT visibility, so revealing a
 * Force handed the table every development it had ever been part of, including the
 * ones it was kept out of sight for. Reveal is a decision about what happens next,
 * not a confession.
 *
 * So a line records whether it was written in the open. One written while anything
 * it names was masked or hidden stays a note without attribution forever, however
 * public that row later becomes. The GM can still say what happened, in their own
 * words, when they choose to — that is what the note is.
 *
 * The seal only ever closes. A row hidden AFTER the fact still withdraws its name
 * from every line, because that is the render-time rule and it is unchanged.
 *
 * @param {Array<object|null>} rows  the entities the entry names
 */
export const sealOf = (rows) => (Array.isArray(rows) ? rows : [])
    .some((r) => !!r && r.visibility !== VISIBILITY.VISIBLE);

/**
 * Newest first, trimmed to the limit.
 *
 * Prepending rather than appending is deliberate: the reader wants the most recent
 * development, so the array is stored in the order it is read, and trimming is a
 * slice off the end rather than a shift off the front.
 */
export function append(entries, record, limit = LOG_LIMIT) {
    const rows = Array.isArray(entries) ? entries : [];
    return [record, ...rows].slice(0, Math.max(0, limit));
}

/** Entries about one Plot, still newest first. */
export const forPlot = (entries, plotId) =>
    (Array.isArray(entries) ? entries : []).filter((e) => e.plotId === plotId);

/**
 * The most recent `count` entries. A separate function from `append` so the view
 * can ask for a screenful without knowing how many the world keeps.
 */
export const recent = (entries, count = 30) =>
    (Array.isArray(entries) ? entries : []).slice(0, Math.max(0, count));
