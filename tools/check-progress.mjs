import * as P from '../scripts/logic/progress.mjs';
import { CONCLUDED_BY_CONSEQUENCE as CONSEQUENCE } from '../scripts/constants.mjs';
import { normalizeNode, normalizePlot, normalizeAsset } from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nprogress.mjs\n');

const LEGION = 'f-legion';
const GUARD = 'f-guard';

const plot = (extra = {}) => normalizePlot({
    name: 'Northwall', state: 50, stateMin: 0, stateMax: 100,
    defaultMode: 'fiat', forceIds: [LEGION, GUARD], ...extra
});

const node = (extra = {}) => normalizeNode({
    name: 'Siege Engines', threshold: 10, segments: 6,
    outcomes: [
        { forceId: LEGION, delta: 15, note: 'engines reach the wall' },
        { forceId: GUARD, delta: -15, note: 'burned in the yard' }
    ],
    ...extra
});

const asset = (kind, value) => normalizeAsset({ name: 'a', modifier: { kind, value } });

// ── mode resolution ──────────────────────────────────────────────────────────
eq('null mode inherits the plot', P.resolveMode(node({ mode: null }), plot({ defaultMode: 'clock' })), 'clock');
eq('explicit mode wins', P.resolveMode(node({ mode: 'invest' }), plot({ defaultMode: 'clock' })), 'invest');
eq('no plot falls back to fiat', P.resolveMode(node({ mode: null }), undefined), 'fiat');

// ── asset modifiers ──────────────────────────────────────────────────────────
eq('cost reduction lowers the threshold',
    P.effectiveThreshold(node(), [asset('costReduction', 2)]), 8);
eq('reductions stack',
    P.effectiveThreshold(node(), [asset('costReduction', 2), asset('costReduction', 3)]), 5);
eq('threshold never drops below 1',
    P.effectiveThreshold(node({ threshold: 3 }), [asset('costReduction', 99)]), 1);
eq('unrelated modifiers do not touch the threshold',
    P.effectiveThreshold(node(), [asset('bonusInvest', 5)]), 10);
eq('no assets is fine', P.effectiveThreshold(node(), undefined), 10);

// ── pools and clocks ─────────────────────────────────────────────────────────
eq('invest adds', P.addToPool(node({ progress: { pool: 4 } }), 3).pool, 7);
eq('bonusInvest rides along', P.addToPool(node({ progress: { pool: 4 } }), 3, [asset('bonusInvest', 2)]).pool, 9);
eq('bonus does NOT apply when removing',
    P.addToPool(node({ progress: { pool: 9 } }), -3, [asset('bonusInvest', 2)]).pool, 6);
eq('pool clamps at zero', P.addToPool(node({ progress: { pool: 1 } }), -5).pool, 0);

eq('clock ticks', P.tickClock(node({ progress: { pool: 3 } }), 1).pool, 4);
eq('clock cannot overflow segments', P.tickClock(node({ progress: { pool: 5 } }), 4).pool, 6);
eq('clock cannot go negative', P.tickClock(node({ progress: { pool: 1 } }), -4).pool, 0);
eq('bonusTick rides along', P.tickClock(node({ progress: { pool: 1 } }), 1, [asset('bonusTick', 2)]).pool, 4);

eq('contested keeps piles separate',
    P.addForForce(node({ progress: { pool: 0, byForce: { [LEGION]: 6 } } }), GUARD, 3).byForce,
    { [LEGION]: 6, [GUARD]: 3 });
eq('contested clamps at zero',
    P.addForForce(node({ progress: { byForce: { [LEGION]: 1 } } }), LEGION, -5).byForce[LEGION], 0);

// ── standings ────────────────────────────────────────────────────────────────
const contested = node({ mode: 'contested', progress: { pool: 0, byForce: { [LEGION]: 6, [GUARD]: 3 } } });
eq('standings sort high to low',
    P.standings(contested, [GUARD, LEGION]).map((s) => s.forceId), [LEGION, GUARD]);
eq('leader is the one ahead', P.leader(contested, [LEGION, GUARD]), LEGION);
eq('a draw has no leader',
    P.leader(node({ progress: { byForce: { [LEGION]: 4, [GUARD]: 4 } } }), [LEGION, GUARD]), null);
