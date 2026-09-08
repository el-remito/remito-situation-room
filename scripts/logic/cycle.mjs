/**
 * The clock, governed: how a running count is read, and how one turn of it is
 * put back.
 *
 * Pure. No Foundry globals, no DOM. `node`-importable, and exercised by
 * tools/check-cycle.mjs.
 *
 * Two jobs that look unrelated and are not. Both exist because the count on this
 * board is a number a GM presses a button to increase, and a number like that
 * needs two things a plain counter does not give: a way to READ it that matches
 * how the campaign is actually organised, and a way to UNDO the press.
 *
 * ── the reading ──
 *
 * `reading` turns one stored number into a Segment and a Cycle inside it, against
 * a list of MARKS: the counts at which the GM said a new Segment began. The count
 * itself is still the only thing that moves. A mark is a fact about the past —
 * the campaign turned a page on cycle 9 — and once written it never changes,
 * which is why this is a derivation and not a second calendar.
 *
 * Segments are therefore whatever length they actually were. A chapter that ran
 * five sessions and one that ran three are a mark five cycles along and a mark
 * three after that, and each carries its own name: a GM who calls the second one
 * "The Siege" gets that in the header and on every stamp inside it, rather than
 * the ordinal the arithmetic could have worked out on its own.
 *
 * The FIRST Segment is implicit. Cycles before the earliest mark belong to
 * Segment 1, which needs no mark of its own — a GM who marks cycle 9 means "a new
 * Segment starts here", not "the campaign starts here". A mark on cycle 1 is
 * allowed, and means only that the GM wanted to NAME that first stretch.
 *
 * ── the undo ──
 *
 * A cycle advance is the single most consequential button on the board: it pays
 * every Force, moves every Plot on the world's clock, and counts down every
 * running timer, none of which is on the screen it is pressed from. Pressing it
 * a second time by accident, or a session early, used to be unrecoverable —
 * there is no arithmetic that gets a purse back once it has been spent from.
 *
 * So the advance WRITES DOWN what it did, and reverting replays that record
 * backwards. Not a computed inverse: the record holds the values as they stood,
 * so a purse that hit its floor comes back to the floor rather than to what the
 * income says it should have been.
 *
 * ONE RECORD, AND ONLY WHILE IT IS STILL THE LAST THING THAT HAPPENED. This is
 * the rule that makes the record trustworthy rather than merely available.
 * Every entry the advance wrote must still be at the top of the chronicle; if
 * anything has been pushed, concluded, committed or advanced since, the revert
 * is refused. The reason is not squeamishness — every line written after the
 * cycle carries the new count as its stamp, so putting the count back would
 * leave the chronicle claiming developments in a cycle that had not begun.
 * Refusing is the honest answer, and the button says which refusal it is.
 *
 * The two halves meet in exactly one place: a revert that takes the count below a
 * mark takes the mark with it, because a Segment cannot begin on a cycle that did
 * not happen. See `reverse`.
 */

const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// ── the marks ────────────────────────────────────────────────────────────────

/**
 * The stored list of Segment marks, repaired: sorted, deduped, and cleaned of
 * anything that is not a cycle.
 *
 * Every reader goes through this rather than trusting the setting, because the
 * ORDER is what the reading depends on and a list edited in Settings arrives in
 * whatever order the rows were typed. Two marks on the same cycle are one mark —
 * the later row wins, so a GM who retypes a name gets the name they just typed.
 *
 * A mark below cycle 1 is dropped rather than clamped. Zero is not a cycle, and a
 * Segment beginning before the campaign did says nothing Segment 1 does not
 * already say.
 */
export function marks(raw) {
    const seen = new Map();
    for (const row of Array.isArray(raw) ? raw : []) {
        if (!row || typeof row !== 'object') continue;
        const at = int(row.at);
        if (at < 1) continue;
        seen.set(at, { at, name: text(row.name) });
    }
    return [...seen.values()].sort((a, b) => a.at - b.at);
}

/** Whether a stored list actually segments anything. */
export const isChaptered = (chapters) => marks(chapters).length > 0;

/**
 * A running count read as a Segment and the Cycle within it.
 *
 * `chapters` is the list of marks. Empty means the campaign is not segmented and
 * the reading is the bare count it always was.
 *
 * Cycles are numbered from one INSIDE a Segment, which is what makes the reading
 * match how anyone says it out loud: with a mark on cycle 5, cycle 8 is the
 * fourth cycle of the second Segment.
 *
 * Count zero is the one number that is not a cycle at all: nothing has happened
 * yet and the first press produces cycle 1. It reads as the zeroth Cycle of the
 * first Segment rather than as the last Cycle of a Segment before it, because a
 * board that opens on "Segment 0" would have a GM looking for the button that
 * starts Segment 1.
 *
 * @returns {{chaptered: boolean, chapter: number, cycle: number, count: number,
 *            name: string}}
 */
