import * as E from '../scripts/logic/economy.mjs';
import { normalizeForce, normalizePlot, normalizeAsset } from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\neconomy.mjs\n');

const LEGION = 'f-legion';
const GUARD = 'f-guard';
const IDLE = 'f-idle';

const force = (id, extra = {}) => normalizeForce({ id, name: id, resources: 10, income: 3, ...extra });

const plot = (extra = {}) => normalizePlot({
    id: 'p-northwall', name: 'Northwall', forceIds: [LEGION, GUARD], ...extra
});

// ── spending ─────────────────────────────────────────────────────────────────
eq('a push costs one Resource per point', E.pushCost(3), 3);
eq('a reversal refunds', E.pushCost(-2), -2);

eq('affordable at exactly the cost', E.canAfford(force(LEGION, { resources: 3 }), 3), true);
eq('one short is not affordable', E.canAfford(force(LEGION, { resources: 2 }), 3), false);
eq('a refund is always affordable', E.canAfford(force(LEGION, { resources: 0 }), -2), true);
eq('a broke Force affords nothing', E.canAfford(force(LEGION, { resources: 0 }), 1), false);

eq('spending deducts', E.spend(force(LEGION, { resources: 10 }), 4), 6);
eq('a negative cost refunds', E.spend(force(LEGION, { resources: 6 }), -4), 10);
eq('Resources never go negative', E.spend(force(LEGION, { resources: 2 }), 99), 0);

eq('GM fiat adds', E.adjust(force(LEGION, { resources: 10 }), 5), 15);
eq('GM fiat removes', E.adjust(force(LEGION, { resources: 10 }), -5), 5);
eq('GM fiat cannot go below zero', E.adjust(force(LEGION, { resources: 1 }), -99), 0);
eq('junk delta is a no-op', E.adjust(force(LEGION, { resources: 7 }), undefined), 7);

// ── what a push actually charges ─────────────────────────────────────────────
eq('a plain push charges what it moved', E.chargeFor(1, 1), 1);
eq('an Asset bonus is not charged for', E.chargeFor(1, 3), 1);
eq('a push into a full clock is free', E.chargeFor(1, 0), 0);
eq('a partial push charges only the part that landed', E.chargeFor(3, 2), 2);
eq('a reversal refunds what it took back', E.chargeFor(-1, -1), -1);
eq('a reversal against an empty bar refunds nothing', E.chargeFor(-1, 0), 0);
eq('a partial reversal refunds only what came back', E.chargeFor(-3, -1), -1);

// ── who draws income ─────────────────────────────────────────────────────────
// Income belongs to the Force. Where a Force is standing does not decide whether
// it earns — only the GM's pause switch does.
eq('a Force is payable by default', E.isPayableForce(force(LEGION)), true);
eq('a paused Force is not', E.isPayableForce(force(LEGION, { isActive: false })), false);
eq('a Force from an older world is payable', E.isPayableForce({ id: 'raw', income: 2 }), true);

const roster = [
    force(LEGION),
    force(GUARD, { income: 5 }),
    force(IDLE, { income: 9 })                 // on no Plot at all — still paid
];

eq('the roster carries EVERY Force, paid or not',
    E.incomeRoster(roster).map((r) => r.forceId), [LEGION, GUARD, IDLE]);
eq('a Force on no Plot still earns',
    E.incomeRoster(roster).find((r) => r.forceId === IDLE).paid, 9);
eq('the roster reports the resulting totals',
    E.incomeRoster(roster).map((r) => r.to), [13, 15, 19]);

const paused = E.incomeRoster([force(LEGION, { isActive: false })])[0];
eq('a paused Force is listed', paused.forceId, LEGION);
eq('a paused Force is paid nothing', paused.paid, 0);
eq('a paused Force keeps its total', paused.to, 10);
eq('a paused Force still reports its income', paused.income, 3);
eq('the roster says why: not active', paused.isActive, false);
eq('the roster says why: will not be paid', paused.willBePaid, false);

