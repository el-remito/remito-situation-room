/**
 * Read-time shape repair.
 *
 * There is no migration pass in this module and adding one would be a step
 * backwards (the battle-decks rule). Instead every read runs through here, so a
 * setting written by an older build, hand-edited in the console, or half-written
 * by an interrupted save still yields a complete, typed object. Every field the
 * rest of the codebase reads is guaranteed present after this.
 *
 * Pure: no Foundry globals, no imports beyond constants. `node`-importable, so
 * the shapes can be exercised without launching Foundry.
 */

import {
    CONSTANT_DEFAULTS, ENTITY_DEFAULTS, LIFECYCLE, LOG_KIND, MODE, NODE_STATUS,
    VISIBILITY, VISIBILITY_KINDS, POLARITY, ASSET_MODIFIER, ASSET_CONDITION,
    CONDITION_EFFECT, DEFAULT_CONDITIONS, TURN_BEHAVIOUR
} from '../constants.mjs';

// ── primitives ───────────────────────────────────────────────────────────────

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

/** Finite numbers only — NaN and Infinity from a bad formula must not reach a bar. */
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const int = (v, fallback = 0) => Math.trunc(num(v, fallback));

/** Clamp to a minimum, for thresholds and segment counts that must never be 0 or negative. */
const atLeast = (v, min, fallback) => Math.max(min, int(v, fallback));

/** Accept a value only if it is one of the enum's values, else fall back. */
const oneOf = (v, enumObj, fallback) =>
    (Object.values(enumObj).includes(v) ? v : fallback);

/**
 * A last-resort id for a row that arrived without one.
 *
 * crypto.randomUUID exists only in a SECURE context, and a player joining a game
 * over the LAN at http://192.168.x.x:30000 is not in one — the call is simply
 * undefined there. This file is Foundry-free by design and cannot reach
 * foundry.utils.randomID, so it carries its own fallback rather than throwing on
 * exactly the clients least able to report why.
 */
const randomId = () => (globalThis.crypto?.randomUUID?.()
    ?? `rsr-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`);

const id = (v) => (typeof v === 'string' && v.length ? v : randomId());

/** What every entity carries about what the table sees of it. */
const entityBase = (raw) => ({
    visibility: oneOf(raw?.visibility, VISIBILITY, ENTITY_DEFAULTS.visibility),
    hideValues: bool(raw?.hideValues, ENTITY_DEFAULTS.hideValues),
    // What this row is CALLED while masked. Empty means the default for its
    // kind — "Unknown activity — ???" and its siblings — which is why this is a
    // free string with no fallback baked in: the fallback is a localized thing
    // and this file is not allowed to know about those.
    maskLabel: str(raw?.maskLabel),
    isExample: bool(raw?.isExample, ENTITY_DEFAULTS.isExample)
});

/** Strengths and weaknesses: free text plus a polarity, nothing more. */
const tags = (raw) => arr(raw)
    .filter(isObj)
    .map((t) => ({
        text: str(t.text),
        polarity: oneOf(t.polarity, POLARITY, POLARITY.STRENGTH)
    }))
    .filter((t) => t.text.length > 0);

/** Ids referencing other entities. Deduped; existence is checked by the caller, not here. */
const idList = (raw) => [...new Set(arr(raw).filter((v) => typeof v === 'string' && v.length))];

/**
 * Which grouping each Force on a Plot stands in — "the besiegers", "the relief
 * column". Purely cosmetic: nothing reads a grouping to decide anything, it only
 * decides how the roster is printed.
 *
 * Stored as a plain label per Force rather than as group records with ids, because
 * a group has no identity beyond its name. Renaming one is retyping it, and a
 * group stops existing when the last Force leaves it, with nothing left behind to
 * clean up. Entries for Forces no longer on the Plot are dropped here.
 */
const forceGroups = (raw, memberIds) => {
    if (!isObj(raw)) return {};
    const out = {};
    for (const [forceId, label] of Object.entries(raw)) {
        if (!memberIds.includes(forceId)) continue;
        const text = str(label).trim().slice(0, 64);
        if (text) out[forceId] = text;
    }
    return out;
};

// ── entities ─────────────────────────────────────────────────────────────────

