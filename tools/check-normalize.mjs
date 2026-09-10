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
eq('null turn -> count 0', N.normalizeTurn(null),
    { count: 0, chapters: [], undo: null });
eq('negative turn clamped', N.normalizeTurn({ count: -3 }),
    { count: 0, chapters: [], undo: null });

// The undo record is stored beside the count and repaired by the same builder
// the advance uses, so a setting that was hand-edited in the console still opens
// — and cannot smuggle a field past it.
eq('a board with nothing to take back says so rather than carrying a husk',
    N.normalizeTurn({ count: 4 }).undo, null);
eq('a record is rebuilt from known keys only',
    Object.keys(N.normalizeTurn({ count: 4, undo: { count: 3, mischief: 1 } }).undo),
    ['plotId', 'count', 'forces', 'plots', 'assets', 'nodes', 'logIds']);
eq('and a record that is not an object is no record',
    ['', 0, [], 'yes'].map((u) => N.normalizeTurn({ count: 4, undo: u }).undo),
    [null, null, null, null]);

// Where the runs of Cycles begin is HISTORY, so it is stored on the clock beside
// the count it reads and not among the defaults. The repair is the same one
// logic/cycle.mjs uses everywhere else, which is what lets the reading walk the
// list in order without sorting it first.
eq('the marks come back in cycle order, whatever order they were typed',
    N.normalizeTurn({ chapters: [{ at: 9 }, { at: 2, name: ' Act Two ' }] }).chapters,
    [{ at: 2, name: 'Act Two' }, { at: 9, name: '' }]);
eq('a mark that is not on a cycle is dropped',
    N.normalizeTurn({ chapters: [{ at: 0 }, 'later', null, { at: 3 }] }).chapters,
    [{ at: 3, name: '' }]);
eq('and a list that is not a list is no marks at all',
    [null, 'none', 7].map((c) => N.normalizeTurn({ chapters: c }).chapters),
    [[], [], []]);

// The word only. A run that was given a name of its own uses that instead.
eq('the word for a run is trimmed, and empty means the built-in one',
    N.normalizeConstants({ chapterLabel: '  Act  ' }).chapterLabel, 'Act');
eq('and a length is no longer part of the shape',
    'chapterLength' in N.normalizeConstants({ chapterLength: 4 }), false);

const withId = N.normalizePlot({ id: 'keep-me' });
eq('existing id preserved', withId.id, 'keep-me');
eq('missing id generated', N.normalizePlot({}).id.length > 0, true);

// ── what the table sees instead ──────────────────────────────────────────────
// maskLabel is on every entity, because every kind of row can be masked and
// every mask can be given a name. maskNote is only on the two that draw a
// reading for it to stand in for — an unused field on a Force is weight the
// next reader has to ask about.
eq('a plot keeps its mask name', N.normalizePlot({ maskLabel: 'Unknown war' }).maskLabel, 'Unknown war');
eq('a thread keeps its mask note',
    N.normalizeNode({ maskNote: 'Rumours in the market.' }).maskNote, 'Rumours in the market.');
eq('a force is named but has no note', 'maskNote' in N.normalizeForce({}), false);
eq('an asset is named but has no note', 'maskNote' in N.normalizeAsset({}), false);
eq('a force can still be named', N.normalizeForce({ maskLabel: 'A third party' }).maskLabel, 'A third party');
eq('an unset mask name is empty, not a default',
    [N.normalizePlot({}).maskLabel, N.normalizeNode({}).maskLabel], ['', '']);
eq('a non-string mask name is dropped', N.normalizeNode({ maskLabel: 7 }).maskLabel, '');
eq('a non-string mask note is dropped', N.normalizeNode({ maskNote: {} }).maskNote, '');

// ── which clock a Plot keeps ────────────────────────────────────────────────
eq('an unset behaviour is the world clock', N.normalizePlot({}).turnBehaviour, 'default');
eq('a known behaviour is kept',
    N.normalizePlot({ turnBehaviour: 'isolated' }).turnBehaviour, 'isolated');