eq('nobody spending has no leader',
    P.leader(node({ progress: { byForce: {} } }), [LEGION, GUARD]), null);

// ── fullness: contested NEVER auto-concludes ─────────────────────────────────
eq('invest fills at threshold',
    P.isFull(node({ mode: 'invest', progress: { pool: 10 } }), plot()), true);
eq('invest short of threshold', P.isFull(node({ mode: 'invest', progress: { pool: 9 } }), plot()), false);
eq('invest fills earlier with a cost reduction',
    P.isFull(node({ mode: 'invest', progress: { pool: 8 } }), plot(), [asset('costReduction', 2)]), true);
eq('clock fills at segments', P.isFull(node({ mode: 'clock', progress: { pool: 6 } }), plot()), true);
eq('contested never auto-fills, however far ahead',
    P.isFull(node({ mode: 'contested', progress: { byForce: { [LEGION]: 999 } } }), plot()), false);
eq('fiat never auto-fills', P.isFull(node({ mode: 'fiat', progress: { pool: 999 } }), plot()), false);

// ── conclusion and the sign convention ───────────────────────────────────────
eq('positive delta raises State', P.stateAfterConclusion(plot(), node(), LEGION), 65);
eq('negative delta lowers State', P.stateAfterConclusion(plot(), node(), GUARD), 35);
eq('a Force with no declared outcome moves nothing',
    P.stateAfterConclusion(plot(), node(), 'f-nobody'), 50);
eq('State clamps at the top', P.stateAfterConclusion(plot({ state: 95 }), node(), LEGION), 100);
eq('State clamps at the bottom', P.stateAfterConclusion(plot({ state: 5 }), node(), GUARD), 0);

const done = P.concludeThread(plot(), node(), LEGION);
eq('conclusion marks status', done.node.status, 'concluded');
eq('conclusion records the winner', done.node.concludedBy, LEGION);
eq('conclusion reports the realised delta', done.delta, 15);

const clamped = P.concludeThread(plot({ state: 95 }), node(), LEGION);
eq('realised delta is the CLAMPED one, not the declared one', clamped.delta, 5);

// Reopening must reverse what was actually applied, or a clamped conclusion
// invents State on the way back.
const reopened = P.reopenThread(plot({ state: 100 }), clamped.node, clamped.delta);
eq('reopen reverses the applied delta', reopened.plotState, 95);
eq('reopen clears the winner', reopened.node.concludedBy, null);
eq('reopen reactivates', reopened.node.status, 'active');

// ── depleting ───────────────────────────────────────────────────────────
// The rule is which modes keep a number at all, which is every one but fiat. The
// direction changes nothing about the arithmetic, which is the half most worth
// asserting: a depleting Thread fills and concludes exactly like the one beside
// it, and the sign only ever turns around at the edge.

eq('a clock can deplete', P.canDeplete('clock'), true);
eq('so can an investment', P.canDeplete('invest'), true);
eq('a narrative Thread has no reading to reverse', P.canDeplete('fiat'), false);
eq('and so can a contest, one reserve per side', P.canDeplete('contested'), true);

const down = (over = {}) => ({ ...node(), countdown: true, ...over });
eq('a depleting clock depletes', P.depletes(down({ mode: 'clock' }), plot()), true);
eq('a depleting investment depletes', P.depletes(down({ mode: 'invest' }), plot()), true);
eq('the flag is ignored where it cannot mean anything',
    P.depletes(down({ mode: 'fiat' }), plot()), false);
eq('a depleting contest depletes', P.depletes(down({ mode: 'contested' }), plot()), true);
eq('a Thread without the flag never depletes',
    P.depletes({ ...node(), mode: 'clock' }, plot()), false);

// Inherit resolves before the question is asked, or a Thread left on inherit
// would be answering for its own null rather than for the Plot behind it.
eq('an inheriting Thread takes the mode it inherited',
    P.depletes(down({ mode: null }), plot({ defaultMode: 'clock' })), true);
eq('and inherits one that cannot deplete just as faithfully',
    P.depletes(down({ mode: null }), plot({ defaultMode: 'fiat' })), false);

