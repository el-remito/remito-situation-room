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

// ── which clock a Plot keeps ────────────────────────────────────────────────
// A row written before the field existed reads as DEFAULT and behaves exactly
// as it always did, which is the property that makes this safe to add to a
// campaign already in progress.
const onWorld = plot({ id: 'p-world' });
const alone = plot({ id: 'p-alone', turnBehaviour: 'isolated' });
const stopped = plot({ id: 'p-stopped', turnBehaviour: 'none' });
const legacy = normalizePlot({ id: 'p-old', name: 'Written before this existed' });

eq('an unset behaviour is the world clock', E.followsTurn(legacy), true);
eq('an isolated Plot does not follow it', E.followsTurn(alone), false);
eq('a Plot with no clock does not either', E.followsTurn(stopped), false);
eq('only the isolated one has its own', [E.hasOwnTurn(alone), E.hasOwnTurn(stopped),
    E.hasOwnTurn(onWorld)], [true, false, false]);
eq('a garbage behaviour normalizes to the world clock',
    E.followsTurn(normalizePlot({ id: 'p-junk', turnBehaviour: 'weekly' })), true);

eq('the sitting-out list names both kinds and neither of the others',
    E.sittingOut([onWorld, alone, stopped]).map((r) => [r.plotId, r.behaviour]),
    [['p-alone', 'isolated'], ['p-stopped', 'none']]);
eq('nothing sits out of a board that all follows', E.sittingOut([onWorld, legacy]), []);
eq('no plots, nobody sitting out', E.sittingOut(undefined), []);

// ── whose timers a cycle moves ──────────────────────────────────────────────
// Commitment is the join. An Asset in its owner's hand is on the world's clock
// because it is not in any one situation yet.
const held = normalizeAsset({ id: 'a-held', forceId: LEGION, name: 'In hand' });
const atSiege = normalizeAsset({ id: 'a-siege', forceId: LEGION, name: 'At the wall', plotId: 'p-world' });
const onRoad = normalizeAsset({ id: 'a-road', forceId: GUARD, name: 'On the road', plotId: 'p-alone' });
const frozen = normalizeAsset({ id: 'a-frozen', forceId: GUARD, name: 'Nowhere', plotId: 'p-stopped' });
const shelf = [held, atSiege, onRoad, frozen];
const board = [onWorld, alone, stopped];
const ids = (rows) => rows.map((a) => a.id);

eq('the world moves what is uncommitted and what is on its own Plots',
    ids(E.assetsOnTheClock(shelf, board)), ['a-held', 'a-siege']);
eq('a Plot with its own clock moves only what is committed to it',
    ids(E.assetsOnTheClock(shelf, board, 'p-alone')), ['a-road']);
eq('a Plot with no clock moves nothing when nothing presses it',
    ids(E.assetsOnTheClock(shelf, board, 'p-stopped')), ['a-frozen']);
eq('an isolated Plot does not reach into the hand',
    E.assetsOnTheClock(shelf, board, 'p-alone').includes(held), false);
eq('with no Plots at all, everything is on the world clock',
    ids(E.assetsOnTheClock(shelf, [])), ['a-held', 'a-siege', 'a-road', 'a-frozen']);

// ── what a cycle does to the Plots themselves ───────────────────────────────
const moved = E.advanceTurn({ forces: [force(LEGION)], turn: { count: 10 }, plots: board });

eq('the Plot on the world clock takes the world count',
    moved.plots.find((p) => p.id === 'p-world').turnCount, 11);
eq('the isolated one is left where it was',
    moved.plots.find((p) => p.id === 'p-alone').turnCount, alone.turnCount);
eq('and is handed back by reference, so nothing is written for it',
    moved.plots.find((p) => p.id === 'p-alone') === alone, true);
eq('the cycle reports what it did not move',
    moved.skipped.map((r) => r.plotId), ['p-alone', 'p-stopped']);
eq('a cycle with no plots at all still advances',
    E.advanceTurn({ forces: [], turn: { count: 2 } }).turn.count, 3);

eq('a Plot moves its own count by one', E.advancePlotTurn({ turnCount: 3 }).turnCount, 4);
eq('and nothing else about it', Object.keys(E.advancePlotTurn(alone)).sort(),
    Object.keys(alone).sort());
eq('a Plot with no count starts at one', E.advancePlotTurn({}).turnCount, 1);
eq('a nonsense count is not inherited', E.advancePlotTurn({ turnCount: 'soon' }).turnCount, 1);

// ── what a clock is called ──────────────────────────────────────────────────
// Pure and deliberately half an answer: the built-in word is a localized string,
// so this returns the GM's word or nothing and the caller supplies the rest.
// Everything below is about making sure "nothing" is the answer whenever there
// is no real word, since '' is what the two callers test for.
eq('a clock with no name has none', E.clockName({}), '');
eq('a named clock keeps its name', E.clockName({ turnLabel: 'Moons' }), 'Moons');
eq('a name is trimmed', E.clockName({ turnLabel: '  The Ride  ' }), 'The Ride');
eq('whitespace is not a name', E.clockName({ turnLabel: '   ' }), '');
eq('a non-string is not a name', E.clockName({ turnLabel: 7 }), '');
eq('nothing at all is not a name', E.clockName(null), '');
eq('a row written before the field existed has no name',
    E.clockName(plot({ id: 'p-old' })), '');
eq('the world constants are read the same way',
    E.clockName({ turnLabel: 'Global Cycle' }), 'Global Cycle');

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
