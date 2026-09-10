#!/usr/bin/env node
/**
 * logic/expiry.mjs — how long a Thread has left. `node tools/check-expiry.mjs`
 *
 * The load-bearing question here is `ridesClock`: which of the board's clocks
 * moves a given deadline. It has three settings and its Plot has three
 * behaviours, and every one of those nine combinations is a different answer to
 * "did pressing that button just cost this Thread a cycle?" — a question nothing
 * on screen can answer after the fact. So the grid is asserted whole rather than
 * sampled.
 */

import * as X from '../scripts/logic/expiry.mjs';
import { EXPIRY_CLOCK, TURN_BEHAVIOUR, NODE_STATUS } from '../scripts/constants.mjs';
import { normalizeNode, normalizePlot, normalizeConstants } from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nexpiry.mjs\n');

const PLOT = 'p-northwall';
const OTHER = 'p-road';

const plot = (turnBehaviour = TURN_BEHAVIOUR.DEFAULT, id = PLOT) =>
    normalizePlot({ id, name: 'Northwall', turnBehaviour });

const node = (extra = {}) => normalizeNode({
    id: 'n-gate', plotId: PLOT, name: 'Breaching the Gate',
    expiryOn: true, expirySize: 3, ...extra
});

// ── the readings ─────────────────────────────────────────────────────────────
eq('a Thread has no deadline unless given one', X.hasExpiry(normalizeNode({})), false);
eq('one with the switch on has one', X.hasExpiry(node()), true);
// Time cannot run out on something that already ended, and a cycle that kept
// counting one down would eventually say a finished assault ran out of time.
eq('a concluded Thread keeps none',
    X.hasExpiry(node({ status: NODE_STATUS.CONCLUDED })), false);
eq('and is therefore never expired, however far its count ran',
    X.isExpired(node({ status: NODE_STATUS.CONCLUDED, progress: { expiry: 9 } })), false);

eq('a size below one is impossible', X.expirySize(node({ expirySize: 0 })), 1);
eq('a fresh deadline has spent nothing', X.expirySpent(node()), 0);
eq('and all of it is left', X.expiryLeft(node()), 3);
eq('two spent leaves one', X.expiryLeft(node({ progress: { expiry: 2 } })), 1);
eq('three of three is run out', X.isExpired(node({ progress: { expiry: 3 } })), true);
eq('and so is a count past it', X.isExpired(node({ progress: { expiry: 5 } })), true);
eq('with nothing left rather than a negative', X.expiryLeft(node({ progress: { expiry: 5 } })), 0);
eq('a Thread without one is never run out',
    X.isExpired(normalizeNode({ progress: { expiry: 9 } })), false);

// ── which clock: all nine ────────────────────────────────────────────────────
// Rows are the setting, columns are what the Plot is doing, and the value is
// whether the WORLD's cycle moves it and then whether the PLOT's own does.
const grid = (on, behaviour) => [
    X.ridesClock(node({ expiryClock: on }), plot(behaviour), null),
    X.ridesClock(node({ expiryClock: on }), plot(behaviour), PLOT)
];

eq('world / plot on the world clock', grid(EXPIRY_CLOCK.WORLD, TURN_BEHAVIOUR.DEFAULT), [true, false]);
// The one worth stating out loud: an ultimatum waiting at the end of an envoy's
// journey still expires on the day it said it would, whatever calendar the
// journey is counted in.
eq('world / plot isolated — still the world s',
    grid(EXPIRY_CLOCK.WORLD, TURN_BEHAVIOUR.ISOLATED), [true, false]);
eq('world / plot off the calendar — still the world s',
    grid(EXPIRY_CLOCK.WORLD, TURN_BEHAVIOUR.NONE), [true, false]);

eq('plot / plot on the world clock — nothing moves it',
    grid(EXPIRY_CLOCK.PLOT, TURN_BEHAVIOUR.DEFAULT), [false, false]);
eq('plot / plot isolated — its own cycle, and only that',
    grid(EXPIRY_CLOCK.PLOT, TURN_BEHAVIOUR.ISOLATED), [false, true]);
eq('plot / plot off the calendar — nothing moves it',
    grid(EXPIRY_CLOCK.PLOT, TURN_BEHAVIOUR.NONE), [false, false]);

eq('fiat / world clock', grid(EXPIRY_CLOCK.FIAT, TURN_BEHAVIOUR.DEFAULT), [false, false]);
eq('fiat / isolated', grid(EXPIRY_CLOCK.FIAT, TURN_BEHAVIOUR.ISOLATED), [false, false]);
eq('fiat / off the calendar', grid(EXPIRY_CLOCK.FIAT, TURN_BEHAVIOUR.NONE), [false, false]);

eq('a Thread with no deadline rides nothing',
    X.ridesClock(normalizeNode({}), plot(), null), false);
// Another Plot's button must not move this one's Threads.
eq('and a Plot cycle only moves its own Threads',
    X.ridesClock(node({ expiryClock: EXPIRY_CLOCK.PLOT }),
        plot(TURN_BEHAVIOUR.ISOLATED), OTHER), false);