// The point of the whole design: nothing below the label moves.
const FULL = { mode: 'clock', segments: 6, progress: { pool: 6, byForce: {} } };
eq('a depleting clock is full at exactly the same place',
    P.isFull(down(FULL), plot(), []), P.isFull({ ...node(), ...FULL }, plot(), []));
eq('and a depleting contest still never concludes itself',
    P.isFull(down({ mode: 'contested' }), plot(), []), false);

// The one number that turns around, and the single place it is named. Everything
// a GM types is in the direction they can see; the pool underneath only climbs.
eq('an ordinary Thread types what it stores',
    P.pushSign({ ...node(), mode: 'clock' }, plot()), 1);
eq('a depleting one types the opposite',
    P.pushSign(down({ mode: 'clock' }), plot()), -1);
eq('a depleting contest types the opposite too',
    P.pushSign(down({ mode: 'contested' }), plot()), -1);
eq('the flag alone is not enough — fiat still types forward',
    P.pushSign(down({ mode: 'fiat' }), plot()), 1);

// Applied twice, the sign is a no-op. This is the whole safety of the scheme:
// what state.mjs turns around going in, it turns back coming out, so the
// chronicle prints the number the GM typed.
const roundTrip = (n, node_) => n * P.pushSign(node_, plot()) * P.pushSign(node_, plot());
eq('display in, display out', roundTrip(3, down({ mode: 'clock' })), 3);

// ── which questions each mode can answer ─────────────────────────────────────
// The table the editor branches on. Asserted per mode rather than as one object
// compare, so a failure names the field that moved.
eq('narrative asks for nothing', P.shapeOf(node({ mode: 'fiat' }), plot()),
    { threshold: false, segments: false, countdown: false, consequence: false, perForce: false });
eq('invest reads a threshold', P.shapeOf(node({ mode: 'invest' }), plot()).threshold, true);
eq('invest reads no segments', P.shapeOf(node({ mode: 'invest' }), plot()).segments, false);
eq('a clock reads segments', P.shapeOf(node({ mode: 'clock' }), plot()).segments, true);
eq('a clock reads no threshold', P.shapeOf(node({ mode: 'clock' }), plot()).threshold, false);
eq('only contested asks how many piles',
    Object.values(P.MODE_SHAPE).filter((s) => s.perForce).length, 1);
eq('every mode but narrative can go wrong',
    Object.values(P.MODE_SHAPE).filter((s) => s.consequence).length, 3);
eq('the shape follows an inherited mode',
    P.shapeOf(node({ mode: null }), plot({ defaultMode: 'clock' })).segments, true);
eq('and an unknown mode reads as narrative',
    P.shapeOf({ mode: 'nonsense' }, undefined).consequence, false);

// ── the consequence ──────────────────────────────────────────────────────────
const spoiled = (extra = {}) => node({
    consequenceOn: true, consequenceSize: 4,
    consequenceDelta: -20, consequenceNote: 'the works burn', ...extra
});

eq('a Thread with the toggle off keeps none',
    P.hasConsequence(node({ mode: 'invest' }), plot()), false);
eq('one with it on keeps one',
    P.hasConsequence(spoiled({ mode: 'invest' }), plot()), true);
// The one mode rule. Narrative tracks nothing by definition, so a counted
// complication on one is an Investment Thread that has not admitted what it is.
eq('narrative refuses it however the config reads',
    P.hasConsequence(spoiled({ mode: 'fiat' }), plot()), false);
eq('an inherited narrative refuses it too',
    P.hasConsequence(spoiled({ mode: null }), plot({ defaultMode: 'fiat' })), false);
eq('and the config survives the refusal',
    spoiled({ mode: 'fiat' }).consequenceOn, true);

eq('a clock draws its complications as pips',
    P.consequenceIsPips(spoiled({ mode: 'clock' }), plot()), true);
eq('an investment draws them as a bar',
    P.consequenceIsPips(spoiled({ mode: 'invest' }), plot()), false);
eq('a contest draws them as a bar',
    P.consequenceIsPips(spoiled({ mode: 'contested' }), plot()), false);

