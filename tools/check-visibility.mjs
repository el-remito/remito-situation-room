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

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
