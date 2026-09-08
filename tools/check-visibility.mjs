import * as V from '../scripts/logic/visibility.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nvisibility.mjs\n');

const open = { name: 'Preparing Siege Engines', description: 'Engineers.', visibility: 'visible', hideValues: false };
const masked = { ...open, visibility: 'masked' };
const hidden = { ...open, visibility: 'hidden' };
const quiet = { ...open, hideValues: true };

const GM = true;
const PLAYER = false;

// ── existence ────────────────────────────────────────────────────────────────
eq('player cannot see hidden', V.canSee(hidden, PLAYER), false);
eq('player can see masked', V.canSee(masked, PLAYER), true);
eq('GM sees hidden', V.canSee(hidden, GM), true);
eq('rows filtered for player', V.visibleRows([open, masked, hidden], PLAYER).length, 2);
eq('rows intact for GM', V.visibleRows([open, masked, hidden], GM).length, 3);
eq('non-array is tolerated', V.visibleRows(undefined, PLAYER), []);

// ── identity, and the leak rule ──────────────────────────────────────────────
eq('masked name is replaced for player', V.projectIdentity(masked, PLAYER).name, '???');
eq('masked description is DROPPED, not blanked-in-place',
    V.projectIdentity(masked, PLAYER).description, '');
eq('masked projection carries no original name anywhere',
    JSON.stringify(V.projectIdentity(masked, PLAYER)).includes('Siege'), false);
eq('GM sees the real name through a mask', V.projectIdentity(masked, GM).name, 'Preparing Siege Engines');
eq('visible name passes through', V.projectIdentity(open, PLAYER).name, 'Preparing Siege Engines');
eq('custom masked label honoured', V.projectIdentity(masked, PLAYER, '—').name, '—');

// ── values, orthogonal to visibility ─────────────────────────────────────────
eq('hideValues withholds from player', V.showValues(quiet, PLAYER), false);
eq('hideValues never applies to GM', V.showValues(quiet, GM), true);
eq('visible + hideValues still renders a bar',
    V.projectProgress({ current: 7, total: 11, isGM: PLAYER, entity: quiet }),
    { showValues: false, percent: 64 });
eq('withheld progress carries NO current/total keys',
    Object.keys(V.projectProgress({ current: 7, total: 11, isGM: PLAYER, entity: quiet })).sort(),
    ['percent', 'showValues']);
eq('shown progress carries the numbers',
    V.projectProgress({ current: 6, total: 10, isGM: PLAYER, entity: open }),
    { showValues: true, current: 6, total: 10, percent: 60 });

// ── percent maths ────────────────────────────────────────────────────────────
eq('zero total reads empty', V.percentOf(5, 0), 0);
eq('negative total reads empty', V.percentOf(5, -3), 0);
eq('overfull clamps', V.percentOf(30, 10), 100);
eq('negative current clamps', V.percentOf(-4, 10), 0);
eq('non-numeric tolerated', V.percentOf('x', 10), 0);
eq('rounds', V.percentOf(1, 3), 33);

// ── force chips ──────────────────────────────────────────────────────────────
const legion = { id: 'f1', name: 'Iron Legion', visibility: 'visible' };
eq('visible force chip keeps its id', V.projectForceChip(legion, PLAYER), { id: 'f1', name: 'Iron Legion', masked: false });
eq('hidden force yields no chip', V.projectForceChip({ ...legion, visibility: 'hidden' }, PLAYER), null);
eq('masked force chip drops the id too',
    V.projectForceChip({ ...legion, visibility: 'masked' }, PLAYER), { id: null, name: '???', masked: true });

// ── the Phase's tone, found leaking in the M5 sweep ──────────────────────────
// A masked Plot dropped its Phase LABEL and kept the colour that label was
// painted in, so the bar still went red at "Rain of Fire" and the table read the
// mood of a Phase whose name was being withheld.
eq('masked plot surrenders its tone', V.projectTone(masked, PLAYER, 'danger'), 'neutral');
eq('visible plot keeps its tone', V.projectTone(open, PLAYER, 'danger'), 'danger');
eq('GM keeps the tone through a mask', V.projectTone(masked, GM, 'danger'), 'danger');
eq('hideValues does not touch the tone', V.projectTone(quiet, PLAYER, 'warn'), 'warn');
eq('a toneless phase reads neutral', V.projectTone(open, PLAYER, ''), 'neutral');
eq('a missing phase reads neutral', V.projectTone(open, PLAYER, undefined), 'neutral');

