#!/usr/bin/env node
/**
 * logic/log.mjs and the shape of a stored entry. `node tools/check-log.mjs`
 *
 * The log is the one place where a bug is invisible until it is too late: an
 * entry that leaks a name, or a chronicle that quietly grows without bound inside
 * a world setting replicated to every client. Both are checked here.
 */

import * as Log from '../scripts/logic/log.mjs';
import { normalizeLogEntry, normalizeLog } from '../scripts/data/normalize.mjs';
import { LOG_KIND, VISIBILITY } from '../scripts/constants.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nlog.mjs\n');

// ── building an entry ────────────────────────────────────────────────────────
const push = Log.entry({
    kind: LOG_KIND.PUSH, turn: 3, at: 1000,
    plotId: 'p1', nodeId: 'n1', forceId: 'f1', amount: 2, cost: -2, note: 'The dragon came.'
});

eq('an entry keeps its kind', push.kind, LOG_KIND.PUSH);
eq('an entry keeps its references', [push.plotId, push.nodeId, push.forceId], ['p1', 'n1', 'f1']);
eq('an entry keeps the note', push.note, 'The dragon came.');
eq('an entry stores no rendered text', 'text' in push, false);
eq('an entry stores no names', JSON.stringify(push).includes('Legion'), false);

const bare = Log.entry({ kind: LOG_KIND.CYCLE });
eq('unnamed references are null, not undefined',
    [bare.plotId, bare.nodeId, bare.forceId, bare.assetId], [null, null, null, null]);
eq('numbers default to zero', [bare.amount, bare.cost, bare.turn, bare.at], [0, 0, 0, 0]);
eq('a note defaults to empty', bare.note, '');
eq('junk numbers do not reach the store', Log.entry({ kind: LOG_KIND.PUSH, amount: 'x' }).amount, 0);
eq('fractions are truncated', Log.entry({ kind: LOG_KIND.PUSH, amount: 2.7 }).amount, 2);

// ── the order the chronicle is kept in ───────────────────────────────────────
const A = { id: 'a' };
const B = { id: 'b' };
const C = { id: 'c' };

eq('the newest entry is first', Log.append([A, B], C).map((e) => e.id), ['c', 'a', 'b']);
eq('appending to nothing works', Log.append(undefined, A).map((e) => e.id), ['a']);
eq('appending to junk works', Log.append('nope', A).map((e) => e.id), ['a']);

const many = Array.from({ length: Log.LOG_LIMIT + 20 }, (_, i) => ({ id: `e${i}` }));
eq('the chronicle is capped', Log.append(many, A).length, Log.LOG_LIMIT);
eq('the cap drops the OLDEST', Log.append(many, A)[0].id, 'a');
eq('a limit of zero keeps nothing', Log.append(many, A, 0).length, 0);

// ── reading it back ──────────────────────────────────────────────────────────
const mixed = [
    { id: '1', plotId: 'p1' }, { id: '2', plotId: 'p2' }, { id: '3', plotId: 'p1' }
];
eq('entries can be filtered to one Plot', Log.forPlot(mixed, 'p1').map((e) => e.id), ['1', '3']);
eq('a Plot with no entries reads empty', Log.forPlot(mixed, 'p9'), []);
eq('recent takes from the front', Log.recent(mixed, 2).map((e) => e.id), ['1', '2']);
eq('recent tolerates asking for more than there is', Log.recent(mixed, 99).length, 3);
eq('recent tolerates junk', Log.recent(null, 5), []);

// ── the stored shape ─────────────────────────────────────────────────────────
const stored = normalizeLogEntry({
    kind: 'push', turn: 2, at: 99, plotId: 'p1', nodeId: 'n1', forceId: 'f1',
    assetId: 'a1', amount: 3, cost: -3, note: 'x', isExample: true
});
eq('a stored entry keeps every reference',
    [stored.plotId, stored.nodeId, stored.forceId, stored.assetId], ['p1', 'n1', 'f1', 'a1']);
