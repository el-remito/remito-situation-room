/**
 * How this world's clock is SAID: which words, and whether the running count is
 * read as a bare number or as a Cycle inside a run of them.
 *
 * The one Foundry-shaped part of the clock, and a module of its own rather than a
 * method because of how many places say it. The badge in the header says it, the
 * Cockpit's standing line says it, every line of the chronicle is stamped with
 * it, the cycle dialogs say it twice, and the notice after a press repeats it.
 * Five callers across three files — and a count that read one way in the header
 * and another in the chronicle would look like a bug in the count rather than in
 * the sentence.
 *
 * logic/cycle.mjs does the arithmetic and knows no words; this joins it to them.
 * Nothing here decides anything.
 */

import { reading } from '../logic/cycle.mjs';
import { clockName } from '../logic/economy.mjs';
import { expiryWord } from '../logic/expiry.mjs';

const L = (key) => game.i18n.localize(key);
const own = (v) => (typeof v === 'string' ? v.trim() : '');

/** What this world calls the clock the whole board rides. */
export const worldClock = (board) =>
    clockName(board?.constants) || L('RSR.turn.globalLabel');

/** What one Plot calls the clock it keeps for itself. */
export const plotClock = (plot) => clockName(plot) || L('RSR.turn.plotLabel');

/** What this world calls a run of Cycles, when the run has no name of its own. */
export const runName = (board) =>
    own(board?.constants?.chapterLabel) || L('RSR.turn.segmentLabel');

/**
 * What a Thread that has run out is CALLED: its own word, the world's, or the
 * built-in one.
 *
 * Three steps rather than two, and it is the only word on this board with that
 * many, because a campaign's deadlines are rarely all the same kind of thing. A
 * window *Closed*, an ultimatum *Run Out*, a season *Passed* — the world sets
 * the one most of them are, and any one Thread may say otherwise.
 *
 * `expiryWord` does the two steps that need no i18n and stops; this supplies the
 * built-in, exactly as `worldClock` does for the clock's own name.
 */
export const expiryLabel = (board, node) =>
    expiryWord(node, board?.constants) || L('RSR.thread.expired');

/** Where this world's runs begin. Marks, not a length — see logic/cycle.mjs. */
export const runMarks = (board) => board?.turn?.chapters ?? [];

/**
 * What one run is CALLED: the name the GM gave it, or the word and its number.
 *
 * A named run drops the ordinal entirely rather than printing both. "The Siege 2"
 * is not something anyone says, and a GM who bothered to name a chapter has
 * already told the table which one it is.
 */
export function runLabel(board, r) {
    return r.name || game.i18n.format('RSR.turn.segmentNumber', {
        segment: runName(board), n: r.chapter
    });
}

/**
 * The world's count, said the way this campaign counts.
 *
 * Pass a count to read a past one — the chronicle stamps every line with the
 * count it was written on, and a line from cycle 4 has to read as cycle 4 in
 * whatever run cycle 4 fell in.
 *
 * A campaign with nothing marked gets exactly what it always got, which is why
 * the unsegmented sentence is its own key rather than the same one with a blank
 * in it: a leading space and a stray separator are what a template with optional
 * halves actually produces.
 */
export function cycleReading(board, count = board?.turn?.count ?? 0) {
    const r = reading(count, runMarks(board));
    const label = worldClock(board);
    return r.chaptered
        ? game.i18n.format('RSR.turn.readingSegmented', {
            segment: runLabel(board, r), label, turn: r.cycle
        })
        : game.i18n.format('RSR.turn.reading', { label, turn: r.cycle });
}

/** What the run OPENING on that cycle is called — the Settings list's own label. */
export const runLabelAt = (board, at) => runLabel(board, reading(at, runMarks(board)));
