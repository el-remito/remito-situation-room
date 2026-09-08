#!/usr/bin/env node
/**
 * logic/cycle.mjs — how the count is read, and how one turn of it comes back.
 * `node tools/check-cycle.mjs`
 *
 * Two halves, and the interesting cases are at their edges.
 *
 * The READING is arithmetic over a list of marks, and the edges are the ones a
 * campaign actually hits: the cycle a Segment opens on, the cycle before it, the
 * stretch before anybody marked anything, and count zero, which is not a cycle at
 * all. An off-by-one at a boundary puts the GM a whole Segment out for the rest
 * of the campaign.
 *
 * The UNDO is a promise, and the cases here are the ones where the promise has
 * to be REFUSED. A revert that quietly did half its work would be worse than no
 * revert at all — the GM would believe the board had been put back and would
 * carry on from a state nobody had checked.
 */

import {
    reading, marks, isChaptered, nextMark, hasMark,
    record, refusal, canRevert, reverse, summary
} from '../scripts/logic/cycle.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\ncycle.mjs\n');

// ── the marks, repaired ──────────────────────────────────────────────────────

eq('an empty list is not a segmentation',
    [isChaptered(), isChaptered([]), isChaptered([{ at: 5 }])], [false, false, true]);

// The Settings list arrives in whatever order the rows were typed, and the
// reading walks it in order — so the repair, not the caller, owns the sorting.
eq('marks come back in cycle order',
    marks([{ at: 9 }, { at: 2 }, { at: 5 }]).map((m) => m.at), [2, 5, 9]);

// The later row wins, so retyping a name in the list is how a name is changed.
eq('two rows on one cycle are one mark, the last one typed',
    marks([{ at: 5, name: 'Early' }, { at: 5, name: 'The Siege' }]),
    [{ at: 5, name: 'The Siege' }]);

// Zero is not a cycle, and a Segment starting before the campaign says nothing
// that the implicit first Segment does not already say.
eq('a mark below the first cycle is dropped, not clamped',
    marks([{ at: 0 }, { at: -3 }, { at: 1 }]), [{ at: 1, name: '' }]);
eq('and so is anything that is not a row',
    marks([null, 'five', { at: 'x' }, { at: 4 }]), [{ at: 4, name: '' }]);
eq('a name is trimmed and defaults to nothing',
    marks([{ at: 2, name: '  Act Two  ' }, { at: 3 }]),
    [{ at: 2, name: 'Act Two' }, { at: 3, name: '' }]);

// ── not segmented ────────────────────────────────────────────────────────────

eq('with nothing marked, the reading is the bare count',
    reading(11, []), { chaptered: false, chapter: 0, cycle: 11, count: 11, name: '' });
eq('rubbish in the list reads as nothing marked', reading(4, 'later').chaptered, false);
eq('and rubbish in the count reads as nothing has happened',
    reading(null, [{ at: 5 }]),
    { chaptered: true, chapter: 1, cycle: 0, count: 0, name: '' });

// ── one mark ─────────────────────────────────────────────────────────────────

const one = (n) => {
    const r = reading(n, [{ at: 5 }]);
    return [r.chapter, r.cycle];
};

// The stretch before the earliest mark is Segment 1 without a mark of its own.
// A GM marking cycle 5 means "a new Segment starts here", not "the campaign
// starts here" — so cycles 1 to 4 have to land somewhere, and this is where.
eq('the cycles before the first mark are the first Segment',
    [1, 2, 3, 4].map(one), [[1, 1], [1, 2], [1, 3], [1, 4]]);

// The boundary. Getting this wrong by one puts every later reading a Segment out.
eq('the marked cycle OPENS the next Segment', one(5), [2, 1]);
eq('and the count runs on inside it', [6, 9].map(one), [[2, 2], [2, 5]]);

// Zero is not a cycle. It is the state of a world where the button has never
// been pressed, and it belongs to the Segment the first press will land in.
eq('nothing has happened yet reads as the first Segment', one(0), [1, 0]);
eq('the count itself is never rewritten', reading(9, [{ at: 5 }]).count, 9);

// ── the whole point: Segments of different lengths ───────────────────────────

const RUN = [{ at: 6, name: 'The Siege' }, { at: 9 }];
const run = (n) => {
    const r = reading(n, RUN);
    return [r.chapter, r.cycle];
};