eq('one track by default', P.consequenceShared(spoiled({ mode: 'contested' }), plot()), true);
eq('one per side when asked',
    P.consequenceShared(spoiled({ mode: 'contested', consequencePerForce: true }), plot()), false);
// The switch is Contested's alone: nothing else has sides to give a pile to.
eq('the switch means nothing off contested',
    P.consequenceShared(spoiled({ mode: 'invest', consequencePerForce: true }), plot()), true);

eq('a fresh track reads nothing', P.consequenceOf(spoiled({ mode: 'invest' })), 0);
eq('a size below one is impossible',
    P.consequenceSize(node({ consequenceSize: 0 })), 1);

const mounting = spoiled({ mode: 'invest', progress: { consequence: 3 } });
eq('complications mount', P.addToConsequence(mounting, 1).consequence, 4);
eq('and clamp at the line', P.addToConsequence(mounting, 9).consequence, 4);
eq('and at nothing on the way back', P.addToConsequence(mounting, -9).consequence, 0);
// The decision, asserted: a battalion committed to a Thread speeds what its
// Force is doing, and has no business hastening what is going wrong to it.
eq('an asset bonus does not hasten a complication',
    P.addToConsequence(mounting, 1, [asset('bonusTick', 5)]).consequence, 4);
eq('mounting them leaves the Thread s own progress alone',
    P.addToConsequence(mounting, 1).pool, mounting.progress.pool);

eq('three of four is not at the line',
    P.consequenceFull(mounting, plot()), false);
eq('four of four is',
    P.consequenceFull(spoiled({ mode: 'invest', progress: { consequence: 4 } }), plot()), true);
eq('and a Thread that keeps none never is',
    P.consequenceFull(node({ mode: 'invest', progress: { consequence: 99 } }), plot()), false);

// Per side. "Any side is at its line" is the question the row and the cycle
// check both have — one side breaking is a Thread that can be ended.
const twoSided = spoiled({
    mode: 'contested', consequencePerForce: true,
    progress: { consequenceByForce: { [LEGION]: 4, [GUARD]: 1 } }
});
eq('a side at its line is full', P.consequenceFull(twoSided, plot(), LEGION), true);
eq('the other side is not', P.consequenceFull(twoSided, plot(), GUARD), false);
eq('and asked of nobody, any side counts', P.consequenceFull(twoSided, plot()), true);
eq('the sides at their line are named', P.consequenceLeaders(twoSided, plot(), [LEGION, GUARD]), [LEGION]);
eq('one side s complications do not move the other s',
    P.addConsequenceForForce(twoSided, GUARD, 1).consequenceByForce, { [LEGION]: 4, [GUARD]: 2 });
eq('and clamp at the same line',
    P.addConsequenceForForce(twoSided, GUARD, 99).consequenceByForce[GUARD], 4);
// Switching the toggle must not cost the GM the reading they switched away from.
eq('the shared count survives a per-side Thread',
    P.addConsequenceForForce(twoSided, GUARD, 1).consequence, twoSided.progress.consequence);

// ── the fourth ending ────────────────────────────────────────────────────────
// The sentinel is resolved in exactly one function, which is what lets every
// conclusion path below work without learning that a fourth ending exists.
eq('the sentinel resolves to its own outcome',
    P.outcomeFor(spoiled(), CONSEQUENCE), { forceId: CONSEQUENCE, delta: -20, note: 'the works burn' });
eq('a Force still resolves to its own row',
    P.outcomeFor(spoiled(), LEGION).delta, 15);
eq('and a Force with nothing declared still resolves to nothing',
    P.outcomeFor(spoiled(), 'f-nobody'), null);
eq('State moves by the consequence figure',
    P.stateAfterConclusion(plot(), spoiled(), CONSEQUENCE), 30);
eq('and clamps at the floor like any other ending',
    P.stateAfterConclusion(plot({ state: 5 }), spoiled(), CONSEQUENCE), 0);
eq('concluding by consequence credits the sentinel, not a Force',
    P.concludeThread(plot(), spoiled(), CONSEQUENCE).node.concludedBy, CONSEQUENCE);
eq('and reopening reverses exactly what was applied',
    P.reopenThread(plot({ state: 30 }), spoiled(), -20).plotState, 50);

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
