#!/usr/bin/env node
/**
 * logic/removal.mjs — what a deletion takes with it. `node tools/check-removal.mjs`
 *
 * This suite is here because removal.mjs is a COPY of the sweeps in state.mjs
 * `node.delete`, and a copy that drifts is worse than no report at all: a GM who
 * has read the list twice and found it complete will stop reading it, and the
 * third time is the one where the Asset quietly came loose. So every branch is
 * pinned against a fixture built to make each consequence happen for a different
 * reason, and the fixture is deliberately awkward — a dependent that is freed, a
 * dependent that is not, one held by a second requirement, one the GM shut by
 * hand, and one that already concluded and cannot be freed by anything.
 */

import {
    threadRemoval, plotRemoval, forceRemoval, assetRemoval
} from '../scripts/logic/removal.mjs';
import {
    normalizePlot, normalizeNode, normalizeForce, normalizeAsset, normalizeLogEntry
} from '../scripts/data/normalize.mjs';
import { NODE_STATUS } from '../scripts/constants.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nremoval.mjs\n');

// ── the fixture ──────────────────────────────────────────────────────────────
// n1 is the Thread being deleted. Everything else exists to have a different
// relationship to it.

const BOARD = {
    plots: [
        normalizePlot({
            id: 'p1', name: 'The Siege of Northwall', state: 60, stateMin: 0, stateMax: 100,
            forceIds: ['f1', 'f2'],
            phases: [
                { id: 'ph0', label: 'Calm', threshold: 0 },
                { id: 'ph1', label: 'Tense', threshold: 50, revealNodeIds: ['n9'] },
                // Names n1: this Phase loses a line when n1 goes.
                { id: 'ph2', label: 'Rain of Fire', threshold: 80, lockNodeIds: ['n1'] }
            ]
        }),
        normalizePlot({
            id: 'p2', name: 'The Long Road', state: 0, stateMin: 0, stateMax: 100,
            forceIds: ['f1'],
            // A Phase on a DIFFERENT Plot naming it. The sweep is board-wide and
            // this is the case a per-Plot report would miss.
            phases: [{ id: 'phA', label: 'Quiet', threshold: 0, revealNodeIds: ['n1'] }]
        })
    ],
    nodes: [
        normalizeNode({ id: 'n1', plotId: 'p1', name: 'Breach the Wall' }),
        // Waits on n1 alone, and on nothing else: the delete opens it.
        // Carries a contested pool for both Forces and an authored outcome for
        // one of them: the two things a Force delete takes that nothing else does.
        normalizeNode({
            id: 'n2', plotId: 'p1', name: 'Sack the Granary', prereqNodeIds: ['n1'],
            progress: { pool: 4, byForce: { f1: 3, f2: 1 } },
            outcomes: [{ forceId: 'f1', delta: 5, note: 'The granary burns.' }]
        }),
        // Waits on n1 AND on n9, which has not concluded: still shut afterwards.
        normalizeNode({
            id: 'n3', plotId: 'p1', name: 'Ride for the Capital', prereqNodeIds: ['n1', 'n9']
        }),
        // Waits on n1, but the GM shut it by hand and no Phase reveals it.
        normalizeNode({
            id: 'n4', plotId: 'p1', name: 'The Second Assault',
            prereqNodeIds: ['n1'], status: NODE_STATUS.LOCKED
        }),
        // Waited on n1 and is already finished. Nothing can free a conclusion.
        normalizeNode({
            id: 'n5', plotId: 'p1', name: 'Burn the Bridges',
            prereqNodeIds: ['n1'], status: NODE_STATUS.CONCLUDED, concludedBy: 'f1'
        }),
        normalizeNode({ id: 'n9', plotId: 'p1', name: 'Hold the Gate' })
    ],
    forces: [
        normalizeForce({ id: 'f1', name: 'The Iron Legion' }),
        normalizeForce({ id: 'f2', name: 'The Northwall Guard' })
    ],
    assets: [
        normalizeAsset({ id: 'a1', name: 'The Ram', forceId: 'f1', nodeId: 'n1', plotId: 'p1' }),
        normalizeAsset({ id: 'a2', name: 'The Granary', forceId: 'f2', nodeId: 'n2', plotId: 'p1' }),
        // Committed to the Plot rather than to a Thread: untouched by this delete.
        normalizeAsset({ id: 'a3', name: 'The Dragon', forceId: 'f1', plotId: 'p1' })
    ],
    log: [
        normalizeLogEntry({ id: 'l1', nodeId: 'n1' }),
        normalizeLogEntry({ id: 'l2', nodeId: 'n1' }),
        normalizeLogEntry({ id: 'l3', nodeId: 'n2' }),
        normalizeLogEntry({ id: 'l4' }),
        normalizeLogEntry({ id: 'l5', plotId: 'p1' }),
        normalizeLogEntry({ id: 'l6', forceId: 'f1' }),
        normalizeLogEntry({ id: 'l7', assetId: 'a3' })
    ]
};

