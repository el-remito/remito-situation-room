#!/usr/bin/env node
/**
 * logic/condition.mjs, and the three things a condition switches.
 * `node tools/check-condition.mjs`
 *
 * The reason this suite exists rather than trusting the table: the rules are read
 * in four places that cannot see each other — the modifier arithmetic in
 * progress.mjs, the tray in economy.mjs, the release in state.mjs and the timer on
 * the cycle — and a condition that half-applies is worse than one that does
 * nothing. So the table is checked for shape, and then every consumer is driven
 * through it.
 *
 * The conditions are the GM's, not the module's, so an INVENTED condition is
 * exercised alongside the defaults: a suite that only ever used built-in ids would
 * not prove the feature works.
 */

import * as Cond from '../scripts/logic/condition.mjs';
import { effectiveThreshold, investBonus, tickBonus } from '../scripts/logic/progress.mjs';
import { uncommittedAssets, setAsideAssets } from '../scripts/logic/economy.mjs';
import { normalizeAsset, normalizeConditions } from '../scripts/data/normalize.mjs';
import {
    ASSET_CONDITION, ASSET_MODIFIER, CONDITION_EFFECT, DEFAULT_CONDITIONS
} from '../scripts/constants.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\ncondition.mjs\n');

const TABLE = normalizeConditions([]);

/** One resolved Asset, in the shape settings.mjs hands them out in. */
const asset = (fields, table = TABLE) => Cond.resolveConditions([{
    id: 'a', forceId: 'f1', plotId: null, nodeId: null, conditionCycles: 0,
    modifier: { kind: ASSET_MODIFIER.NONE, value: 0 }, ...fields
}], table)[0];

// ── the defaults ─────────────────────────────────────────────────────────────
eq('a fresh world is seeded with the six', TABLE.map((c) => c.id),
    ['ready', 'damaged', 'suppressed', 'inactive', 'recovering', 'destroyed']);
eq('every default states an effect',
    DEFAULT_CONDITIONS.filter((c) => !Object.values(CONDITION_EFFECT).includes(c.effect)), []);
eq('every default states whether it is in play',
    DEFAULT_CONDITIONS.filter((c) => typeof c.inPlay !== 'boolean'), []);
eq('ready is the only default that changes nothing',
    DEFAULT_CONDITIONS.filter((c) => c.effect === CONDITION_EFFECT.FULL && c.inPlay).map((c) => c.id),
    [ASSET_CONDITION.READY]);
eq('a named successor exists in the table',
    DEFAULT_CONDITIONS.filter((c) => c.becomes && !DEFAULT_CONDITIONS.some((o) => o.id === c.becomes)), []);
eq('recovering is the only default with a timer',
    DEFAULT_CONDITIONS.filter((c) => c.cycles > 0).map((c) => c.id), [ASSET_CONDITION.RECOVERING]);
eq('destroyed is the only final default',
    DEFAULT_CONDITIONS.filter((c) => c.isFinal).map((c) => c.id), [ASSET_CONDITION.DESTROYED]);

// ── the table is the GM's ────────────────────────────────────────────────────
eq('an empty table is seeded rather than left empty', normalizeConditions(undefined).length, 6);
eq('a table without ready gets it back',
    normalizeConditions([{ id: 'besieged' }]).map((c) => c.id), ['ready', 'besieged']);
eq('a GM label wins over the built-in key',
    Cond.labelOf({ labelKey: 'RSR.asset.condition.damaged', label: 'Blockaded' }), 'Blockaded');
eq('an untouched built-in yields its key',
    Cond.labelOf({ labelKey: 'RSR.asset.condition.damaged', label: '' }),
    'RSR.asset.condition.damaged');

// An invented condition, switched the way a GM would switch one.
const INVENTED = normalizeConditions([
    ...DEFAULT_CONDITIONS,
    { id: 'besieged', label: 'Besieged', effect: 'half', inPlay: true, cycles: 3, becomes: 'ready' },
    { id: 'mutinous', label: 'Mutinous', effect: 'none', inPlay: false, cycles: 0, becomes: '' }
]);
eq('an invented condition resolves', Cond.rowFor(INVENTED, 'besieged').label, 'Besieged');
eq('an invented condition halves like a built-in one',
    Cond.effectiveValue(asset({ condition: 'besieged' }, INVENTED), 7), 3);