// ── the clock, the other half of that sweep ──────────────────────────────────
// Pips are the number drawn as dots. A continuous bar is a deliberate exception
// to hideValues because a width is a fuzzy read; four filled dots out of six is
// not fuzzy, and counting them is not a workaround.
const clock = (isGM, entity) => V.projectClock({ current: 4, total: 6, isGM, entity });
eq('a readable clock has its pips', clock(PLAYER, open).pips.length, 6);
eq('a readable clock fills the right ones',
    clock(PLAYER, open).pips.map((pip) => pip.filled), [true, true, true, true, false, false]);
eq('a withheld clock has NO pips', clock(PLAYER, quiet).pips, null);
eq('a withheld clock still has its bar', clock(PLAYER, quiet).percent, 67);
eq('a withheld clock carries no count',
    Object.keys(clock(PLAYER, quiet)).sort(), ['percent', 'pips', 'showValues']);
eq('a masked clock is still counted while its values are public',
    clock(PLAYER, masked).pips.length, 6);
eq('the GM always counts', clock(GM, quiet).pips.length, 6);
eq('an overfull clock does not overflow its segments',
    V.projectClock({ current: 9, total: 6, isGM: GM, entity: open }).pips.filter((pip) => pip.filled).length, 6);
eq('a segmentless clock is an empty row',
    V.projectClock({ current: 0, total: 0, isGM: GM, entity: open }).pips, []);
eq('a fractional segment count does not make a fractional pip',
    V.projectClock({ current: 1.7, total: 4.2, isGM: GM, entity: open }).pips.length, 4);

// ── the mask has a name, and the row may pick its own ────────────────────────
// A bare "???" says something is withheld and nothing about what sort of thing.
// The default comes from the caller because kinds are the app's idea; the row's
// own maskLabel beats it, so a GM can name one Thread without any call site
// gaining an argument to forget.
const KIND = 'Unknown activity — ???';
const named = { ...masked, maskLabel: 'Somebody is asking questions — ???' };

eq('the kind default replaces a bare ???',
    V.projectIdentity(masked, PLAYER, KIND).name, KIND);
eq("the row's own name wins", V.projectIdentity(named, PLAYER, KIND).name, named.maskLabel);
eq('whitespace is not a name',
    V.projectIdentity({ ...masked, maskLabel: '   ' }, PLAYER, KIND).name, KIND);
eq('a mask name never reaches an unmasked row',
    V.projectIdentity({ ...open, maskLabel: 'x' }, PLAYER, KIND).name, 'Preparing Siege Engines');
eq('the GM reads through a named mask too',
    V.projectIdentity(named, GM, KIND).name, 'Preparing Siege Engines');
eq('a named mask still carries no original anywhere',
    JSON.stringify(V.projectIdentity(named, PLAYER, KIND)).includes('Siege'), false);
eq('a force chip takes its own name as readily',
    V.projectForceChip({ ...legion, visibility: 'masked', maskLabel: 'A third party — ???' },
        PLAYER).name, 'A third party — ???');

// ── the note that stands in for a reading ────────────────────────────────────
// A masked row keeps its bar by default and that is usually right. A rumour is
// not that precise, so writing one replaces the reading outright — and writing
// it IS the switch, which is why there is no second toggle to get out of step.
const rumour = { ...masked, maskNote: 'Rumours about a foreigner with a loaded purse.' };

eq('a masked row with a note hands it over',
    V.maskNoteOf(rumour, PLAYER), 'Rumours about a foreigner with a loaded purse.');
eq('a masked row without one keeps its bar', V.maskNoteOf(masked, PLAYER), '');
eq('the GM never gets the stand-in', V.maskNoteOf(rumour, GM), '');
eq('an unmasked row never gets it either',
    V.maskNoteOf({ ...open, maskNote: 'x' }, PLAYER), '');
eq('a hidden row is gone before this matters',
    V.maskNoteOf({ ...hidden, maskNote: 'x' }, PLAYER), '');
eq('whitespace is not a note', V.maskNoteOf({ ...masked, maskNote: '  \n ' }, PLAYER), '');
eq('a note is trimmed', V.maskNoteOf({ ...masked, maskNote: '  heard it  ' }, PLAYER), 'heard it');
eq('a non-string note is no note', V.maskNoteOf({ ...masked, maskNote: 7 }, PLAYER), '');