// ── stranded ─────────────────────────────────────────────────────────────────
eq('set to the Plot s clock on an isolated Plot is fine',
    X.isStranded(node({ expiryClock: EXPIRY_CLOCK.PLOT }), plot(TURN_BEHAVIOUR.ISOLATED)), false);
eq('on a Plot that went back to the world s clock it is stranded',
    X.isStranded(node({ expiryClock: EXPIRY_CLOCK.PLOT }), plot(TURN_BEHAVIOUR.DEFAULT)), true);
eq('and on one that keeps no clock at all',
    X.isStranded(node({ expiryClock: EXPIRY_CLOCK.PLOT }), plot(TURN_BEHAVIOUR.NONE)), true);
eq('the world s clock is never stranded',
    X.isStranded(node({ expiryClock: EXPIRY_CLOCK.WORLD }), plot(TURN_BEHAVIOUR.NONE)), false);
eq('nor is fiat, which was never waiting on a clock',
    X.isStranded(node({ expiryClock: EXPIRY_CLOCK.FIAT }), plot(TURN_BEHAVIOUR.NONE)), false);

// ── one turn ─────────────────────────────────────────────────────────────────
eq('a tick spends one cycle', X.tick(node()).progress.expiry, 1);
eq('and leaves the Thread s own progress alone',
    X.tick(node({ progress: { pool: 4 } })).progress.pool, 4);
// There is no such thing as running out further, and a count climbing past the
// size would make the reading on the row a lie about how overdue something is.
eq('a deadline already run out does not move',
    X.tick(node({ progress: { expiry: 3 } })), null);
eq('and neither does one that was never given', X.tick(normalizeNode({})), null);

// ── moved by hand ────────────────────────────────────────────────────────────
// The inversion, which is the easiest thing in this module to get backwards and
// the hardest to notice: the GM types in the direction the ROW moves, and what
// is stored is what has been SPENT.
eq('typing minus one spends a Cycle', X.spendBy(node(), -1), 1);
eq('so the reading falls by one',
    X.expiryLeft({ ...node(), progress: { expiry: X.spendBy(node(), -1) } }), 2);
eq('and typing plus one hands one back',
    X.spendBy(node({ progress: { expiry: 2 } }), 1), 1);
eq('spending past the end clamps at run out', X.spendBy(node(), -9), 3);
eq('and handing back more than was taken clamps at untouched',
    X.spendBy(node({ progress: { expiry: 2 } }), 9), 0);
eq('typing nothing moves nothing', X.spendBy(node({ progress: { expiry: 1 } }), 0), 1);
// Applied twice the inversion is a no-op, which is what lets the chronicle
// print the figure the GM typed rather than the one underneath it.
eq('display in, display out', -(X.spendBy(node(), -2) - X.expirySpent(node())), -2);

// ── the whole cycle ──────────────────────────────────────────────────────────
{
    const plots = [plot(TURN_BEHAVIOUR.DEFAULT), plot(TURN_BEHAVIOUR.ISOLATED, OTHER)];
    const nodes = [
        node({ id: 'n-a', expiryClock: EXPIRY_CLOCK.WORLD }),
        node({ id: 'n-b', expiryClock: EXPIRY_CLOCK.FIAT }),
        node({ id: 'n-c', plotId: OTHER, expiryClock: EXPIRY_CLOCK.PLOT }),
        // On the world's clock and already at its line: it does not appear,
        // because nothing about it moves.
        node({ id: 'n-d', progress: { expiry: 3 } }),
        normalizeNode({ id: 'n-e', plotId: PLOT, name: 'no deadline' })
    ];

    eq('the world s cycle moves the world s deadlines and nobody else s',
        X.expiringOn(nodes, plots, null).map((r) => r.node.id), ['n-a']);
    eq('and a Plot s own cycle moves only its own',
        X.expiringOn(nodes, plots, OTHER).map((r) => r.node.id), ['n-c']);
    eq('a Plot on the world s clock has no deadlines of its own to move',
        X.expiringOn(nodes, plots, PLOT).map((r) => r.node.id), []);

    // The distinction the chronicle and the bill both hang on: counting down is
    // not a development, arriving at nothing is.
    const nearly = [node({ id: 'n-f', progress: { expiry: 2 } })];
    eq('a deadline merely counting down does not expire',
        X.expiringOn(nodes, plots, null)[0].expires, false);
    eq('and the last cycle of one does',
        X.expiringOn(nearly, plots, null)[0].expires, true);
}

// ── what it is called ────────────────────────────────────────────────────────
// Three steps, and the last one is deliberately somebody else's: the built-in
// word is localized and this layer has no i18n. '' is "ask ui/clock.mjs".
eq('a bare Thread in a bare world has no word of its own',
    X.expiryWord(node(), normalizeConstants({})), '');
eq('the world s word carries',
    X.expiryWord(node(), normalizeConstants({ expiryLabel: 'Closed' })), 'Closed');
eq('and the Thread s own beats it',
    X.expiryWord(node({ expiryLabel: 'Sailed' }),
        normalizeConstants({ expiryLabel: 'Closed' })), 'Sailed');
eq('a word of spaces is no word at all',
    X.expiryWord(node({ expiryLabel: '   ' }), normalizeConstants({})), '');

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