eq('an invented condition can take an Asset off the board',
    Cond.isInPlay(asset({ condition: 'mutinous' }, INVENTED)), false);

// ── resolution and the fallback ──────────────────────────────────────────────
eq('an unknown condition resolves to ready',
    Cond.rowFor(TABLE, 'nonsense').id, ASSET_CONDITION.READY);
eq('a deleted condition leaves the Asset readable rather than rewritten',
    Cond.ruleFor(asset({ condition: 'gone' })).id, ASSET_CONDITION.READY);
eq('ready reads as the default', Cond.isDefault(asset({ condition: 'ready' })), true);
eq('anything else does not', Cond.isDefault(asset({ condition: 'damaged' })), false);
eq('a bare Asset with no rule still reads in play', Cond.isInPlay({}), true);
eq('nothing at all reads ready', Cond.ruleFor(undefined).id, ASSET_CONDITION.READY);

// ── the effect scale ─────────────────────────────────────────────────────────
eq('full is untouched', Cond.scaleOf(CONDITION_EFFECT.FULL, 5), 5);
eq('none is nothing', Cond.scaleOf(CONDITION_EFFECT.NONE, 5), 0);
eq('half of 4 is 2', Cond.scaleOf(CONDITION_EFFECT.HALF, 4), 2);
eq('half of 5 rounds down to 2', Cond.scaleOf(CONDITION_EFFECT.HALF, 5), 2);
// Rounding up would make Damaged free on exactly the Assets whose benefit was
// marginal to begin with.
eq('half of 1 is nothing', Cond.scaleOf(CONDITION_EFFECT.HALF, 1), 0);
eq('half of a negative rounds toward zero', Cond.scaleOf(CONDITION_EFFECT.HALF, -5), -2);
eq('an unknown effect is treated as full', Cond.scaleOf('wat', 5), 5);

// ── the arithmetic obeys it ──────────────────────────────────────────────────
const mod = (kind, value, condition) => asset({ modifier: { kind, value }, condition });
const node = { threshold: 10, segments: 6, progress: { pool: 0, byForce: {} } };

eq('a ready discount reduces the threshold in full',
    effectiveThreshold(node, [mod(ASSET_MODIFIER.COST_REDUCTION, 4, 'ready')]), 6);
eq('a damaged discount is halved',
    effectiveThreshold(node, [mod(ASSET_MODIFIER.COST_REDUCTION, 4, 'damaged')]), 8);
eq('a suppressed discount does nothing',
    effectiveThreshold(node, [mod(ASSET_MODIFIER.COST_REDUCTION, 4, 'suppressed')]), 10);
eq('a destroyed discount does nothing',
    effectiveThreshold(node, [mod(ASSET_MODIFIER.COST_REDUCTION, 4, 'destroyed')]), 10);
eq('a ready investment bonus counts in full',
    investBonus([mod(ASSET_MODIFIER.BONUS_INVEST, 4, 'ready')]), 4);
eq('a damaged investment bonus is halved',
    investBonus([mod(ASSET_MODIFIER.BONUS_INVEST, 4, 'damaged')]), 2);
eq('a damaged tick bonus is halved',
    tickBonus([mod(ASSET_MODIFIER.BONUS_TICK, 3, 'damaged')]), 1);
eq('a damaged Asset does not drag down a healthy one beside it',
    investBonus([
        mod(ASSET_MODIFIER.BONUS_INVEST, 4, 'damaged'),
        mod(ASSET_MODIFIER.BONUS_INVEST, 3, 'ready')
    ]), 5);

