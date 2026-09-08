#!/usr/bin/env node
/**
 * logic/gating.mjs — the three gates, and the loops the editor must not let a GM
 * author. `node tools/check-gating.mjs`
 *
 * Why this suite is worth its length: a gate is invisible when it works. A Thread
 * that is open looks exactly like a Thread with no gate on it, so the only thing
 * that ever proves the feature is a case where it SHUTS — and the cases that
 * matter are the combinations. A reveal that also cleared a prerequisite, or a
 * lock that stopped applying once State moved past the Phase that set it, would
 * both look correct on the one Plot a GM happened to try.
 */

import * as G from '../scripts/logic/gating.mjs';
import { normalizePlot, normalizeNode } from '../scripts/data/normalize.mjs';
import { NODE_STATUS } from '../scripts/constants.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\ngating.mjs\n');

/** A Plot with a ladder; every fixture below sets its own State. */
const plotAt = (state, phases = []) => normalizePlot({
    id: 'p1', name: 'A Plot', state, stateMin: 0, stateMax: 100, phases
});

const node = (fields) => normalizeNode({ plotId: 'p1', status: NODE_STATUS.ACTIVE, ...fields });

const LADDER = [
    { id: 'ph0', label: 'Calm', threshold: 0 },
    { id: 'ph1', label: 'Tense', threshold: 50, revealNodeIds: ['n2'] },
    { id: 'ph2', label: 'Rain of Fire', threshold: 80, lockNodeIds: ['n1'] }
];

// ── which Phases have fired ──────────────────────────────────────────────────
eq('at the floor, only the floor has fired',
    G.reachedPhases(plotAt(0, LADDER)).map((p) => p.id), ['ph0']);
eq('reaching a rung fires it and everything under it',
    G.reachedPhases(plotAt(60, LADDER)).map((p) => p.id), ['ph0', 'ph1']);
eq('the whole ladder fires at the top',
    G.reachedPhases(plotAt(95, LADDER)).map((p) => p.id), ['ph0', 'ph1', 'ph2']);
eq('a Plot with no ladder has fired nothing', G.reachedPhases(plotAt(50, [])), []);

// The chip names phases[0] below every threshold, and the gates must agree with
// the chip or the board contradicts itself.
const HIGH = [{ id: 'phA', label: 'Calm', threshold: 10, revealNodeIds: ['n2'] }];
eq('a ladder above its own floor still fires its lowest rung',
    G.reachedPhases(plotAt(0, HIGH)).map((p) => p.id), ['phA']);

// ── what the ladder did ──────────────────────────────────────────────────────
eq('a rung not reached has done nothing', G.phaseGate(plotAt(20, LADDER)),
    { revealed: [], locked: [] });
eq('a reached rung reveals', G.phaseGate(plotAt(60, LADDER)),
    { revealed: ['n2'], locked: [] });
eq('the reveal survives climbing past it', G.phaseGate(plotAt(95, LADDER)),
    { revealed: ['n2'], locked: ['n1'] });

const RELOCK = [
    { id: 'a', threshold: 0, revealNodeIds: ['n1'] },
    { id: 'b', threshold: 50, lockNodeIds: ['n1'] }
];
eq('a later rung is the last word on a Thread an earlier one opened',
    G.phaseGate(plotAt(60, RELOCK)), { revealed: [], locked: ['n1'] });
eq('and below that rung the earlier word still stands',
    G.phaseGate(plotAt(10, RELOCK)), { revealed: ['n1'], locked: [] });

eq('named in both lists of one rung, a Thread is locked',
    G.phaseGate(plotAt(10, [{ id: 'a', threshold: 0, revealNodeIds: ['n1'], lockNodeIds: ['n1'] }])),
    { revealed: [], locked: ['n1'] });

// ── prerequisites ────────────────────────────────────────────────────────────
const CHAIN = [
    node({ id: 'n1', name: 'Breach the Wall' }),
    node({ id: 'n2', name: 'Storm the Keep', prereqNodeIds: ['n1'] })
];
eq('an unfinished prerequisite is owed', G.unmetPrereqs(CHAIN[1], CHAIN), ['n1']);

const DONE = [{ ...CHAIN[0], status: NODE_STATUS.CONCLUDED }, CHAIN[1]];
eq('a concluded prerequisite is not', G.unmetPrereqs(DONE[1], DONE), []);
eq('a Thread with no prerequisites owes nothing', G.unmetPrereqs(CHAIN[0], CHAIN), []);
eq('a prerequisite that no longer exists is not owed',
    G.unmetPrereqs(node({ id: 'n9', prereqNodeIds: ['gone'] }), CHAIN), []);

