#!/usr/bin/env node
/**
 * logic/resolvable.mjs — what is standing at a line. `node tools/check-resolvable.mjs`
 *
 * This is what the cycle button asks before it moves anything, and the property
 * that matters most is the NEGATIVE one: an ordinary board, mid-campaign, with
 * nothing at a line, must produce an empty list. A check that cried wolf on
 * every press would be turned off by the second session, and turning it off
 * means turning off the one press that cannot be undone once anything else has
 * happened.
 *
 * So every reason is asserted in isolation, and each is asserted absent when the
 * thing it names has not happened.
 */

import * as R from '../scripts/logic/resolvable.mjs';
import { LIFECYCLE, MODE, NODE_STATUS } from '../scripts/constants.mjs';
import { normalizeNode, normalizePlot } from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nresolvable.mjs\n');

const PLOT = 'p-northwall';
const ROAD = 'p-road';
const LEGION = 'f-legion';
const GUARD = 'f-guard';

const plot = (extra = {}) => normalizePlot({
    id: PLOT, name: 'Northwall', state: 50, stateMin: 0, stateMax: 100,
    lifecycle: LIFECYCLE.ACTIVE, forceIds: [LEGION, GUARD], ...extra
});

const node = (extra = {}) => normalizeNode({
    id: 'n-1', plotId: PLOT, name: 'Siege Engines', threshold: 10, segments: 6, ...extra
});

const board = (nodes, plots = [plot()], assets = []) => ({ nodes, plots, assets });
const why = (rows) => rows.map((r) => r.reasons);
const named = (rows) => rows.map((r) => (r.node ?? r.plot).id);

// ── nothing to say ───────────────────────────────────────────────────────────
// The case that has to stay quiet, or the check gets turned off.
eq('a Thread part-way along says nothing',
    R.resolvableThreads(board([node({ mode: MODE.INVEST, progress: { pool: 4 } })])), []);
eq('an untouched Narrative Thread says nothing',
    R.resolvableThreads(board([node({ mode: MODE.FIAT })])), []);
eq('and a whole quiet board has nothing to report',
    R.anythingResolvable(board([node({ mode: MODE.INVEST, progress: { pool: 4 } })])), false);

// ── at its threshold ─────────────────────────────────────────────────────────
eq('an investment at its line is named',
    why(R.resolvableThreads(board([node({ mode: MODE.INVEST, progress: { pool: 10 } })]))),
    [['full']]);
eq('a clock at its last segment is named',
    why(R.resolvableThreads(board([node({ mode: MODE.CLOCK, progress: { pool: 6 } })]))),
    [['full']]);
eq('one segment short is not',
    R.resolvableThreads(board([node({ mode: MODE.CLOCK, progress: { pool: 5 } })])), []);
// Assets lower what a Thread costs, so they change where its line is — and this
// has to read the same effective number the row and the push dialog do.
eq('a committed Asset moves the line it is measured against',
    why(R.resolvableThreads(
        board([node({ mode: MODE.INVEST, progress: { pool: 8 } })], [plot()],
            [{ id: 'a', nodeId: 'n-1', modifier: { kind: 'costReduction', value: 2 } }])
    )), [['full']]);

// ── a contest at the line ────────────────────────────────────────────────────
// `isFull` deliberately never reports a contest, because a contest does not
// conclude itself — which makes this exactly the case a GM walks past.
eq('a contested side at the threshold is named',
    why(R.resolvableThreads(board([node({
        mode: MODE.CONTESTED, progress: { byForce: { [LEGION]: 10, [GUARD]: 3 } }
    })]))), [['contest']]);
eq('a contest with nobody there is not',
    R.resolvableThreads(board([node({
        mode: MODE.CONTESTED, progress: { byForce: { [LEGION]: 9, [GUARD]: 3 } }
    })])), []);
eq('and a Force not on the Plot does not count as a side',
    R.resolvableThreads(board([node({
        mode: MODE.CONTESTED, progress: { byForce: { 'f-stranger': 40 } }
    })])), []);

