/**
 * Where each Thread sits when the prerequisite chain is drawn as a graph.
 *
 * Pure. No Foundry globals, no DOM, no geometry — this decides which COLUMN a
 * Thread belongs in and which arrows exist, and nothing about pixels. The
 * coordinates only the browser knows are measured at render time, off the cards
 * this layering produced.
 *
 * LONGEST PATH, NOT SHORTEST. A Thread sits one column right of its DEEPEST
 * prerequisite, so every arrow points strictly rightward and none of them
 * doubles back. Placing a Thread beside the first prerequisite that happened to
 * resolve would be cheaper and would draw a graph where the reader has to follow
 * arrows backwards to find out what is actually blocking what.
 *
 * ONLY THREADS THAT ARE PART OF A REQUIREMENT ARE DRAWN. A Plot with seven
 * Threads and one dependency between two of them would otherwise put five cards
 * in a column with no arrow on them, which says nothing the list beside it does
 * not say better, and buries the one relationship the reader opened this view
 * for. The rest come back as `orphans` so the caller can say how many there are
 * in a sentence rather than in five boxes.
 *
 * Ids in, ids out. The caller holds rows that have already been through
 * visibility projection and has no interest in this module holding them too —
 * and a suite that compares layers of ids is a suite somebody can read.
 */

import { cyclesIn } from './gating.mjs';

/**
 * @param {Array} rows Threads to lay out, in the order they should appear within
 *                     a column. Anything absent from this list is treated as not
 *                     existing, which is what makes visibility filtering the
 *                     caller's job and not this module's.
 * @returns {{layers: string[][], edges: {from: string, to: string}[],
 *            cycles: string[], unknown: string[], hasEdges: boolean}}
 */
export function layout(rows = []) {
    const known = new Set(rows.map((r) => r.id));

    // Whatever cannot be ordered is set aside rather than guessed at. A ring has
    // no deepest member to measure from, and a renderer that tried would either
    // loop or draw an arrow claiming a direction that is not there.
    const tangled = new Set(cyclesIn(rows));
    const clean = rows.filter((r) => !tangled.has(r.id));

    const prereqsOf = (row) => (row.prereqNodeIds ?? [])
        .filter((id) => known.has(id) && !tangled.has(id));

    // `clean` is acyclic by construction, so this recursion terminates without a
    // visited set — the peel that produced it is the proof.
    const byId = new Map(clean.map((r) => [r.id, r]));
    const depths = new Map();
    const depthOf = (id) => {
        if (depths.has(id)) return depths.get(id);
        const parents = prereqsOf(byId.get(id));
        const depth = parents.length === 0
            ? 0
            : 1 + Math.max(...parents.map(depthOf));
        depths.set(id, depth);
        return depth;
    };

    // A Thread whose prerequisite is not in the list has one the reader may not
    // see — withheld by visibility, or on another Plot. The graph marks it rather
    // than drawing an arrow from nowhere, which would name what it is hiding by
    // pointing at where it would have been.
    const unknown = rows
        .filter((r) => (r.prereqNodeIds ?? []).some((id) => !known.has(id)))
        .map((r) => r.id);
    const hasUnknown = new Set(unknown);

    // Who belongs on the diagram: anything that requires something, anything
    // something requires, and anything waiting on a requirement nobody here can
    // see. Everything else has no relationship to draw.
    const connected = new Set();
    for (const row of clean) {
        const parents = prereqsOf(row);
        if (parents.length === 0 && !hasUnknown.has(row.id)) continue;
        connected.add(row.id);
        for (const id of parents) connected.add(id);
    }

    const drawn = clean.filter((r) => connected.has(r.id));
    const orphans = clean.filter((r) => !connected.has(r.id)).map((r) => r.id);

    const layers = [];
    for (const row of drawn) {
        const depth = depthOf(row.id);
        (layers[depth] ??= []).push(row.id);
    }

    const edges = [];
    for (const row of drawn) {
        for (const from of prereqsOf(row)) edges.push({ from, to: row.id });
    }

    return {
        // A sparse layer is impossible — a Thread at depth n has a parent at
        // n-1, and a parent is always drawn alongside its child — but `??=` on
        // an array leaves holes if one ever were, and a hole renders as an empty
        // column nobody can explain.
        layers: layers.map((ids) => ids ?? []),
        edges,
        cycles: [...tangled],
        unknown,
        orphans,
        hasEdges: edges.length > 0 || unknown.length > 0 || tangled.size > 0
    };
}