export function normalizePhase(raw = {}) {
    return {
        id: id(raw.id),
        label: str(raw.label),
        tone: str(raw.tone, 'neutral'),
        threshold: int(raw.threshold, 0),
        // Two texts, two audiences. `description` is what this Phase looks like
        // from the table and is printed under the State bar for everyone;
        // `gmNotes` is what the GM has to remember to do about it.
        description: str(raw.description),
        gmNotes: str(raw.gmNotes),
        revealNodeIds: idList(raw.revealNodeIds),
        lockNodeIds: idList(raw.lockNodeIds)
    };
}

export function normalizePlot(raw = {}) {
    return {
        id: id(raw.id),
        name: str(raw.name),
        description: str(raw.description),
        lifecycle: oneOf(raw.lifecycle, LIFECYCLE, LIFECYCLE.ACTIVE),
        state: int(raw.state, 0),
        // The bar needs an explicit domain: State is a signed number whose meaning
        // the GM chooses, so there is nothing to infer a maximum from. Deriving it
        // from the Phase thresholds would make every bar jump when a Phase is added.
        stateMin: int(raw.stateMin, 0),
        stateMax: int(raw.stateMax, 100),
        // Sorted by threshold so state-track can scan without re-sorting on every render.
        phases: arr(raw.phases).filter(isObj).map(normalizePhase)
            .sort((a, b) => a.threshold - b.threshold),
        defaultMode: oneOf(raw.defaultMode, MODE, MODE.FIAT),
        // Which clock this Plot keeps, and where it has got to on it. Every Plot
        // carries a count, not just an isolated one: a Plot that has been riding
        // the world's cycle and is then set loose has to be somewhere sensible
        // when it lands, and "the cycle it was last on" is the only such answer.
        turnBehaviour: oneOf(raw.turnBehaviour, TURN_BEHAVIOUR, TURN_BEHAVIOUR.DEFAULT),
        turnCount: int(raw.turnCount, 0),
        // What this Plot calls its own clock, when it keeps one. Trimmed here so
        // that a label of spaces is no label at all and falls back to the
        // built-in word, rather than drawing a chip with a gap in it.
        turnLabel: str(raw.turnLabel).trim(),
        forceIds: idList(raw.forceIds),
        forceGroups: forceGroups(raw.forceGroups, idList(raw.forceIds)),
        playerAssignable: bool(raw.playerAssignable),
        sort: int(raw.sort, 0),
        // Stands in for the State bar / this Thread's own reading while it
        // is masked. Only a Plot and a Thread carry one, because only they
        // draw a reading for it to replace.
        maskNote: str(raw.maskNote),
        ...entityBase(raw)
    };
}

export function normalizeNode(raw = {}) {
    const progress = isObj(raw.progress) ? raw.progress : {};
    const byForce = {};
    if (isObj(progress.byForce)) {
        for (const [forceId, value] of Object.entries(progress.byForce)) {
            if (typeof forceId === 'string' && forceId.length) byForce[forceId] = int(value, 0);
        }
    }
    return {
        id: id(raw.id),
        plotId: str(raw.plotId),
        name: str(raw.name),
        description: str(raw.description),
        // null means inherit the Plot defaultMode. Resolved in logic/, never here.
        mode: Object.values(MODE).includes(raw.mode) ? raw.mode : null,
        threshold: atLeast(raw.threshold, 1, 9),
        segments: atLeast(raw.segments, 1, 6),
        progress: { pool: int(progress.pool, 0), byForce },
        outcomes: arr(raw.outcomes).filter(isObj).map((o) => ({
            forceId: str(o.forceId),
            delta: int(o.delta, 0),
            note: str(o.note)
        })).filter((o) => o.forceId.length > 0),
        status: oneOf(raw.status, NODE_STATUS, NODE_STATUS.ACTIVE),
        concludedBy: typeof raw.concludedBy === 'string' && raw.concludedBy.length
            ? raw.concludedBy : null,
        // What the conclusion actually moved State by — not the declared delta, which
        // differs whenever State hit a bound. Reopening reverses THIS.
        appliedDelta: int(raw.appliedDelta, 0),
        prereqNodeIds: idList(raw.prereqNodeIds),
        playerAssignable: bool(raw.playerAssignable),
        sort: int(raw.sort, 0),
        // Stands in for the State bar / this Thread's own reading while it
        // is masked. Only a Plot and a Thread carry one, because only they
        // draw a reading for it to replace.
        maskNote: str(raw.maskNote),
        ...entityBase(raw)
    };
}