// ── complications at their limit ─────────────────────────────────────────────
const spoiled = (extra = {}) => node({
    mode: MODE.INVEST, consequenceOn: true, consequenceSize: 4, ...extra
});
eq('a full consequence is named',
    why(R.resolvableThreads(board([spoiled({ progress: { consequence: 4 } })]))),
    [['consequence']]);
eq('a mounting one is not',
    R.resolvableThreads(board([spoiled({ progress: { consequence: 3 } })])), []);
eq('and one side of a per-side track is enough',
    why(R.resolvableThreads(board([spoiled({
        mode: MODE.CONTESTED, consequencePerForce: true,
        progress: { consequenceByForce: { [LEGION]: 4, [GUARD]: 1 } }
    })]))), [['consequence']]);

// ── out of time ──────────────────────────────────────────────────────────────
eq('a deadline that has run out is named',
    why(R.resolvableThreads(board([node({
        mode: MODE.FIAT, expiryOn: true, expirySize: 3, progress: { expiry: 3 }
    })]))), [['expired']]);
eq('one with a cycle left is not',
    R.resolvableThreads(board([node({
        mode: MODE.FIAT, expiryOn: true, expirySize: 3, progress: { expiry: 2 }
    })])), []);

// Several at once, in the order this file asks them, so the dialog prints them
// the same way every time.
eq('a Thread can be standing at more than one line',
    why(R.resolvableThreads(board([node({
        mode: MODE.INVEST, progress: { pool: 10, consequence: 4, expiry: 2 },
        consequenceOn: true, consequenceSize: 4,
        expiryOn: true, expirySize: 2
    })]))), [['full', 'consequence', 'expired']]);

// ── what is never named ──────────────────────────────────────────────────────
eq('a concluded Thread is finished, not waiting',
    R.resolvableThreads(board([node({
        mode: MODE.INVEST, progress: { pool: 10 }, status: NODE_STATUS.CONCLUDED
    })])), []);
// A shut Thread cannot be concluded at all — state.mjs refuses it — so naming
// one here would point at a button the GM cannot press.
eq('a Thread the GM has locked is not offered',
    R.resolvableThreads(board([node({
        mode: MODE.INVEST, progress: { pool: 10 }, status: NODE_STATUS.LOCKED
    })])), []);
eq('nor is one waiting on a requirement',
    R.resolvableThreads(board([
        node({ id: 'n-need', name: 'first' }),
        node({ id: 'n-2', mode: MODE.INVEST, progress: { pool: 10 }, prereqNodeIds: ['n-need'] })
    ])), []);
eq('and not even an expired one behind a gate',
    R.resolvableThreads(board([node({
        mode: MODE.FIAT, status: NODE_STATUS.LOCKED,
        expiryOn: true, expirySize: 1, progress: { expiry: 1 }
    })])), []);
eq('a Thread on an archived Plot is off the board entirely',
    R.resolvableThreads(board(
        [node({ mode: MODE.INVEST, progress: { pool: 10 } })],
        [plot({ lifecycle: LIFECYCLE.ARCHIVED })]
    )), []);

// ── Plots ────────────────────────────────────────────────────────────────────
const ladder = [
    { id: 'ph-1', label: 'Quiet', threshold: 0 },
    { id: 'ph-2', label: 'Tense', threshold: 25 },
    { id: 'ph-3', label: 'Critical', threshold: 75 }
];

eq('a Plot with everything concluded is named',
    R.reasonsForPlot(plot({ state: 50, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.CONCLUDED }),
        node({ id: 'b', status: NODE_STATUS.CONCLUDED })
    ]), ['threadsDone']);
eq('one with a Thread still running is not',
    R.reasonsForPlot(plot({ state: 50, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.CONCLUDED }),
        node({ id: 'b', status: NODE_STATUS.ACTIVE })
    ]), []);
// A Plot nobody has written yet is not a Plot that has finished.
eq('a Plot with no Threads at all is not finished',
    R.reasonsForPlot(plot({ state: 50, phases: ladder }), []), []);

