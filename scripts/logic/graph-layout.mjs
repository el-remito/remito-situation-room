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
 * ONLY THREADS THAT ARE PART OF A REQUIREMENT ARE LAID OUT IN COLUMNS. A Plot
 * with seven Threads and one dependency between two of them would otherwise put
 * five cards in a column with no arrow on them, which says nothing the list
 * beside it does not say better, and buries the one relationship the reader
 * opened this view for. The rest come back as `orphans`, for the caller to draw
 * apart from the columns rather than inside them.
 *
 * EVERY ROW THAT IS NOT IN A RING CARRIES A CHAIN. A chain is the weakly
 * connected component: follow the arrows in either direction and you are still
 * in it. That is the unit the Requirements search filters by, and it is the
 * right one — somebody who types the name of a Thread in the middle of a chain
 * wants what it waits on AND what waits on it, and a Thread that merely shares a
 * requirement with it is part of the same piece of work even though no single
 * arrow runs between the two. An orphan is a chain of one, which is what keeps
 * the filter down to one comparison with no second rule for the loose Threads.
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
 *            cycles: string[], unknown: string[], orphans: string[],
 *            chains: Record<string, string>, hasEdges: boolean}}
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
        chains: chainsOf(clean, edges),
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

/**
 * Which chain each row belongs to, as a map of id to chain id.
 *
 * Union-find over the arrows, read as undirected. Every row in `rows` comes back
 * with an answer, including the ones no arrow touches — those are chains of one,
 * and giving them a chain rather than an exception is what lets the caller filter
 * the whole view with a single comparison.
 *
 * A chain is NAMED after the first of its members in input order rather than
 * after whichever id union-find happened to leave on top. The name reaches a data
 * attribute and a suite, and both are easier to read when the same board always
 * produces the same names.
 */
function chainsOf(rows, edges) {
    const parent = new Map(rows.map((r) => [r.id, r.id]));

    const find = (id) => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root);
        // Flatten what was walked, so a long chain is not re-walked once per card.
        let walk = id;
        while (parent.get(walk) !== root) {
            const next = parent.get(walk);
            parent.set(walk, root);
            walk = next;
        }
        return root;
    };

    for (const { from, to } of edges) {
        const a = find(from);
        const b = find(to);
        if (a !== b) parent.set(a, b);
    }

    const named = new Map();
    const chains = {};
    for (const row of rows) {
        const root = find(row.id);
        if (!named.has(root)) named.set(root, row.id);
        chains[row.id] = named.get(root);
    }
    return chains;
}
