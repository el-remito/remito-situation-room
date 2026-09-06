import * as P from '../scripts/logic/progress.mjs';
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

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