const report = threadRemoval('n1', BOARD);

// ── what it is ───────────────────────────────────────────────────────────────
eq('a live id is found', report.found, true);
eq('and names the Thread', report.name, 'Breach the Wall');
eq('and the Plot it is on', report.plot, { id: 'p1', name: 'The Siege of Northwall' });
eq('and knows it is not a quiet deletion', report.isEmpty, false);

// ── the Assets ───────────────────────────────────────────────────────────────
eq('an Asset committed to it comes loose', report.assets.map((a) => a.name), ['The Ram']);
eq('and is named with the Force it goes back to', report.assets[0].forceName, 'The Iron Legion');
eq('an Asset on another Thread is not listed', report.assets.some((a) => a.id === 'a2'), false);
eq('nor is one committed to the Plot itself', report.assets.some((a) => a.id === 'a3'), false);

// ── the dependents ───────────────────────────────────────────────────────────
eq('every Thread that requires it is listed',
    report.dependents.map((d) => d.id), ['n2', 'n3', 'n4', 'n5']);
eq('and each carries the Plot it is on',
    report.dependents.every((d) => d.plotName === 'The Siege of Northwall'), true);

// The one that surprises a GM: deleting a requirement OPENS what was waiting.
eq('a Thread held only by this one is freed by the delete',
    report.dependents.find((d) => d.id === 'n2').frees, true);
eq('a Thread with a second unmet requirement is not',
    report.dependents.find((d) => d.id === 'n3').frees, false);
eq('nor is one the GM shut by hand',
    report.dependents.find((d) => d.id === 'n4').frees, false);
eq('a concluded Thread is marked as such',
    report.dependents.find((d) => d.id === 'n5').concluded, true);
eq('and is never reported as freed',
    report.dependents.find((d) => d.id === 'n5').frees, false);

// ── the Phases ───────────────────────────────────────────────────────────────
eq('a Phase that locks it loses the line',
    report.phases.filter((p) => p.locks).map((p) => [p.plotName, p.phaseLabel]),
    [['The Siege of Northwall', 'Rain of Fire']]);
eq('so does a Phase on another Plot that reveals it',
    report.phases.filter((p) => p.reveals).map((p) => [p.plotName, p.phaseLabel]),
    [['The Long Road', 'Quiet']]);
eq('a Phase that never named it is not listed', report.phases.length, 2);

// ── the chronicle ────────────────────────────────────────────────────────────
eq('the lines it appears in are counted, not swept', report.logCount, 2);

// ── the quiet cases ──────────────────────────────────────────────────────────
// n9 is the second requirement on n3 and is named by a Phase, so it is not
// quiet either — deliberately, because "nothing depends on this" has to be
// earned rather than assumed from a Thread looking unimportant.
const lonely = threadRemoval('n9', BOARD);
eq('a Thread with only a Phase and one dependent is still not a quiet delete',
    lonely.isEmpty, false);
eq('the Phase that reveals it is named', lonely.phases.map((p) => p.phaseLabel), ['Tense']);
eq('and the Thread that waits on it', lonely.dependents.map((d) => d.id), ['n3']);
eq('which is NOT freed, because n1 still holds it',
    lonely.dependents[0].frees, false);
eq('and nothing is committed to it', lonely.assets.length, 0);

// The genuinely quiet case: a Thread on a board where nothing names it.
const alone = threadRemoval('n9', { ...BOARD, plots: [], nodes: [BOARD.nodes[5]], assets: [] });
eq('a Thread nothing else touches is a quiet delete', alone.isEmpty, true);
eq('and says so with every list empty',
    [alone.assets.length, alone.dependents.length, alone.phases.length], [0, 0, 0]);

const missing = threadRemoval('nope', BOARD);
eq('a stale id reports rather than throws', missing.found, false);
eq('and reads as empty, so a caller need not branch twice', missing.isEmpty, true);
eq('an absent board is the same answer', threadRemoval('n1', undefined).found, false);