/**
 * A Force's purse icon, as a Font Awesome class string.
 *
 * This lands in a class attribute, so it is filtered rather than trusted: letters,
 * digits, spaces and dashes only, and short. A GM typing an icon name is not a
 * threat model, but a world file edited by hand or written by an older build is
 * exactly where a stray quote would end up breaking the markup around it.
 */
const iconClass = (raw, fallback = '') => {
    const value = str(raw, '').trim();
    if (!value) return fallback;
    const safe = value.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 64).trim();
    return safe || fallback;
};

export function normalizeForce(raw = {}) {
    return {
        id: id(raw.id),
        name: str(raw.name),
        img: str(raw.img),
        icon: iconClass(raw.icon, CONSTANT_DEFAULTS.forceIcon),
        resources: int(raw.resources, 0),
        income: int(raw.income, 0),
        // Whether this Force draws income at all. The GM pauses a Force directly —
        // income is a property of the Force, not of where it happens to be standing.
        isActive: bool(raw.isActive, true),
        tags: tags(raw.tags),
        isPlayerForce: bool(raw.isPlayerForce),
        sort: int(raw.sort, 0),
        ...entityBase(raw)
    };
}

export function normalizeAsset(raw = {}) {
    const mod = isObj(raw.modifier) ? raw.modifier : {};
    const nullableId = (v) => (typeof v === 'string' && v.length ? v : null);
    return {
        id: id(raw.id),
        forceId: str(raw.forceId),
        name: str(raw.name),
        img: str(raw.img),
        // Optional link to a real Foundry document. Never used as a key — expandObject
        // would explode the dots in a UUID. It is a field on an array element, deliberately.
        uuid: nullableId(raw.uuid),
        tags: tags(raw.tags),
        plotId: nullableId(raw.plotId),
        nodeId: nullableId(raw.nodeId),
        modifier: {
            kind: oneOf(mod.kind, ASSET_MODIFIER, ASSET_MODIFIER.NONE),
            value: int(mod.value, 0)
        },
        // What state it is in. NOT checked against an enum: the conditions are a
        // table the GM owns, so an id here may be one they invented. An id that
        // no longer exists resolves to the fallback at read time (condition.mjs)
        // rather than being rewritten here — deleting a condition must not
        // silently rewrite the Assets that were in it.
        condition: str(raw.condition) || ASSET_CONDITION.READY,
        // Cycles left on the timer. Zero is no timer, which is most Assets.
        conditionCycles: Math.max(0, int(raw.conditionCycles, 0)),
        sort: int(raw.sort, 0),
        ...entityBase(raw)
    };
}

/**
 * One row of the GM's condition table.
 *
 * `id` is generated when absent, because a condition the GM added is referenced by
 * id from every Asset in it — a row that loses its id orphans them all.
 *
 * `becomes` is deliberately NOT checked against the other rows here: normalizing
 * one row cannot see the table, and a successor pointing at a deleted condition
 * resolves to the fallback at read time like any other unknown id.
 */
export function normalizeCondition(raw = {}) {
    return {
        id: id(raw.id),
        // A built-in that has never been renamed carries only a key, and renders
        // in the reader's language. A name the GM typed is not translatable, so it
        // is stored as text and wins from the moment they type it.
        labelKey: str(raw.labelKey),
        label: str(raw.label),
        effect: oneOf(raw.effect, CONDITION_EFFECT, CONDITION_EFFECT.FULL),
        inPlay: bool(raw.inPlay, true),
        cycles: Math.max(0, int(raw.cycles, 0)),
        becomes: str(raw.becomes),
        isFinal: bool(raw.isFinal, false),
        sort: int(raw.sort, 0)
    };
}

/**
 * The whole table, seeded when the world has none.
 *
 * An empty array is what a world that has never opened the conditions editor
 * holds, and it is indistinguishable from one where the GM deleted everything —
 * which is the right way round, because a table with no conditions in it cannot
 * answer "what is normal" and would leave every Asset unreadable.
 */
export function normalizeConditions(raw) {
    const rows = arr(raw).filter(isObj).map(normalizeCondition);
    if (!rows.length) return DEFAULT_CONDITIONS.map((c, i) => normalizeCondition({ ...c, sort: i }));
    // READY is the fallback everything resolves to, so it is restored rather than
    // allowed to go missing. Deleting it is the one edit the editor refuses.
    if (!rows.some((r) => r.id === ASSET_CONDITION.READY)) {
        rows.unshift(normalizeCondition({ ...DEFAULT_CONDITIONS[0], sort: -1 }));
    }
    return rows.sort((a, b) => a.sort - b.sort);
}