eq('an invented one falls back rather than sticking',
    N.normalizePlot({ turnBehaviour: 'weekly' }).turnBehaviour, 'default');
eq('a Plot starts on cycle zero', N.normalizePlot({}).turnCount, 0);
eq('a Plot keeps the cycle it was on', N.normalizePlot({ turnCount: 7 }).turnCount, 7);
eq('a non-numeric count is zero', N.normalizePlot({ turnCount: 'later' }).turnCount, 0);
eq('only a Plot keeps a clock', 'turnBehaviour' in N.normalizeNode({}), false);

// ── what a Plot and a world call their clocks ───────────────────────────────
eq('a Plot has no clock name by default', N.normalizePlot({}).turnLabel, '');
eq('a Plot keeps the one it was given',
    N.normalizePlot({ turnLabel: 'The Ride' }).turnLabel, 'The Ride');
eq('a clock name is trimmed on the way in',
    N.normalizePlot({ turnLabel: '  The Ride ' }).turnLabel, 'The Ride');
eq('spaces are no name, so the built-in word stands',
    N.normalizePlot({ turnLabel: '   ' }).turnLabel, '');
eq('a non-string name is dropped',
    N.normalizePlot({ turnLabel: 12 }).turnLabel, '');
eq('the world has no clock name by default',
    N.normalizeConstants({}).turnLabel, '');
eq('the world keeps the one it was given',
    N.normalizeConstants({ turnLabel: 'Moons' }).turnLabel, 'Moons');
eq('only a Plot and the world keep a clock name',
    'turnLabel' in N.normalizeNode({}), false);

// ── the colour a row's name is printed in ─────────────────────────
// A palette id lands in a class attribute; a colour of the GM's own lands in a
// style attribute, which is a far worse place for a string somebody typed. So
// the funnel does not filter — it PARSES and re-emits (logic/palette.mjs, and
// tools/check-palette.mjs for the parsing itself). These assertions are the
// reason nothing downstream has to sanitise a colour.

eq('a row has no colour of its own by default', N.normalizeNode({}).color, '');
eq('a colour from the palette is kept', N.normalizeForce({ color: 'stone' }).color, 'stone');
eq('a word that is not one of the nine is dropped rather than stored',
    N.normalizeAsset({ color: 'chartreuse' }).color, '');
eq('and so is anything that could close a class attribute',
    N.normalizeNode({ color: '" onload=x' }).color, '');
eq('a non-string colour is dropped too', N.normalizePlot({ color: 7 }).color, '');

// The GM's own, which is the half that reaches a style attribute.
eq('a hex is kept, canonicalised', N.normalizeForce({ color: '#8A9099' }).color, '#8a9099');
eq('and so is a short one', N.normalizePlot({ color: '#89a' }).color, '#8899aa');
eq('an rgb() is stored as the hex it means',
    N.normalizeAsset({ color: 'rgb(138, 144, 153)' }).color, '#8a9099');
eq('a colour with CSS after it is not a colour',
    N.normalizeNode({ color: '#8a9099; background: url(x)' }).color, '');
eq('nor is one that would close the style attribute',
    N.normalizeForce({ color: '#8a9099" onload="x' }).color, '');
eq('every kind carries the field', [
    'color' in N.normalizePlot({}), 'color' in N.normalizeNode({}),
    'color' in N.normalizeForce({}), 'color' in N.normalizeAsset({})
], [true, true, true, true]);

// ── the consequence ──────────────────────────────────────────────────────────
// Config on the node, counts under progress. That split is what stops the
// editor's Save from clobbering a push that landed while the form was open —
// `patchFrom` carries the config and never carries progress.
const clean = N.normalizeNode({});
eq('a Thread tracks no complications by default', clean.consequenceOn, false);
eq('and carries a size anyway, so turning it on needs no second edit',
    clean.consequenceSize, 6);