eq('State in the top rung is the end of the ladder',
    R.reasonsForPlot(plot({ state: 80, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.ACTIVE })
    ]), ['ladderEnd']);

// THE TWO ENDS ARE NOT SYMMETRICAL. A new Plot is seeded at its own floor, so
// every Plot in the world begins life in its lowest Phase — and this rule
// flagged all of them until the guard went in. The fixture's Long Road, twenty
// into a hundred with nothing concluded on it, was the row that caught it.
eq('a Plot sitting at the bottom because it has not started is NOT an end',
    R.reasonsForPlot(plot({ state: 10, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.ACTIVE })
    ]), []);
eq('and neither is a brand new one with no Threads at all',
    R.reasonsForPlot(plot({ state: 0, phases: ladder }), []), []);
// The same State, and now it means something: the situation subsided back to
// nothing, and a concluded Thread is the only evidence on the board that a
// history happened at all.
eq('but one that subsided back to the bottom is',
    R.reasonsForPlot(plot({ state: 10, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.CONCLUDED }),
        node({ id: 'b', status: NODE_STATUS.ACTIVE })
    ]), ['ladderEnd']);
// The top needs no such guard: reaching it always means something moved State
// there, so it is an arrival whether or not anything has concluded.
eq('the top rung needs no history behind it',
    R.reasonsForPlot(plot({ state: 90, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.ACTIVE })
    ]), ['ladderEnd']);
eq('the middle of the ladder is not',
    R.reasonsForPlot(plot({ state: 40, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.ACTIVE })
    ]), []);
// A GM who wrote one Phase wrote a label, not a finish line — and a ladder of
// one rung would otherwise report every Plot in the world as finished.
eq('a ladder of one rung is not an end',
    R.reasonsForPlot(plot({ state: 40, phases: [ladder[0]] }), [
        node({ id: 'a', status: NODE_STATUS.ACTIVE })
    ]), []);
eq('and a Plot with no ladder has no end to reach',
    R.reasonsForPlot(plot({ state: 40, phases: [] }), [
        node({ id: 'a', status: NODE_STATUS.ACTIVE })
    ]), []);
eq('both reasons can be true at once',
    R.reasonsForPlot(plot({ state: 90, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.CONCLUDED })
    ]), ['threadsDone', 'ladderEnd']);
// And at the other end, where the guard is satisfied by the same evidence that
// satisfies the first reason.
eq('and at the floor, once there is a history behind it',
    R.reasonsForPlot(plot({ state: 0, phases: ladder }), [
        node({ id: 'a', status: NODE_STATUS.CONCLUDED })
    ]), ['threadsDone', 'ladderEnd']);

// A Plot the GM has set down, answered or shelved wants no prompt about it.
for (const lifecycle of [LIFECYCLE.PAUSED, LIFECYCLE.RESOLVED, LIFECYCLE.ARCHIVED]) {
    eq(`a ${lifecycle} Plot is never offered`,
        R.reasonsForPlot(plot({ state: 90, phases: ladder, lifecycle }), [
            node({ id: 'a', status: NODE_STATUS.CONCLUDED })
        ]), []);
}

// ── scope ────────────────────────────────────────────────────────────────────
// A GM pressing one Plot's own cycle is not being asked about another Plot.
{
    const two = {
        plots: [plot(), normalizePlot({ id: ROAD, name: 'The Long Road', state: 20 })],
        nodes: [
            node({ id: 'n-here', mode: MODE.INVEST, progress: { pool: 10 } }),
            node({ id: 'n-there', plotId: ROAD, mode: MODE.INVEST, progress: { pool: 10 } })
        ],
        assets: []
    };
    eq('the world s cycle reads the whole board',
        named(R.resolvableThreads(two)).sort(), ['n-here', 'n-there']);
    eq('and a Plot s own reads only its own',
        named(R.resolvableThreads(two, { plotId: ROAD })), ['n-there']);
    eq('the Plot list scopes the same way',
        R.resolvablePlots(two, { plotId: ROAD }).map((r) => r.plot.id), []);
    eq('and the whole-board question answers for both',
        R.anythingResolvable(two), true);
}

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