const noIncome = E.incomeRoster([force(LEGION, { income: 0 })])[0];
eq('a Force with no income is still listed', noIncome.forceId, LEGION);
eq('a Force with no income moves nothing', noIncome.paid, 0);
eq('zero income is not "will be paid"', noIncome.willBePaid, false);

// Negative income is upkeep. It can bankrupt a Force but never put one in debt,
// so the reported payment is the realised one.
const upkeep = E.incomeRoster([force(LEGION, { resources: 2, income: -5 })])[0];
eq('upkeep bottoms out at zero', upkeep.to, 0);
eq('the roster reports what was actually paid, not the income', upkeep.paid, -2);

eq('payments are the rows that actually move',
    E.incomePayments(roster).map((r) => r.forceId), [LEGION, GUARD, IDLE]);
eq('a paused Force is not a payment',
    E.incomePayments([force(LEGION, { isActive: false })]), []);
eq('a zero-income Force is not a payment',
    E.incomePayments([force(LEGION, { income: 0 })]), []);

// ── engagement is display only ───────────────────────────────────────────────
eq('an active plot engages its roster',
    [...E.engagedForceIds([plot()])].sort(), [GUARD, LEGION].sort());
eq('a paused plot engages nobody', [...E.engagedForceIds([plot({ lifecycle: 'paused' })])], []);
eq('an archived plot engages nobody', [...E.engagedForceIds([plot({ lifecycle: 'archived' })])], []);
eq('no plots, no engagement', [...E.engagedForceIds([])], []);
eq('one active plot is enough',
    [...E.engagedForceIds([plot({ lifecycle: 'paused' }), plot({ id: 'p2', forceIds: [LEGION] })])],
    [LEGION]);

// ── advancing the cycle ──────────────────────────────────────────────────────
const after = E.advanceTurn({ forces: roster, turn: { count: 4 } });

eq('the cycle counter advances', after.turn.count, 5);
eq('every active Force is paid', after.forces.map((f) => f.resources), [13, 15, 19]);
eq('the input is not mutated', roster[0].resources, 10);
eq('the payments are reported', after.payments.length, 3);
eq('the full roster comes back with them', after.roster.length, 3);

const withPaused = E.advanceTurn({
    forces: [force(LEGION, { isActive: false }), force(GUARD)],
    turn: { count: 0 }
});
eq('a paused Force is not paid', withPaused.forces[0].resources, 10);
eq('its neighbour still is', withPaused.forces[1].resources, 13);
eq('the paused Force is still on the roster', withPaused.roster.length, 2);

eq('a cycle that pays nobody still advances',
    E.advanceTurn({ forces: [force(LEGION, { isActive: false })], turn: { count: 7 } }).turn.count, 8);
eq('a missing counter starts from zero',
    E.advanceTurn({ forces: [], turn: undefined }).turn.count, 1);

// ── commitment ───────────────────────────────────────────────────────────────
const node = { id: 'n-siege', plotId: 'p-northwall' };

eq('committing to a Thread commits to its Plot too',
    E.commitment(node), { plotId: 'p-northwall', nodeId: 'n-siege' });
eq('committing to a Plot alone clears the Thread',
    E.commitment(null, plot()), { plotId: 'p-northwall', nodeId: null });
eq('committing to nothing releases', E.commitment(), { plotId: null, nodeId: null });

const assets = [
    normalizeAsset({ id: 'a1', forceId: LEGION, name: 'Battalion', nodeId: 'n-siege', plotId: 'p-northwall' }),
    normalizeAsset({ id: 'a2', forceId: LEGION, name: 'Dragon' }),
    normalizeAsset({ id: 'a3', forceId: GUARD, name: 'River runners' })
];

eq('uncommitted assets are the ones still in hand',
    E.uncommittedAssets(assets, LEGION).map((a) => a.id), ['a2']);
eq('another Force sees its own', E.uncommittedAssets(assets, GUARD).map((a) => a.id), ['a3']);
eq('an unknown Force holds nothing', E.uncommittedAssets(assets, 'nope'), []);

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