eq('a size of zero is repaired to one', N.normalizeNode({ consequenceSize: 0 }).consequenceSize, 1);
eq('a size of nonsense falls back', N.normalizeNode({ consequenceSize: 'x' }).consequenceSize, 6);
eq('the per-side switch is off by default', clean.consequencePerForce, false);
eq('the consequence outcome starts at nothing',
    [clean.consequenceDelta, clean.consequenceNote], [0, '']);
eq('a non-string consequence note is dropped',
    N.normalizeNode({ consequenceNote: {} }).consequenceNote, '');

eq('both counts exist on a fresh Thread',
    [clean.progress.consequence, clean.progress.consequenceByForce], [0, {}]);
eq('a stored count survives',
    N.normalizeNode({ progress: { consequence: 3 } }).progress.consequence, 3);
eq('and a per-side one is repaired like the other pile',
    N.normalizeNode({ progress: { consequenceByForce: { 'f-a': '2', '': 9, 'f-b': 'x' } } })
        .progress.consequenceByForce, { 'f-a': 2, 'f-b': 0 });
// A world saved before any of this opens with the count at nothing rather than
// with the key missing — which is the whole reason this file exists.
eq('a Thread written before the track existed still reads',
    'consequence' in N.normalizeNode({ progress: { pool: 4 } }).progress, true);
eq('and its own progress is untouched by the repair',
    N.normalizeNode({ progress: { pool: 4 } }).progress.pool, 4);

// The sentinel is a plain non-empty string and survives the same repair a Force
// id does. `force.delete` never matches it, which is the point of choosing one.
eq('a Thread ended by its complications keeps the credit',
    N.normalizeNode({ concludedBy: 'rsr-consequence' }).concludedBy, 'rsr-consequence');

// ── which pile a chronicle line moved ────────────────────────────────────────
eq('a line says the Thread s own progress unless told otherwise',
    N.normalizeLogEntry({}).track, 'progress');
eq('a consequence line says so', N.normalizeLogEntry({ track: 'consequence' }).track, 'consequence');
eq('and a track nobody has heard of reads as progress',
    N.normalizeLogEntry({ track: 'nonsense' }).track, 'progress');

// ── the deadline ─────────────────────────────────────────────────────────────
eq('a Thread has no deadline by default', clean.expiryOn, false);
eq('and carries a size and a clock anyway', [clean.expirySize, clean.expiryClock], [6, 'world']);
eq('a size of zero is repaired to one', N.normalizeNode({ expirySize: 0 }).expirySize, 1);
eq('a clock nobody has heard of reads as the world s',
    N.normalizeNode({ expiryClock: 'sundial' }).expiryClock, 'world');
eq('and a real one carries', N.normalizeNode({ expiryClock: 'plot' }).expiryClock, 'plot');
eq('a Thread has no word of its own by default', clean.expiryLabel, '');
eq('a word of spaces is no word at all',
    N.normalizeNode({ expiryLabel: '   ' }).expiryLabel, '');
eq('the count starts at nothing', clean.progress.expiry, 0);
eq('a negative count is repaired',
    N.normalizeNode({ progress: { expiry: -4 } }).progress.expiry, 0);
// Deliberately NOT clamped at the size: this function repairs one value at a
// time and cannot see a sibling field, and a count above the size reads as run
// out, which it correctly is.
eq('a count above the size is left for the reading to call run out',
    N.normalizeNode({ expirySize: 3, progress: { expiry: 9 } }).progress.expiry, 9);
eq('a Thread written before deadlines existed still reads',
    'expiry' in N.normalizeNode({ progress: { pool: 4 } }).progress, true);

eq('a world has no word for running out by default', K.expiryLabel, '');
eq('one the GM typed carries',
    N.normalizeConstants({ expiryLabel: 'Closed' }).expiryLabel, 'Closed');
eq('and a word of spaces falls back to the built-in one',
    N.normalizeConstants({ expiryLabel: '  ' }).expiryLabel, '');

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