export function normalizeTurn(raw = {}) {
    return { count: Math.max(0, int(raw?.count, 0)) };
}

/** World-wide defaults. Every key falls back independently, so a partial save opens. */
export function normalizeConstants(raw = {}) {
    const D = CONSTANT_DEFAULTS;
    return {
        forceResources: int(raw?.forceResources, D.forceResources),
        forceIncome: int(raw?.forceIncome, D.forceIncome),
        forceIcon: iconClass(raw?.forceIcon, D.forceIcon),
        // Costs and sizes cannot be negative; a threshold of zero would conclude a
        // Thread the moment it was created, which reads as a bug rather than a gift.
        assetCost: Math.max(0, int(raw?.assetCost, D.assetCost)),
        threadThreshold: atLeast(raw?.threadThreshold, 1, D.threadThreshold),
        clockSegments: atLeast(raw?.clockSegments, 1, D.clockSegments),
        stateMin: int(raw?.stateMin, D.stateMin),
        stateMax: int(raw?.stateMax, D.stateMax),
        turnLabel: str(raw?.turnLabel, D.turnLabel).trim(),
        defaultVisibility: defaultVisibility(raw?.defaultVisibility)
    };
}

/**
 * One default visibility per kind of row. Each key falls back on its own, so a
 * world saved when this was a single value — or before it existed at all — opens
 * with the safe default rather than with three of the four keys missing.
 */
function defaultVisibility(raw) {
    // A world written before the split stored one string for everything. Honour it
    // rather than silently reverting a GM's choice to the built-in default.
    const legacy = typeof raw === 'string' ? oneOf(raw, VISIBILITY, null) : null;
    const out = {};
    for (const kind of VISIBILITY_KINDS) {
        const fallback = legacy ?? CONSTANT_DEFAULTS.defaultVisibility[kind];
        out[kind] = oneOf(isObj(raw) ? raw[kind] : null, VISIBILITY, fallback);
    }
    return out;
}

/**
 * One line of the chronicle.
 *
 * References only. The sentence is built at render time against the entities'
 * CURRENT visibility, so a Thread revealed later reads plainly in the entries
 * written while it was still a secret — see logic/log.mjs.
 */
export function normalizeLogEntry(raw = {}) {
    const nullableId = (v) => (typeof v === 'string' && v.length ? v : null);
    return {
        id: id(raw.id),
        kind: oneOf(raw.kind, LOG_KIND, LOG_KIND.PUSH),
        turn: Math.max(0, int(raw.turn, 0)),
        at: Math.max(0, int(raw.at, 0)),
        plotId: nullableId(raw.plotId),
        nodeId: nullableId(raw.nodeId),
        forceId: nullableId(raw.forceId),
        assetId: nullableId(raw.assetId),
        amount: int(raw.amount, 0),
        // What the push cost the Force. GM bookkeeping: never printed to a player.
        cost: int(raw.cost, 0),
        // The GM's own words. Written as public fiction, and the only part of an
        // entry that survives when the row it is about is hidden from the table.
        note: str(raw.note),
        // Which condition an Asset was put into, for the one kind that records it.
        // Stored as the id, never the label: the sentence is built at read time
        // like every other, and in the reader's language. Not enum-checked, for
        // the same reason the Asset's own is not.
        condition: str(raw.condition) || ASSET_CONDITION.READY,
        // What the table reads of this one line, set when it was written.
        visibility: oneOf(raw.visibility, VISIBILITY, VISIBILITY.VISIBLE),
        // Whether anything it names was withheld at that moment. Absent on an
        // entry written before the flag existed, and read as false there rather
        // than true: sealing a whole existing chronicle on upgrade would silence
        // lines about rows that were never secret, which is a visible loss to buy
        // a guess. Lines written from here on carry the real answer.
        sealed: bool(raw.sealed, false),
        isExample: bool(raw.isExample, false)
    };
}

// ── collections ──────────────────────────────────────────────────────────────

const collection = (normalizer) => (raw) => arr(raw).filter(isObj).map(normalizer);

export const normalizePlots = collection(normalizePlot);
export const normalizeNodes = collection(normalizeNode);
export const normalizeForces = collection(normalizeForce);
export const normalizeAssets = collection(normalizeAsset);
export const normalizeLog = collection(normalizeLogEntry);