// ── the mirror ───────────────────────────────────────────────────────────────
// state.mjs `node.delete` performs exactly the three sweeps reported above. It
// cannot be imported here — it is a writer and would pull Foundry in — so the
// agreement is asserted the only way it can be: by naming what the operation
// does and checking the report says the same thing about the same fixture.
const sweptPrereqs = BOARD.nodes
    .filter((n) => (n.prereqNodeIds ?? []).includes('n1'))
    .map((n) => n.id);
eq('the report lists every prereq list the operation would strip',
    report.dependents.map((d) => d.id), sweptPrereqs);

const sweptAssets = BOARD.assets.filter((a) => a.nodeId === 'n1').map((a) => a.id);
eq('and every Asset the operation would release',
    report.assets.map((a) => a.id), sweptAssets);

const sweptPhases = BOARD.plots.flatMap((p) => p.phases
    .filter((ph) => ph.revealNodeIds.includes('n1') || ph.lockNodeIds.includes('n1'))
    .map((ph) => ph.id));
eq('and every Phase list it would edit', report.phases.length, sweptPhases.length);

// ── deleting a Plot ──────────────────────────────────────────────────────────
// The Plot report is the Thread report run for every Thread at once. What it has
// to get right is the difference between what dies and what merely comes loose.

const gone = plotRemoval('p1', BOARD);

eq('a Plot report names the Plot', [gone.found, gone.name],
    [true, 'The Siege of Northwall']);
eq('every Thread on it goes with it',
    gone.threads.map((t) => t.id), ['n1', 'n2', 'n3', 'n4', 'n5', 'n9']);
eq('and a concluded one is marked, because it is history being deleted',
    gone.threads.find((t) => t.id === 'n5').concluded, true);

eq('every Asset committed anywhere inside it comes loose',
    gone.assets.map((a) => a.id), ['a1', 'a2', 'a3']);
eq('including the one committed to the Plot rather than to a Thread',
    gone.assets.find((a) => a.id === 'a3').forceName, 'The Iron Legion');
eq('and none of them is deleted',
    gone.assets.every((a) => a.fate === 'released'), true);

eq('a Phase on another Plot naming one of these Threads is listed',
    gone.phases.map((p) => [p.plotName, p.phaseLabel]), [['The Long Road', 'Quiet']]);
eq('a Phase on the Plot being deleted is not — it goes with the Plot',
    gone.phases.some((p) => p.plotName === 'The Siege of Northwall'), false);

eq('the roster is counted, because the Forces themselves survive',
    gone.rosterCount, 2);
eq('its chronicle lines stay as written', gone.logCount, 1);
eq('and a Thread inside it is never reported as a dependent',
    gone.dependents.length, 0);

eq('a stale Plot id reports rather than throws', plotRemoval('nope', BOARD).found, false);

// A Thread in ANOTHER Plot waiting on one of the doomed ones. It cannot live in
// the fixture above without changing what threadRemoval('n1') is owed, so the
// cross-plot case gets a board of its own.
const CROSS = {
    plots: [
        normalizePlot({ id: 'q1', name: 'The Cause', state: 0 }),
        normalizePlot({ id: 'q2', name: 'The Consequence', state: 0 })
    ],
    nodes: [
        normalizeNode({ id: 'm1', plotId: 'q1', name: 'The Envoy Rides' }),
        normalizeNode({
            id: 'm2', plotId: 'q2', name: 'The Border Closes', prereqNodeIds: ['m1']
        })
    ],
    forces: [], assets: [], log: []
};

const across = plotRemoval('q1', CROSS);
eq('deleting a Plot frees a Thread in another Plot that waited on it',
    across.dependents.map((d) => [d.id, d.frees]), [['m2', true]]);
eq('and names the Plot that Thread lives on',
    across.dependents[0].plotName, 'The Consequence');

// ── deleting a Force ─────────────────────────────────────────────────────────
// The one delete that destroys rows the GM did not name.

const disbanded = forceRemoval('f1', BOARD);

eq('a Force report names the Force', [disbanded.found, disbanded.name],
    [true, 'The Iron Legion']);
eq('every Asset it raised is DELETED, not released',
    disbanded.assets.map((a) => [a.id, a.fate]), [['a1', 'deleted'], ['a3', 'deleted']]);
eq('and one standing on a Thread says where it was',
    disbanded.assets.find((a) => a.id === 'a1').nodeName, 'Breach the Wall');