export function reading(count, chapters) {
    const n = Math.max(0, int(count));
    const list = marks(chapters);
    if (list.length === 0) {
        return { chaptered: false, chapter: 0, cycle: n, count: n, name: '' };
    }

    // The implicit first Segment. A GM marks where a page TURNED, so the stretch
    // before the earliest mark is Segment 1 whether or not anybody said so —
    // unless they did say so, to give it a name, in which case that row is it.
    const spans = list[0].at === 1 ? list : [{ at: 1, name: '' }, ...list];

    let i = 0;
    while (i + 1 < spans.length && spans[i + 1].at <= n) i += 1;
    const span = spans[i];

    return {
        chaptered: true,
        chapter: i + 1,
        // Zero cycles into a campaign that has not started, and otherwise how far
        // into this Segment the count has come, the opening cycle counting as one.
        cycle: n === 0 ? 0 : n - span.at + 1,
        count: n,
        name: span.name
    };
}

/**
 * Where the next mark would go: the cycle the board is standing on.
 *
 * A Segment opens ON a cycle, not between two of them, so pressing the button
 * while the board reads cycle 9 makes cycle 9 the first of the new Segment. A
 * board that has never turned a cycle marks cycle 1, which is the one the first
 * press will produce — there is no cycle 0 for anything to open on.
 */
export const nextMark = (count) => Math.max(1, int(count));

/** Whether that cycle is already marked. */
export const hasMark = (chapters, at) => marks(chapters).some((m) => m.at === int(at));

// ── the record ───────────────────────────────────────────────────────────────

/**
 * What one cycle advance did, in the only form that can put it back.
 *
 * Values AS THEY STOOD, never deltas. An upkeep that took a Force to zero and
 * stopped is not reversible by subtracting the income — the arithmetic would
 * invent Resources the Force never had — so what is stored is the number that
 * was in the purse, and reverting writes it straight back.
 *
 * `plotId` says which clock this was: null for the world's, an id for a Plot
 * keeping its own. There is only ever ONE record on the board, whichever clock
 * wrote it, because a revert is refused the moment anything else has happened —
 * so a second cycle of any kind is exactly the thing that invalidates the first,
 * and keeping a record per clock would only be keeping records that can never be
 * used.
 */