// Five cycles, then three, then whatever the campaign runs to. No arithmetic
// relates the three, which is the reason marks exist at all.
eq('a Segment of five is followed by one of three',
    [5, 6, 8, 9, 14].map(run), [[1, 5], [2, 1], [2, 3], [3, 1], [3, 6]]);

// A Segment says its own name where it has one, and its number where it does not.
eq('a marked Segment carries the name it was given',
    [reading(7, RUN).name, reading(3, RUN).name, reading(9, RUN).name],
    ['The Siege', '', '']);

// The one thing a mark on cycle 1 is for: naming the stretch that needs no mark.
const NAMED_FIRST = [{ at: 1, name: 'The Gathering' }, { at: 4, name: 'The Siege' }];
eq('a mark on the first cycle names the first Segment rather than adding one',
    [1, 3, 4].map((n) => {
        const r = reading(n, NAMED_FIRST);
        return [r.chapter, r.cycle, r.name];
    }),
    [[1, 1, 'The Gathering'], [1, 3, 'The Gathering'], [2, 1, 'The Siege']]);

// ── where the next one goes ──────────────────────────────────────────────────

// A Segment opens ON a cycle, so the mark lands on the one the board is standing
// on. There is no cycle 0 for anything to open on, so a board that has never
// turned marks the cycle the first press will produce.
eq('the mark lands on the cycle the board is standing on',
    [0, 1, 9].map(nextMark), [1, 1, 9]);
eq('and a cycle already marked says so',
    [hasMark(RUN, 6), hasMark(RUN, 7), hasMark([], 1)], [true, false, false]);

// ── the record ───────────────────────────────────────────────────────────────

const REC = record({
    count: 7,
    forces: [{ id: 'f1', resources: 5 }, { id: 'f2', resources: 0 }],
    plots: [{ id: 'p1', turnCount: 7 }],
    assets: [{ id: 'a1', condition: 'recovering', conditionCycles: 1, plotId: null, nodeId: null }],
    logIds: ['L2', 'L1']
});

eq('the record is the world’s clock unless a Plot is named', REC.plotId, null);
eq('it holds the values as they STOOD, not the deltas',
    REC.forces, [{ id: 'f1', resources: 5 }, { id: 'f2', resources: 0 }]);

// The reason it is values and not arithmetic: this purse hit its floor, so the
// income that was "paid" is not what came out of it, and subtracting it back
// would invent Resources.
eq('a purse that stopped at its floor comes back to the floor',
    reverse(REC, { forces: [{ id: 'f2', resources: 0 }] }).forces[0].resources, 0);

eq('an Asset keeps all four of the fields a timer can move',
    Object.keys(REC.assets[0]), ['id', 'condition', 'conditionCycles', 'plotId', 'nodeId']);

eq('an empty record is a shape, not a crash',
    record(), { plotId: null, count: 0, forces: [], plots: [], assets: [], logIds: [] });

// ── whether it may be used ───────────────────────────────────────────────────

const entry = (id) => ({ id });
const FRESH = [entry('L2'), entry('L1'), entry('old')];

eq('with the cycle still on top, nothing refuses it', refusal(REC, FRESH), '');
eq('and canRevert says the same', canRevert(REC, FRESH), true);

// The common refusal, and the one that matters. Anything recorded after the
// cycle is stamped with the new count; putting the count back would leave the
// chronicle claiming a development in a cycle that had not started.
eq('a push since the cycle refuses the revert',
    refusal(REC, [entry('new'), ...FRESH]), 'since');

// Even one of the two. A second Plot cycle pressed after this one is exactly
// the case a GM would expect to be allowed, and it is exactly the case that
// makes the record stale.
eq('one line since is enough',
    refusal(REC, [entry('newer'), entry('L2'), entry('L1')]), 'since');

eq('a chronicle that was forgotten takes the undo with it',
    refusal(REC, []), 'gone');
eq('and so does one where only some of the lines survive the limit',
    refusal(REC, [entry('L2')]), 'since');

eq('a board that has never turned a cycle has nothing to take back',
    refusal(null, FRESH), 'none');
eq('nor has one whose record was already used',
    refusal(record({ logIds: [] }), FRESH), 'none');
eq('canRevert refuses every one of those',
    [null, record({ logIds: [] })].map((u) => canRevert(u, FRESH)), [false, false]);

// ── putting it back ──────────────────────────────────────────────────────────

