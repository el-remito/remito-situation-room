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
    ENTITY_DEFAULTS, LIFECYCLE, MODE, NODE_STATUS,
    VISIBILITY, POLARITY, ASSET_MODIFIER
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

const id = (v) => (typeof v === 'string' && v.length ? v : crypto.randomUUID());

/** The visibility/hideValues/isExample triplet every entity carries. */
const entityBase = (raw) => ({
    visibility: oneOf(raw?.visibility, VISIBILITY, ENTITY_DEFAULTS.visibility),
    hideValues: bool(raw?.hideValues, ENTITY_DEFAULTS.hideValues),
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

// ── entities ─────────────────────────────────────────────────────────────────

export function normalizePhase(raw = {}) {
    return {
        id: id(raw.id),
        label: str(raw.label),
        tone: str(raw.tone, 'neutral'),
        threshold: int(raw.threshold, 0),
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
        // Sorted by threshold so state-track can scan without re-sorting on every render.
        phases: arr(raw.phases).filter(isObj).map(normalizePhase)
            .sort((a, b) => a.threshold - b.threshold),
        defaultMode: oneOf(raw.defaultMode, MODE, MODE.FIAT),
        forceIds: idList(raw.forceIds),
        playerAssignable: bool(raw.playerAssignable),
        sort: int(raw.sort, 0),
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
        prereqNodeIds: idList(raw.prereqNodeIds),
        playerAssignable: bool(raw.playerAssignable),
        sort: int(raw.sort, 0),
        ...entityBase(raw)
    };
}

export function normalizeForce(raw = {}) {
    return {
        id: id(raw.id),
        name: str(raw.name),
        img: str(raw.img),
        resources: int(raw.resources, 0),
        income: int(raw.income, 0),
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
            kind: oneOf(mod.kind, ASSET_MODIFIER, ASSET_MODIFIER.COST_REDUCTION),
            value: int(mod.value, 0)
        },
        sort: int(raw.sort, 0),
        ...entityBase(raw)
    };
}

export function normalizeTurn(raw = {}) {
    return { count: Math.max(0, int(raw?.count, 0)) };
}

// ── collections ──────────────────────────────────────────────────────────────

const collection = (normalizer) => (raw) => arr(raw).filter(isObj).map(normalizer);

export const normalizePlots = collection(normalizePlot);
export const normalizeNodes = collection(normalizeNode);
export const normalizeForces = collection(normalizeForce);
export const normalizeAssets = collection(normalizeAsset);