eq('a stored entry keeps its example tag', stored.isExample, true);
eq('an unknown kind falls back to a push', normalizeLogEntry({ kind: 'wat' }).kind, LOG_KIND.PUSH);
eq('a missing id is generated', typeof normalizeLogEntry({}).id, 'string');
eq('an empty reference normalizes to null', normalizeLogEntry({ plotId: '' }).plotId, null);
eq('a negative cycle count is clamped', normalizeLogEntry({ turn: -5 }).turn, 0);
eq('a spend stays negative', normalizeLogEntry({ cost: -4 }).cost, -4);
eq('a non-string note is dropped', normalizeLogEntry({ note: { evil: true } }).note, '');
eq('a collection filters junk', normalizeLog(['nope', null, { kind: 'cycle' }]).length, 1);
eq('a junk collection reads empty', normalizeLog(undefined), []);

// ── what the table reads of one line ─────────────────────────────────
eq('an entry is public unless told otherwise',
    Log.entry({ kind: LOG_KIND.PUSH }).visibility, VISIBILITY.VISIBLE);
eq('an entry keeps the visibility it was given',
    Log.entry({ kind: LOG_KIND.PUSH, visibility: VISIBILITY.MASKED }).visibility, VISIBILITY.MASKED);
eq('an unknown visibility falls back to public rather than to secret',
    Log.entry({ kind: LOG_KIND.PUSH, visibility: 'wat' }).visibility, VISIBILITY.VISIBLE);
eq('an entry is unsealed unless told otherwise',
    Log.entry({ kind: LOG_KIND.PUSH }).sealed, false);
eq('an entry keeps its seal', Log.entry({ kind: LOG_KIND.PUSH, sealed: 1 }).sealed, true);

// ── the seal ───────────────────────────────────────────────────────
// The rule verification round 5 asked for: revealing a row must not hand the
// table every development that row was ever part of.
const open = { visibility: VISIBILITY.VISIBLE };
const shut = { visibility: VISIBILITY.HIDDEN };
const veiled = { visibility: VISIBILITY.MASKED };
eq('a line naming only public rows is not sealed', Log.sealOf([open, open]), false);
eq('a hidden row seals the line', Log.sealOf([open, shut]), true);
eq('a masked row seals it too — a name withheld then is withheld for good',
    Log.sealOf([open, veiled]), true);
eq('a line naming nothing is not sealed', Log.sealOf([null, null]), false);
eq('sealOf tolerates junk', Log.sealOf(undefined), false);

// ── the stored shape of both ────────────────────────────────────────
eq('a stored entry keeps its visibility',
    normalizeLogEntry({ visibility: VISIBILITY.HIDDEN }).visibility, VISIBILITY.HIDDEN);
eq('an unknown stored visibility reads as public',
    normalizeLogEntry({ visibility: 'wat' }).visibility, VISIBILITY.VISIBLE);
eq('a stored entry keeps its seal', normalizeLogEntry({ sealed: true }).sealed, true);
eq('a line written before the seal existed reads unsealed',
    normalizeLogEntry({ kind: 'push' }).sealed, false);

// ── a condition change is a development ────────────────────────────────
// The condition is stored as its key, never as its label, for the same reason
// nothing else in a line is stored as a sentence.
eq('an entry keeps the condition it names',
    Log.entry({ kind: LOG_KIND.CONDITION, condition: 'destroyed' }).condition, 'destroyed');
eq('an entry names no condition unless it is about one',
    Log.entry({ kind: LOG_KIND.PUSH }).condition, 'ready');
eq('an unrecognised condition reads ready',
    Log.entry({ kind: LOG_KIND.CONDITION, condition: 'besieged' }).condition, 'ready');
eq('a stored entry keeps its condition',
    normalizeLogEntry({ kind: 'condition', condition: 'recovering' }).condition, 'recovering');
eq('condition is a kind the log recognises',
    normalizeLogEntry({ kind: 'condition' }).kind, LOG_KIND.CONDITION);

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