const BOARD = {
    forces: [
        { id: 'f1', name: 'Legion', resources: 8 },
        { id: 'f2', name: 'Guild', resources: 0 },
        { id: 'f3', name: 'Court', resources: 4 }
    ],
    plots: [
        { id: 'p1', name: 'Northwall', turnCount: 8 },
        { id: 'p2', name: 'The Road', turnCount: 3 }
    ],
    assets: [
        { id: 'a1', name: 'Ram', condition: 'ready', conditionCycles: 0, plotId: null, nodeId: null },
        { id: 'a2', name: 'Scouts', condition: 'ready', conditionCycles: 0, plotId: null, nodeId: null }
    ],
    log: [entry('L2'), entry('L1'), entry('old')],
    chapters: [{ at: 4, name: 'The Siege' }, { at: 8, name: 'The Reckoning' }]
};

const BACK = reverse(REC, BOARD);

eq('the count goes back to what it was', BACK.count, 7);
eq('the purse the record names is restored', BACK.forces[0].resources, 5);
eq('a Force the record does not name is untouched',
    BACK.forces[2] === BOARD.forces[2], true);
eq('a Plot on the world’s clock is wound back', BACK.plots[0].turnCount, 7);
eq('one keeping its own is left alone', BACK.plots[1] === BOARD.plots[1], true);

eq('a timer goes back into the condition it was in',
    [BACK.assets[0].condition, BACK.assets[0].conditionCycles], ['recovering', 1]);
eq('an Asset the record does not name is handed straight through',
    BACK.assets[1] === BOARD.assets[1], true);

// The cycle did not happen, so the chronicle does not say it did. The
// alternative — leaving the line and writing a second one undoing it — is two
// lines of the GM's bookkeeping in a record the table reads.
eq('the lines the cycle wrote are removed', BACK.log, [entry('old')]);

// The one place the two halves of this file meet. A Segment cannot begin on a
// cycle that has been taken back, and the GM who marked cycle 8 did so on a
// board that had already turned it.
eq('a Segment opened on the cycle being taken back goes with it',
    BACK.chapters, [{ at: 4, name: 'The Siege' }]);
eq('a mark below the restored count is still true and stays',
    reverse(record({ count: 3, logIds: ['L2'] }), BOARD).chapters, []);
eq('a board with nothing marked comes back with nothing marked',
    reverse(REC, { ...BOARD, chapters: [] }).chapters, []);

// A timer that ran out and released the Asset has to be re-committed, or the
// undo would quietly disband an army that was standing at a wall.
const RELEASED = record({
    count: 3,
    assets: [{ id: 'a1', condition: 'ready', conditionCycles: 1, plotId: 'p1', nodeId: 'n1' }],
    logIds: ['L2']
});
const RECOMMITTED = reverse(RELEASED, BOARD).assets[0];
eq('and what it was committed to comes back with it',
    [RECOMMITTED.plotId, RECOMMITTED.nodeId], ['p1', 'n1']);

// ── what the confirmation prints ─────────────────────────────────────────────

const SAID = summary(REC, BOARD);

eq('the purse is named, with both numbers',
    SAID.purses, [{ id: 'f1', name: 'Legion', from: 8, to: 5 },
        { id: 'f2', name: 'Guild', from: 0, to: 0 }]);
eq('so is the Plot whose count moves',
    SAID.clocks, [{ id: 'p1', name: 'Northwall', from: 8, to: 7 }]);
eq('and the timer, by the condition it goes back into',
    SAID.timers,
    [{ id: 'a1', name: 'Ram', condition: 'recovering', cycles: 1, recommitted: false }]);
eq('the chronicle lines are counted, not listed', SAID.lines, 2);

// The only thing on the list the GM did by hand rather than by pressing the
// cycle, so it is the one they most need warning about.
eq('a Segment that stops existing is named',
    SAID.marks, [{ at: 8, name: 'The Reckoning' }]);
eq('and one that survives is not mentioned',
    summary(RELEASED, BOARD).marks.map((m) => m.at), [4, 8]);

eq('a timer that was released says so',
    summary(RELEASED, BOARD).timers[0].recommitted, true);

// A Force deleted since the cycle would otherwise print as a blank line saying
// nothing goes back to nobody.
eq('a row the board no longer holds is dropped rather than printed empty',
    summary(REC, { ...BOARD, forces: [] }).purses, []);

eq('nothing to take back says so rather than printing an empty list',
    summary(null, BOARD).found, false);

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