// ── the mode is part of what a mask withholds ────────────────────────────────
// Contested means somebody is being opposed, invest means somebody is paying, a
// clock means somebody is running out of time. That is the nature of the thing,
// which is what the mask is for — so a masked row hands back null and the caller
// has nothing left to build a chip out of, nor a shape to draw with.
eq('a masked Thread has no mode', V.projectMode(masked, PLAYER, 'contested'), null);
eq('a visible Thread keeps it', V.projectMode(open, PLAYER, 'contested'), 'contested');
eq('a numberless Thread still says what it is',
    V.projectMode(quiet, PLAYER, 'clock'), 'clock');
eq('the GM reads the mode through a mask', V.projectMode(masked, GM, 'clock'), 'clock');
eq('a missing mode is null, never undefined', V.projectMode(open, PLAYER, undefined), null);
eq('no mode name survives a mask anywhere',
    JSON.stringify(V.projectMode(masked, PLAYER, 'invest') ?? ''), '""');

// ── depleting ───────────────────────────────────────────────────────────
// A bar that drains while its neighbours fill says the loudest thing a mode chip
// could have said: this one is running out. So the direction goes with the chip
// under a mask — and stays under hideValues, which withholds arithmetic and not
// shape.

eq('a masked Thread does not drain', V.projectCountdown(masked, PLAYER, true), false);
eq('a visible one does', V.projectCountdown(open, PLAYER, true), true);
eq('withheld numbers do not straighten the bar out',
    V.projectCountdown(quiet, PLAYER, true), true);
eq('the GM watches it drain through a mask', V.projectCountdown(masked, GM, true), true);
eq('a Thread that does not deplete never starts',
    V.projectCountdown(open, PLAYER, false), false);
eq('and undefined is false, never undefined',
    V.projectCountdown(open, PLAYER, undefined), false);

eq('what is left is the total less what is spent', V.leftOf(3, 8), 5);
eq('a full reading has nothing left', V.leftOf(8, 8), 0);
// Pushing past a full clock is the ordinary way to say "and then some", and a
// reading of minus two rations left is arithmetic showing through the fiction.
eq('an overrun clamps at nothing left', V.leftOf(11, 8), 0);
eq('a negative reading clamps at the top', V.leftOf(-3, 8), 8);
eq('no total means nothing to have left', V.leftOf(3, 0), 0);

const DOWN = { current: 3, total: 8, isGM: PLAYER, entity: open, countdown: true };
eq('a depleting reading counts what is left', V.projectProgress(DOWN).current, 5);
eq('against the same total it always had', V.projectProgress(DOWN).total, 8);
eq('and its bar is what is left, not what is spent',
    V.projectProgress(DOWN).percent, 63);
eq('the same Thread read upwards is the other number',
    V.projectProgress({ ...DOWN, countdown: false }).current, 3);

// The key set is the leak check, and it must not have been widened: a withheld
// reading carries a width and nothing else, depleting or not.
eq('a withheld depleting reading still carries no count',
    Object.keys(V.projectProgress({ ...DOWN, entity: quiet })).sort(),
    ['percent', 'showValues']);

const PIPS = V.projectClock({ current: 3, total: 8, isGM: PLAYER, entity: open, countdown: true });
eq('a depleting clock lights what is left', PIPS.pips.filter((p) => p.filled).length, 5);
eq('and empties from the right', PIPS.pips.map((p) => p.filled),
    [true, true, true, true, true, false, false, false]);
eq('the same clock read upwards lights three',
    V.projectClock({ current: 3, total: 8, isGM: PLAYER, entity: open }).pips
        .filter((p) => p.filled).length, 3);
eq('a withheld depleting clock has no pips to count',
    V.projectClock({ current: 3, total: 8, isGM: PLAYER, entity: quiet, countdown: true }).pips,
    null);

// A contest of attrition, drawn one side at a time. Each contender is its own
// call through the same funnel against the SAME total, which is the whole of
// what makes "left of what, for whom?" answerable: left of the shared
// threshold, for that side.
const side = (spent) => V.projectProgress(
    { current: spent, total: 12, isGM: PLAYER, entity: open, countdown: true });
eq('a side that has spent five has seven left', side(5).current, 7);
eq('a side that has spent eight has four', side(8).current, 4);
eq('and both are measured against the same threshold', side(8).total, 12);
eq('a spent-out side reads nothing left', side(12).current, 0);
eq('and its bar is empty rather than full', side(12).percent, 0);

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