export function record({
    plotId = null, count = 0, forces = [], plots = [], assets = [], logIds = []
} = {}) {
    // This doubles as the read-time repair for the STORED record — normalizeTurn
    // hands whatever is in the setting straight to it — so every list is checked
    // rather than assumed. A world whose setting was hand-edited must still open.
    const rows = (v) => (Array.isArray(v) ? v : []).filter(
        (r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length
    );

    return {
        plotId: plotId ?? null,
        // What the world's count goes back TO. Unchanged for a Plot's own cycle,
        // which does not move the world's count at all.
        count: Math.max(0, int(count)),
        forces: rows(forces).map((f) => ({ id: f.id, resources: int(f.resources) })),
        plots: rows(plots).map((p) => ({ id: p.id, turnCount: Math.max(0, int(p.turnCount)) })),
        // Four fields, because a timer that runs out can do more than change a
        // condition: a successor that is out of play releases the Asset in the
        // same write (see logic/condition.mjs `tick`), and an undo that put the
        // condition back without the commitment would quietly disband an army.
        assets: rows(assets).map((a) => ({
            id: a.id,
            condition: a.condition ?? '',
            conditionCycles: Math.max(0, int(a.conditionCycles)),
            plotId: a.plotId ?? null,
            nodeId: a.nodeId ?? null
        })),
        // The chronicle lines this advance wrote, newest first. They are what
        // proves the record is still current, and they are removed on the way
        // back: a cycle that was taken back did not happen, and a chronicle that
        // says it began and then says it was undone is two lines of bookkeeping
        // where the table wanted none.
        logIds: (Array.isArray(logIds) ? logIds : [])
            .filter((v) => typeof v === 'string' && v.length)
    };
}

// ── whether it can still be used ─────────────────────────────────────────────

/**
 * Why a revert would be refused, as a bare reason, or '' when it would not be.
 *
 *   'none'   there is nothing to take back — no cycle since the world opened,
 *            or the last one has already been taken back.
 *   'gone'   the chronicle no longer holds the lines the record names. Clearing
 *            the chronicle takes the undo with it, because the proof that
 *            nothing has happened since is exactly those lines.
 *   'since'  something has been recorded since. This is the common one, and the
 *            reason it is refused rather than forced: every line written after
 *            the cycle is stamped with the new count, so putting the count back
 *            would leave the chronicle claiming developments in a cycle that had
 *            not started.
 *
 * Marking a Segment is deliberately NOT one of these. A mark writes no line,
 * because nothing happened — it changes how the count is READ, the way renaming
 * the clock does — and a GM who opens a chapter the moment they turn the cycle
 * would otherwise lose the undo to the very next thing they did.
 */
export function refusal(undo, log) {
    const ids = undo?.logIds ?? [];
    if (!undo || ids.length === 0) return 'none';

    const rows = Array.isArray(log) ? log : [];
    const named = new Set(ids);
    if (!rows.some((e) => named.has(e.id))) return 'gone';

    const top = rows.slice(0, ids.length);
    if (top.length !== ids.length || !top.every((e) => named.has(e.id))) return 'since';
    return '';
}

/** Whether the last cycle can still be taken back. */
export const canRevert = (undo, log) => refusal(undo, log) === '';

// ── putting it back ──────────────────────────────────────────────────────────

/**
 * Every collection the revert rewrites, as whole arrays the caller writes back.
 *
 * Rows the record does not name are handed through by reference, so the caller
 * can ask whether anything actually moved rather than rewriting a setting to say
 * nothing — the same test `advanceTurn` invites in economy.mjs.
 *
 * The marks are the one thing here that is not replayed from the record but
 * DERIVED from the count that comes back. A mark standing above the restored
 * count would open a Segment on a cycle that has been taken back, so it goes with
 * the cycle it opened. Marks below it are untouched, because they are still true.
 *
 * This does NOT check whether the revert is allowed. `refusal` answers that, and
 * the caller asks it first: a pure function that silently returned the board
 * unchanged would be indistinguishable from one that had worked.
 */
export function reverse(undo, {
    forces = [], plots = [], assets = [], log = [], chapters = []
} = {}) {
    const purses = new Map((undo?.forces ?? []).map((f) => [f.id, f]));
    const counts = new Map((undo?.plots ?? []).map((p) => [p.id, p]));
    const states = new Map((undo?.assets ?? []).map((a) => [a.id, a]));
    const drop = new Set(undo?.logIds ?? []);
    const back = Math.max(0, int(undo?.count));

    return {
        count: back,
        forces: forces.map((f) => (purses.has(f.id)
            ? { ...f, resources: purses.get(f.id).resources }
            : f)),
        plots: plots.map((p) => (counts.has(p.id)
            ? { ...p, turnCount: counts.get(p.id).turnCount }
            : p)),
        assets: assets.map((a) => {
            const was = states.get(a.id);
            if (!was) return a;
            return {
                ...a,
                condition: was.condition,
                conditionCycles: was.conditionCycles,
                plotId: was.plotId,
                nodeId: was.nodeId
            };
        }),
        log: log.filter((e) => !drop.has(e.id)),
        chapters: marks(chapters).filter((m) => m.at <= back)
    };
}

/**
 * What a revert would put back, named rather than counted — the list the
 * confirmation prints.
 *
 * Ids and numbers only: the condition an Asset goes back INTO is an id, because
 * what it is called is the GM's own table and localizing is the caller's job.
 * Rows the board no longer holds are dropped rather than reported as blanks, so
 * a Force deleted since the cycle does not appear as an empty line.
 */
export function summary(undo, {
    forces = [], plots = [], assets = [], chapters = []
} = {}) {
    if (!undo) {
        return {
            found: false, count: 0, purses: [], clocks: [], timers: [],
            marks: [], lines: 0
        };
    }

    const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
    const force = byId(forces);
    const plot = byId(plots);
    const asset = byId(assets);
    const back = Math.max(0, int(undo.count));

    return {
        found: true,
        plotId: undo.plotId ?? null,
        count: back,
        purses: (undo.forces ?? [])
            .filter((f) => force.has(f.id))
            .map((f) => ({
                id: f.id,
                name: force.get(f.id).name,
                from: int(force.get(f.id).resources),
                to: int(f.resources)
            })),
        clocks: (undo.plots ?? [])
            .filter((p) => plot.has(p.id))
            .map((p) => ({
                id: p.id,
                name: plot.get(p.id).name,
                from: Math.max(0, int(plot.get(p.id).turnCount)),
                to: Math.max(0, int(p.turnCount))
            })),
        timers: (undo.assets ?? [])
            .filter((a) => asset.has(a.id))
            .map((a) => ({
                id: a.id,
                name: asset.get(a.id).name,
                condition: a.condition,
                cycles: Math.max(0, int(a.conditionCycles)),
                // Only worth saying when it changed. A timer that merely counted
                // down is one line; one that ran out and took the Asset off what
                // it was committed to is a different sentence.
                recommitted: (asset.get(a.id).plotId ?? null) !== (a.plotId ?? null)
                    || (asset.get(a.id).nodeId ?? null) !== (a.nodeId ?? null)
            })),
        // A Segment opened on a cycle being taken back stops existing with it,
        // and that is worth its own line: it is the only thing on this list the
        // GM did by hand rather than by pressing the cycle.
        marks: marks(chapters).filter((m) => m.at > back),
        lines: (undo.logIds ?? []).length
    };
}