// ── the three gates together ─────────────────────────────────────────────────
const open = (n, plot, nodes) => G.gateOf(n, plot, nodes).open;
const plain = plotAt(0, []);

eq('an ordinary Thread is open', open(CHAIN[0], plain, CHAIN), true);
eq('an unmet prerequisite shuts it', open(CHAIN[1], plain, CHAIN), false);
eq('meeting it opens it', open(DONE[1], plain, DONE), true);

const shutByGM = node({ id: 'n2', status: NODE_STATUS.LOCKED });
eq('the switch the GM threw shuts it', open(shutByGM, plain, [shutByGM]), false);
eq('and a Phase that reveals it opens it again',
    open(shutByGM, plotAt(60, LADDER), [shutByGM]), true);
eq('a reveal reports itself, so the row can say who opened it',
    G.gateOf(shutByGM, plotAt(60, LADDER), [shutByGM]).revealed, true);

// The independence that matters: a reveal is not a skeleton key.
const shutBoth = node({ id: 'n2', status: NODE_STATUS.LOCKED, prereqNodeIds: ['n1'] });
const bothRows = [CHAIN[0], shutBoth];
eq('a reveal does not pay off a prerequisite',
    G.gateOf(shutBoth, plotAt(60, LADDER), bothRows),
    { open: false, manual: true, revealed: true, phaseLocked: false, unmet: ['n1'] });

const n1 = CHAIN[0];
eq('a Phase lock shuts an otherwise open Thread',
    open(n1, plotAt(95, LADDER), CHAIN), false);
eq('and it reopens when State falls back below that Phase',
    open(n1, plotAt(60, LADDER), CHAIN), true);
eq('a Phase lock beats an earlier reveal of the same Thread',
    open(node({ id: 'n1' }),
        plotAt(95, [{ id: 'ph3', threshold: 10, revealNodeIds: ['n1'] },
            { id: 'ph4', threshold: 92, lockNodeIds: ['n1'] }]),
        CHAIN),
    false);

eq('a concluded Thread is finished, not shut',
    G.isShut({ ...CHAIN[1], status: NODE_STATUS.CONCLUDED }, plain, CHAIN), false);
eq('an open Thread is not shut', G.isShut(CHAIN[0], plain, CHAIN), false);
eq('a Thread owing a prerequisite is', G.isShut(CHAIN[1], plain, CHAIN), true);

// ── the graph, and the loops the picker must refuse ──────────────────────────
const LINE = [
    node({ id: 'a' }),
    node({ id: 'b', prereqNodeIds: ['a'] }),
    node({ id: 'c', prereqNodeIds: ['b'] })
];
eq('dependents are found through the chain, not just the first step',
    G.dependentsOf('a', LINE).sort(), ['b', 'c']);
eq('the end of a chain has no dependents', G.dependentsOf('c', LINE), []);

eq('a Thread may not require itself', G.wouldCycle('a', 'a', LINE), true);
eq('a Thread may not require what waits on it', G.wouldCycle('a', 'c', LINE), true);
eq('but it may require what it already waits behind', G.wouldCycle('c', 'a', LINE), false);
eq('an unrelated Thread is always offerable',
    G.wouldCycle('a', 'z', [...LINE, node({ id: 'z' })]), false);

eq('a clean chain has no loops', G.cyclesIn(LINE), []);
const RING = [
    node({ id: 'a', prereqNodeIds: ['c'] }),
    node({ id: 'b', prereqNodeIds: ['a'] }),
    node({ id: 'c', prereqNodeIds: ['b'] })
];
eq('a ring is reported whole', G.cyclesIn(RING).sort(), ['a', 'b', 'c']);
eq('a Thread requiring itself is a ring of one',
    G.cyclesIn([node({ id: 'a', prereqNodeIds: ['a'] })]), ['a']);
eq('a Thread waiting behind a ring is reported with it',
    G.cyclesIn([...RING, node({ id: 'd', prereqNodeIds: ['a'] })]).sort(),
    ['a', 'b', 'c', 'd']);
eq('a Thread beside a ring is left alone',
    G.cyclesIn([...RING, node({ id: 'z' })]).includes('z'), false);

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
