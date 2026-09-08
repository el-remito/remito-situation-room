#!/usr/bin/env node
/**
 * logic/graph-layout.mjs — which column each Thread lands in.
 * `node tools/check-graph-layout.mjs`
 *
 * The layering is the whole of the graph that can be checked without a browser:
 * once the columns are right, the rendering is arithmetic on element positions.
 * So the cases here are the ones that decide a column — a join measured from its
 * deepest parent rather than its first, a ring set aside instead of guessed at,
 * and a prerequisite the reader may not see, which must leave a mark and not an
 * arrow pointing at where it would have been.
 */

import { layout } from '../scripts/logic/graph-layout.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\ngraph-layout.mjs\n');

const n = (id, ...prereqNodeIds) => ({ id, prereqNodeIds });

// ── nothing to draw ──────────────────────────────────────────────────────────
eq('an empty Plot lays out to nothing', layout([]),
    { chains: {}, layers: [], edges: [], cycles: [], unknown: [], orphans: [], hasEdges: false });

// The rule that keeps this view worth opening: a Thread with no relationship to
// draw is not drawn. Five cards with no arrow on them say nothing the list beside
// them does not say better, and bury the one relationship somebody came to see.
const LOOSE = layout([n('a'), n('b'), n('c')]);
eq('Threads with no requirements are not drawn at all', LOOSE.layers, []);
eq('they are reported so the caller can count them', LOOSE.orphans, ['a', 'b', 'c']);
eq('and there is nothing to draw between them', LOOSE.hasEdges, false);

const ONE = layout([n('a'), n('b', 'a'), n('c'), n('d')]);
eq('a lone dependency brings both its ends and nobody else', ONE.layers, [['a'], ['b']]);
eq('the unrelated Threads are set aside', ONE.orphans, ['c', 'd']);

// ── a chain ──────────────────────────────────────────────────────────────────
const LINE = [n('a'), n('b', 'a'), n('c', 'b')];
eq('a chain is one Thread per column', layout(LINE).layers, [['a'], ['b'], ['c']]);
eq('every step is an arrow', layout(LINE).edges,
    [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);

// The order rows arrive in must not decide the shape, only the order within a
// column — the board sorts Threads by `sort`, and that is not the graph's word.
eq('the columns hold however the rows were handed over',
    layout([LINE[2], LINE[0], LINE[1]]).layers, [['a'], ['b'], ['c']]);

// ── the case longest-path exists for ─────────────────────────────────────────
// d requires a (column 0) and c (column 2). Measured from its first parent it
// would land in column 1, with an arrow from c doubling back into it.
const DIAMOND = [n('a'), n('b', 'a'), n('c', 'b'), n('d', 'a', 'c')];
eq('a join sits past its DEEPEST requirement, not its first',
    layout(DIAMOND).layers, [['a'], ['b'], ['c'], ['d']]);
eq('and it keeps both arrows', layout(DIAMOND).edges.filter((e) => e.to === 'd'),
    [{ from: 'a', to: 'd' }, { from: 'c', to: 'd' }]);

eq('two Threads at the same depth share a column',
    layout([n('a'), n('b', 'a'), n('c', 'a')]).layers, [['a'], ['b', 'c']]);

// ── a requirement the reader cannot see ──────────────────────────────────────
const HIDDEN = layout([n('a'), n('b', 'gone')]);
eq('a Thread requiring something absent is marked', HIDDEN.unknown, ['b']);
eq('and no arrow is drawn from where it would have been', HIDDEN.edges, []);
// It is still ON the diagram: it has a requirement, and being told there is one
// is the whole of what this reader is allowed to know.
eq('it sits at the front, having nothing visible in front of it',
    HIDDEN.layers, [['b']]);
eq('the Thread beside it has no relationship and is not drawn',
    HIDDEN.orphans, ['a']);
eq('the mark alone is enough to be worth drawing the graph', HIDDEN.hasEdges, true);

// ── rings ────────────────────────────────────────────────────────────────────
const RING = layout([n('a', 'c'), n('b', 'a'), n('c', 'b'), n('z')]);
eq('a ring is set aside rather than laid out', RING.cycles.sort(), ['a', 'b', 'c']);
eq('what is left has no requirement to draw', RING.layers, []);
eq('and nothing is drawn into the ring', RING.edges, []);
eq('a graph that is only a ring says so', RING.hasEdges, true);

eq('a Thread requiring itself is set aside too',
    layout([n('a', 'a'), n('b')]).cycles, ['a']);

// A Thread that requires a ring member is unreachable for the same reason and is
// set aside with it — but the Thread it ALSO requires is fine and stays drawn.
const BEHIND = layout([n('a', 'b'), n('b', 'a'), n('c', 'a'), n('d')]);
eq('a Thread waiting behind a ring goes with it', BEHIND.cycles.sort(), ['a', 'b', 'c']);
eq('and the untangled remainder has nothing left to point at', BEHIND.layers, []);
eq('so it is an orphan rather than a lone column', BEHIND.orphans, ['d']);

// ── chains ───────────────────────────────────────────────────────────────────
// What the Requirements search filters by. A chain is the piece of work a Thread
// belongs to, and the reason it is WEAKLY connected — arrows read in either
// direction — is that somebody who types the name of a Thread halfway along one
// wants both what it waits on and what is waiting on it.

eq('a chain is named after its first member', layout(LINE).chains,
    { a: 'a', b: 'a', c: 'a' });

// The name has to be stable, because it reaches a data attribute that a filter
// compares. Handing the same rows over in another order is the same board.
eq('and the name follows the rows, not the order they arrived in',
    new Set(Object.values(layout([LINE[2], LINE[0], LINE[1]]).chains)).size, 1);

// The whole reason this is a component and not an ancestry walk: b and c never
// point at each other, and a reader looking at one wants to know about the other.
eq('two Threads that only share a requirement are in one chain',
    layout([n('a'), n('b', 'a'), n('c', 'a')]).chains, { a: 'a', b: 'a', c: 'a' });

eq('a diamond is one chain, not two',
    new Set(Object.values(layout(DIAMOND).chains)).size, 1);

// The uniform part, and the point of doing it this way: a loose Thread is not an
// exception the filter has to know about, it is a chain with one member in it.
eq('a Thread that requires nothing is a chain of its own',
    layout([n('a'), n('b', 'a'), n('x')]).chains, { a: 'a', b: 'a', x: 'x' });

eq('two separate pieces of work do not share a name',
    layout([n('a'), n('b', 'a'), n('y'), n('z', 'y')]).chains,
    { a: 'a', b: 'a', y: 'y', z: 'y' });

// A ring has no chain because it has no card: it is named in a sentence under
// the graph instead. Handing it one would put it in the filter's world.
eq('a ring gets no chain at all',
    Object.keys(layout([n('a', 'c'), n('b', 'a'), n('c', 'b'), n('z')]).chains), ['z']);

// A requirement nobody here can see joins nothing — there is no second end for
// the arrow to reach, so the Thread stands alone however loudly it is marked.
eq('a Thread waiting on something unseen is still its own chain',
    layout([n('a'), n('b', 'gone')]).chains, { a: 'a', b: 'b' });

// ── no holes ─────────────────────────────────────────────────────────────────
eq('every column drawn has something in it',
    layout(DIAMOND).layers.every((col) => Array.isArray(col) && col.length > 0), true);

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