// ── the tray, and what is set aside ──────────────────────────────────────────
const inHand = (id, forceId, condition, where = {}) => ({
    id, forceId, plotId: null, nodeId: null, condition, ...where
});
const hand = Cond.resolveConditions([
    inHand('ready', 'f1', 'ready'),
    inHand('damaged', 'f1', 'damaged'),
    inHand('suppressed', 'f1', 'suppressed'),
    inHand('inactive', 'f1', 'inactive'),
    inHand('recovering', 'f1', 'recovering'),
    inHand('destroyed', 'f1', 'destroyed'),
    inHand('committed', 'f1', 'ready', { plotId: 'p1', nodeId: 'n1' }),
    inHand('theirs', 'f2', 'ready')
], TABLE);
eq('the tray offers only what is in play and uncommitted',
    uncommittedAssets(hand, 'f1').map((a) => a.id), ['ready', 'damaged', 'suppressed']);
eq('what is set aside is only the final conditions',
    setAsideAssets(hand, 'f1').map((a) => a.id), ['destroyed']);
eq('one Force does not see another one hand',
    uncommittedAssets(hand, 'f2').map((a) => a.id), ['theirs']);

// ── the timer ────────────────────────────────────────────────────────────────
const timed = (condition, conditionCycles, extra = {}) =>
    asset({ condition, conditionCycles, ...extra });

eq('an Asset with no timer does not tick', Cond.tick(TABLE, timed('damaged', 0)), null);
eq('a running timer counts down',
    Cond.tick(TABLE, timed('recovering', 2)), { conditionCycles: 1 });
eq('the last Cycle becomes the successor',
    Cond.tick(TABLE, timed('recovering', 1)), { condition: 'ready', conditionCycles: 0 });
eq('a timer with no successor simply stops',
    Cond.tick(TABLE, timed('damaged', 1)), { conditionCycles: 0 });
// Otherwise a table where A becomes B and B becomes A would tick forever.
eq('the successor does not start its own timer',
    Cond.tick(INVENTED, timed('besieged', 1)).conditionCycles, 0);
eq('a successor that is out of play releases the Asset',
    Cond.tick(
        normalizeConditions([
            ...DEFAULT_CONDITIONS,
            {
                id: 'failing', label: 'Failing', effect: 'none', inPlay: true,
                cycles: 1, becomes: 'destroyed'
            }
        ]),
        timed('failing', 1, { plotId: 'p1', nodeId: 'n1' })
    ),
    { condition: 'destroyed', conditionCycles: 0, plotId: null, nodeId: null });
eq('a condition that becomes itself just stops',
    Cond.tick(
        normalizeConditions([{ id: 'ready' }, { id: 'loop', cycles: 1, becomes: 'loop' }]),
        timed('loop', 1)
    ),
    { conditionCycles: 0 });
eq('ticking reports only the rows that moved',
    Cond.ticking(TABLE, [timed('ready', 0), timed('recovering', 2)]).length, 1);
eq('ticking tolerates junk', Cond.ticking(TABLE, null), []);

// ── the stored shape ─────────────────────────────────────────────────────────
eq('a stored Asset keeps a condition the GM invented',
    normalizeAsset({ condition: 'besieged' }).condition, 'besieged');
eq('an Asset written before conditions existed reads ready',
    normalizeAsset({ name: 'x' }).condition, ASSET_CONDITION.READY);
eq('a stored Asset keeps its remaining Cycles',
    normalizeAsset({ conditionCycles: 3 }).conditionCycles, 3);
eq('a negative Cycle count is clamped',
    normalizeAsset({ conditionCycles: -4 }).conditionCycles, 0);
eq('a stored row keeps every switch',
    (({ effect, inPlay, cycles, becomes, isFinal }) =>
        ({ effect, inPlay, cycles, becomes, isFinal }))(
        normalizeConditions([{ id: 'ready' }, {
            id: 'x', effect: 'half', inPlay: false, cycles: 2, becomes: 'ready', isFinal: true
        }])[1]),
    { effect: 'half', inPlay: false, cycles: 2, becomes: 'ready', isFinal: true });
eq('an unknown effect on a stored row reads full',
    normalizeConditions([{ id: 'ready' }, { id: 'x', effect: 'wat' }])[1].effect,
    CONDITION_EFFECT.FULL);

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
