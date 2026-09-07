import * as N from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nnormalize.mjs — fed deliberately malformed data\n');

const p = N.normalizePlot({
    name: 'Invasion of Northwall', state: '47', lifecycle: 'bogus',
    phases: [{ label: 'Rain of Fire', threshold: 80 }, { label: 'Quiet', threshold: 0 }],
    forceIds: ['f1', 'f1', '', null, 'f2']
});
eq('numeric string state coerced', p.state, 47);
eq('bad lifecycle falls back to active', p.lifecycle, 'active');
eq('phases sorted by threshold', p.phases.map((x) => x.label), ['Quiet', 'Rain of Fire']);
eq('forceIds deduped and cleaned', p.forceIds, ['f1', 'f2']);
eq('entity base applied', [p.visibility, p.hideValues, p.isExample], ['visible', false, false]);

const n = N.normalizeNode({
    threshold: -5, segments: 0, mode: 'nonsense',
    progress: { pool: 'x', byForce: { f1: '6', '': 9 } },
    outcomes: [{ forceId: 'f1', delta: '15' }, { delta: 3 }],
    status: 'concluded', concludedBy: ''
});
eq('threshold clamped to >= 1', n.threshold, 1);
eq('segments clamped to >= 1', n.segments, 1);
eq('unknown mode becomes null (inherit)', n.mode, null);
eq('non-numeric pool -> 0', n.progress.pool, 0);
eq('byForce coerced, empty key dropped', n.progress.byForce, { f1: 6 });
eq('outcome without forceId dropped', n.outcomes, [{ forceId: 'f1', delta: 15, note: '' }]);
eq('empty concludedBy -> null', n.concludedBy, null);

const a = N.normalizeAsset({ name: '437th Infantry', modifier: { kind: 'wrong', value: '2' } });
// An Asset with no mechanical effect is the default shape, so an unrecognised
// kind falls back to doing nothing rather than to quietly discounting a Thread.
eq('bad modifier kind falls back to none', a.modifier, { kind: 'none', value: 2 });
eq('absent uuid is null not undefined', a.uuid, null);

const f = N.normalizeForce({ tags: [{ text: 'Siegecraft' }, { text: '' }, { polarity: 'weakness' }, 'junk'] });
eq('empty and non-object tags dropped', f.tags, [{ text: 'Siegecraft', polarity: 'strength' }]);

// A Force drawing income is the default: a world written before the pause switch
// existed must not open with every Force silently paused.
eq('a Force draws income by default', f.isActive, true);
eq('an explicit pause survives', N.normalizeForce({ isActive: false }).isActive, false);
eq('a junk pause value falls back to active', N.normalizeForce({ isActive: 'yes' }).isActive, true);

// The purse icon lands in a class attribute, so it is filtered rather than trusted.
eq('a plain icon passes through',
    N.normalizeForce({ icon: 'fa-solid fa-wheat-awn' }).icon, 'fa-solid fa-wheat-awn');
eq('an empty icon falls back to the default',
    N.normalizeForce({ icon: '   ' }).icon, 'fa-solid fa-coins');
eq('quotes and angle brackets are stripped out',
    N.normalizeForce({ icon: 'fa-solid" onload="x' }).icon, 'fa-solid onloadx');
eq('an icon that is nothing but junk falls back',
    N.normalizeForce({ icon: '<>"' }).icon, 'fa-solid fa-coins');

// ── world constants ──────────────────────────────────────────────────────────
const K = N.normalizeConstants();
eq('missing constants are the built-in defaults', K.forceIncome, 3);
eq('the default purse icon is coins', K.forceIcon, 'fa-solid fa-coins');
eq('developing an Asset is free until a GM says otherwise', K.assetCost, 0);

// Every key falls back on its own, so a world saved before a key existed opens.
const partial = N.normalizeConstants({ assetCost: 4 });
eq('a partial save keeps what it has', partial.assetCost, 4);
eq('a partial save fills the rest', partial.threadThreshold, 9);

eq('a negative Asset cost clamps to free', N.normalizeConstants({ assetCost: -5 }).assetCost, 0);
// Clamped rather than reset, matching how a Thread's own threshold behaves: a GM
// typing 0 meant "as small as possible", not "give me back the default".
eq('a threshold below one clamps to one', N.normalizeConstants({ threadThreshold: 0 }).threadThreshold, 1);
eq('a clock with no segments clamps to one', N.normalizeConstants({ clockSegments: -2 }).clockSegments, 1);
eq('a negative State floor is allowed', N.normalizeConstants({ stateMin: -50 }).stateMin, -50);
eq('junk numbers fall back', N.normalizeConstants({ forceIncome: 'lots' }).forceIncome, 3);

// ── one default visibility per kind ──────────────────────────────────────────
eq('every kind gets a default', Object.keys(K.defaultVisibility),
    ['plot', 'node', 'force', 'asset']);
eq('the built-in default is hidden everywhere',
    Object.values(K.defaultVisibility), ['hidden', 'hidden', 'hidden', 'hidden']);
eq('one kind can be set alone',
    N.normalizeConstants({ defaultVisibility: { force: 'visible' } }).defaultVisibility,
    { plot: 'hidden', node: 'hidden', force: 'visible', asset: 'hidden' });
eq('a junk kind falls back',
    N.normalizeConstants({ defaultVisibility: { plot: 'wat' } }).defaultVisibility.plot, 'hidden');
// A world written before the split stored one string for all four. Honouring it
// matters: silently reverting a GM's choice to Hidden would hide a board they had
// deliberately opened up.
eq('the pre-split single value seeds every kind',
    N.normalizeConstants({ defaultVisibility: 'masked' }).defaultVisibility,
    { plot: 'masked', node: 'masked', force: 'masked', asset: 'masked' });

// ── groupings on a Plot ──────────────────────────────────────────────────────
const grouped = N.normalizePlot({
    forceIds: ['f1', 'f2', 'f3'],
    forceGroups: { f1: '  The Besiegers ', f2: '', f3: 'The Defenders', ghost: 'Nobody' }
});
eq('grouping labels are trimmed', grouped.forceGroups.f1, 'The Besiegers');
eq('an empty grouping is no grouping', 'f2' in grouped.forceGroups, false);
eq('a grouping for a Force not on the Plot is dropped', 'ghost' in grouped.forceGroups, false);
eq('junk groupings read empty', N.normalizePlot({ forceGroups: 'nope' }).forceGroups, {});

// ── a Phase speaks to two audiences ──────────────────────────────────────────
const phase = N.normalizePhase({
    label: 'Critical', threshold: 50,
    description: 'Siege lines are visible from the wall.',
    gmNotes: 'The Guard stops sleeping.'
});
eq('a Phase keeps the line the table reads', phase.description,
    'Siege lines are visible from the wall.');
eq('a Phase keeps the GM to themselves', phase.gmNotes, 'The Guard stops sleeping.');
eq('a Phase with no description reads empty', N.normalizePhase({ label: 'x' }).description, '');

eq('undefined collection -> []', N.normalizePlots(undefined), []);
eq('junk entries filtered', N.normalizeAssets([{ name: 'x' }, 'junk', null]).length, 1);
eq('null turn -> count 0', N.normalizeTurn(null), { count: 0 });
eq('negative turn clamped', N.normalizeTurn({ count: -3 }), { count: 0 });

const withId = N.normalizePlot({ id: 'keep-me' });
eq('existing id preserved', withId.id, 'keep-me');
eq('missing id generated', N.normalizePlot({}).id.length > 0, true);

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