eq('another Force\'s Asset is untouched',
    disbanded.assets.some((a) => a.id === 'a2'), false);

eq('every Plot it is cast in loses it',
    disbanded.plotsCast.map((p) => p.name), ['The Siege of Northwall', 'The Long Road']);

eq('a contested pool held for it vanishes with it',
    disbanded.contests.map((c) => [c.id, c.pool]), [['n2', 3]]);
eq('an authored outcome for it is dropped',
    disbanded.outcomes.map((o) => o.id), ['n2']);
eq('and a Thread it concluded keeps the conclusion but forgets whose it was',
    disbanded.credits.map((c) => c.id), ['n5']);

eq('its chronicle lines stay as written', disbanded.logCount, 1);
eq('and it is never a quiet delete when it owns anything', disbanded.isEmpty, false);

const other = forceRemoval('f2', BOARD);
eq('the other side of the contest is reported separately',
    other.contests.map((c) => [c.id, c.pool]), [['n2', 1]]);
eq('and it has no outcome of its own to lose', other.outcomes.length, 0);
eq('nor any conclusion to be forgotten for', other.credits.length, 0);

eq('a stale Force id reports rather than throws', forceRemoval('nope', BOARD).found, false);

// ── deleting an Asset ────────────────────────────────────────────────────────
// The shallowest report, and the one that exists to say what is NOT swept.

const ram = assetRemoval('a1', BOARD);
eq('an Asset report names the Asset and its owner',
    [ram.found, ram.name, ram.forceName], [true, 'The Ram', 'The Iron Legion']);
eq('and says which Thread it was standing on',
    [ram.commitment.nodeName, ram.commitment.plotName],
    ['Breach the Wall', 'The Siege of Northwall']);
eq('a committed Asset is never a quiet delete', ram.isEmpty, false);

const dragon = assetRemoval('a3', BOARD);
eq('one lent to a Plot at large names the Plot and no Thread',
    [dragon.commitment.nodeName, dragon.commitment.plotName],
    ['', 'The Siege of Northwall']);

const reserve = assetRemoval('a4', {
    ...BOARD,
    assets: [normalizeAsset({ id: 'a4', name: 'The Reserve', forceId: 'f1' })]
});
eq('an Asset in reserve has no commitment to report', reserve.commitment, null);
eq('and is the one genuinely quiet delete on the board', reserve.isEmpty, true);
eq('a stale Asset id reports rather than throws', assetRemoval('nope', BOARD).found, false);

// ── one shape, four reports ──────────────────────────────────────────────────
// falloutMarkup reads a single report shape. A field missing from one of the
// four would make the dialog print nothing rather than fail loudly, so the shape
// is asserted here instead.
const FIELDS = [
    'found', 'kind', 'id', 'name', 'threads', 'assets', 'dependents', 'phases',
    'plotsCast', 'contests', 'outcomes', 'credits', 'commitment', 'rosterCount',
    'logCount', 'isEmpty'
];
for (const [what, one] of [
    ['thread', report], ['plot', gone], ['force', disbanded], ['asset', ram]
]) {
    eq(`the ${what} report carries every field the reader looks for`,
        FIELDS.filter((f) => !(f in one)), []);
}
eq('and each says which kind it is',
    [report.kind, gone.kind, disbanded.kind, ram.kind],
    ['thread', 'plot', 'force', 'asset']);

// ── the mirror, for the three that were added later ──────────────────────────
// Same argument as above: these reports are copies of sweeps in state.mjs, so
// what the operation does is restated here and the report is checked against it.
const doomedByPlot = BOARD.nodes.filter((n) => n.plotId === 'p1').map((n) => n.id);
eq('the Plot report lists every Thread the operation would delete',
    gone.threads.map((t) => t.id), doomedByPlot);

const loosedByPlot = BOARD.assets
    .filter((a) => a.plotId === 'p1' || doomedByPlot.includes(a.nodeId))
    .map((a) => a.id);
eq('and every Asset it would set adrift', gone.assets.map((a) => a.id), loosedByPlot);

const killedByForce = BOARD.assets.filter((a) => a.forceId === 'f1').map((a) => a.id);
eq('the Force report lists every Asset the operation would delete',
    disbanded.assets.map((a) => a.id), killedByForce);

const uncast = BOARD.plots.filter((p) => p.forceIds.includes('f1')).map((p) => p.id);
eq('and every roster it would be struck from',
    disbanded.plotsCast.map((p) => p.id), uncast);

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
