/**
 * The draft an in-board editor works on, and everything that can be done to it
 * without a DOM.
 *
 * Pure. `node`-importable, exercised by tools/check-editing.mjs.
 *
 * WHY A DRAFT AT ALL. Every other control on this board writes the instant it is
 * pressed — a push, a pause, a commit. An editor is the one place that must not:
 * a half-typed Phase label is not a state of the world, and rendering one onto a
 * player's screen because the GM paused mid-word would be indefensible. So the
 * editor holds a working copy here, and only Save hands a patch to data/state.mjs,
 * which remains the only writer.
 *
 * The draft carries exactly the fields its editor owns, and `patchFrom` hands back
 * exactly those. A Thread's `progress` is not among them, so a push landing while
 * its editor is open survives the save that follows.
 *
 * One field is deliberately draft-only: `groups`. A heading the GM just created
 * has no members yet, so there is nothing to persist it on — a grouping is a label
 * on a Force, not a record (see the plan). It lives in the draft so the empty
 * column can be dropped into, and it is gone the moment the editor closes without
 * anyone standing in it.
 */

import {
    ASSET_CONDITION, ASSET_MODIFIER, CONDITION_EFFECT, DEFAULT_CONDITIONS, EDIT_KIND,
    LIFECYCLE, MODE, NODE_STATUS, POLARITY, TURN_BEHAVIOUR, VISIBILITY
} from '../constants.mjs';

// ── primitives ───────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : '');
const bool = (v) => v === true;
const int = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A heading is one line of display text, trimmed and bounded, or nothing at all. */
export const cleanGroup = (label) => str(label).trim().slice(0, 64);

// ── the field spec ───────────────────────────────────────────────────────────

/**
 * The scalar controls each editor renders, by name and type. One list, read by
 * three things that would otherwise drift apart: the template writes a control per
 * entry, apps/board-editor.mjs harvests by the same names, and the suite checks a
 * round trip. Repeating widgets (Phases, outcomes, chips) are not here — they are
 * structural, and have their own mutations below.
 */
export const FIELDS = {
    [EDIT_KIND.PLOT]: [
        { name: 'name', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'state', type: 'int' },
        { name: 'stateMin', type: 'int' },
        { name: 'stateMax', type: 'int' },
        { name: 'lifecycle', type: 'text' },
        { name: 'turnBehaviour', type: 'text' },
        { name: 'turnLabel', type: 'text' },
        { name: 'defaultMode', type: 'text' },
        { name: 'visibility', type: 'text' },
        { name: 'hideValues', type: 'bool' },
        { name: 'maskLabel', type: 'text' },
        { name: 'maskNote', type: 'text' }
    ],
    [EDIT_KIND.NODE]: [
        { name: 'name', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'mode', type: 'nullable' },
        { name: 'threshold', type: 'int' },
        { name: 'segments', type: 'int' },
        { name: 'status', type: 'text' },
        { name: 'visibility', type: 'text' },
        { name: 'hideValues', type: 'bool' },
        { name: 'maskLabel', type: 'text' },
        { name: 'maskNote', type: 'text' }
    ],
    [EDIT_KIND.FORCE]: [
        { name: 'name', type: 'text' },
        { name: 'img', type: 'text' },
        { name: 'icon', type: 'text' },
        { name: 'resources', type: 'int' },
        { name: 'income', type: 'int' },
        { name: 'isActive', type: 'bool' },
        { name: 'visibility', type: 'text' },
        { name: 'hideValues', type: 'bool' },
        { name: 'maskLabel', type: 'text' }
    ],
    [EDIT_KIND.ASSET]: [
        { name: 'name', type: 'text' },
        { name: 'img', type: 'text' },
        { name: 'forceId', type: 'text' },
        { name: 'modifierKind', type: 'text' },
        { name: 'modifierValue', type: 'int' },
        { name: 'visibility', type: 'text' },
        { name: 'hideValues', type: 'bool' },
        { name: 'maskLabel', type: 'text' }
    ],
    // The condition table has no scalar fields at all — every control in it is a
    // row, harvested by the data-row-group convention.
    [EDIT_KIND.CONDITIONS]: []
};

/** Coerce one harvested value to the type its field declares. */
export function coerce(type, raw) {
    if (type === 'int') return int(raw);
    if (type === 'bool') return bool(raw);
    // An empty select means "inherit" on a Thread's mode, which is null and not "".
    if (type === 'nullable') return str(raw) === '' ? null : str(raw);
    return str(raw);
}

// ── building a draft ─────────────────────────────────────────────────────────

const phaseDraft = (raw = {}) => ({
    id: raw.id ?? null,
    threshold: int(raw.threshold, 0),
    label: str(raw.label),
    tone: str(raw.tone) || 'neutral',
    description: str(raw.description),
    gmNotes: str(raw.gmNotes),
    // Carried through untouched. M6 authors these; losing them on an unrelated
    // save would be a silent data loss the GM could not see happening.
    revealNodeIds: [...(raw.revealNodeIds ?? [])],
    lockNodeIds: [...(raw.lockNodeIds ?? [])]
});

/**
 * A working copy of one entity, or a blank one seeded from the campaign defaults.
 *
 * @param {string} kind        EDIT_KIND
 * @param {object|null} entity a normalized entity, or null to create
 * @param {object} constants   the world's CONSTANT_DEFAULTS-shaped settings
 * @param {object} seed        extras a blank needs from context (plotId, forceId)
 */
export function draftFrom(kind, entity, constants = {}, seed = {}) {
    const K = constants;

    if (kind === EDIT_KIND.PLOT) {
        const e = entity ?? {};
        const forceIds = [...(e.forceIds ?? [])];
        const forceGroups = { ...(e.forceGroups ?? {}) };
        return {
            name: str(e.name),
            description: str(e.description),
            state: int(e.state, K.stateMin ?? 0),
            stateMin: int(e.stateMin, K.stateMin ?? 0),
            stateMax: int(e.stateMax, K.stateMax ?? 100),
            lifecycle: str(e.lifecycle) || LIFECYCLE.ACTIVE,
            // Which clock this Plot keeps. The count itself is not on the form:
            // it is moved by pressing a cycle, not by typing a number, and a
            // field the GM can edit is a field that can disagree with the world.
            turnBehaviour: str(e.turnBehaviour) || TURN_BEHAVIOUR.DEFAULT,
            turnLabel: str(e.turnLabel),
            defaultMode: str(e.defaultMode) || MODE.FIAT,
            phases: (e.phases ?? []).map(phaseDraft),
            forceIds,
            forceGroups,
            // Every heading currently in use, in roster order, so the columns
            // render in the order the board prints them.
            groups: headingsOf(forceIds, forceGroups),
            visibility: str(e.visibility) || defaultVisibilityFor(K, 'plot'),
            hideValues: bool(e.hideValues),
            // Empty means the default for the kind, which is a localized string
            // and therefore not this module's business to know.
            maskLabel: str(e.maskLabel),
            maskNote: str(e.maskNote)
        };
    }

    if (kind === EDIT_KIND.NODE) {
        const e = entity ?? {};
        return {
            plotId: str(e.plotId) || str(seed.plotId),
            name: str(e.name),
            description: str(e.description),
            mode: e.mode ?? null,
            threshold: int(e.threshold, K.threadThreshold ?? 9),
            segments: int(e.segments, K.clockSegments ?? 6),
            status: str(e.status) || NODE_STATUS.ACTIVE,
            outcomes: (e.outcomes ?? []).map((o) => ({
                forceId: str(o.forceId), delta: int(o.delta), note: str(o.note)
            })),
            prereqNodeIds: [...(e.prereqNodeIds ?? [])],
            visibility: str(e.visibility) || defaultVisibilityFor(K, 'node'),
            hideValues: bool(e.hideValues),
            maskLabel: str(e.maskLabel),
            maskNote: str(e.maskNote)
        };
    }

    if (kind === EDIT_KIND.FORCE) {
        const e = entity ?? {};
        return {
            name: str(e.name),
            img: str(e.img),
            icon: str(e.icon) || str(K.forceIcon),
            resources: int(e.resources, K.forceResources ?? 0),
            income: int(e.income, K.forceIncome ?? 0),
            // A Force draws income unless paused, so a new one is active.
            isActive: entity ? e.isActive !== false : true,
            tags: (e.tags ?? []).map((t) => ({ text: str(t.text), polarity: t.polarity })),
            visibility: str(e.visibility) || defaultVisibilityFor(K, 'force'),
            hideValues: bool(e.hideValues),
            maskLabel: str(e.maskLabel)
        };
    }

    if (kind === EDIT_KIND.CONDITIONS) {
        // The whole table, as rows. Unlike every other editor this is not one
        // entity: Save replaces the world's list rather than patching a row.
        return { rows: (seed.rows ?? []).map(conditionDraft) };
    }

    const e = entity ?? {};
    return {
        forceId: str(e.forceId) || str(seed.forceId),
        name: str(e.name),
        img: str(e.img),
        uuid: e.uuid ?? null,
        tags: (e.tags ?? []).map((t) => ({ text: str(t.text), polarity: t.polarity })),
        modifierKind: str(e.modifier?.kind) || ASSET_MODIFIER.NONE,
        modifierValue: int(e.modifier?.value, 0),
        visibility: str(e.visibility) || defaultVisibilityFor(K, 'asset'),
        hideValues: bool(e.hideValues),
        maskLabel: str(e.maskLabel)
    };
}

/**
 * One row of the condition table, as a draft.
 *
 * `isBuiltIn` is not stored and not editable — it is derived from whether the id
 * is one the module ships, and it exists only so the editor can say which rows
 * Restore the defaults will put back.
 */
export function conditionDraft(row = {}) {
    return {
        id: str(row.id),
        labelKey: str(row.labelKey),
        label: str(row.label),
        effect: str(row.effect) || CONDITION_EFFECT.FULL,
        inPlay: row.inPlay !== false,
        cycles: Math.max(0, int(row.cycles, 0)),
        becomes: str(row.becomes),
        isFinal: bool(row.isFinal),
        isBuiltIn: DEFAULT_CONDITIONS.some((c) => c.id === str(row.id)),
        // READY is what every unknown condition resolves to, so a table without it
        // cannot answer "what is normal". It is the one row with no delete button.
        isProtected: str(row.id) === ASSET_CONDITION.READY
    };
}

/** A blank row, ready to be named. The id is minted here so Assets can point at it. */
export const addCondition = (draft, id) => ({
    ...clone(draft),
    rows: [...clone(draft.rows), conditionDraft({ id, label: '', effect: CONDITION_EFFECT.FULL })]
});

export const removeCondition = (draft, id) => ({
    ...clone(draft),
    rows: clone(draft.rows).filter((r) => r.id !== id || r.isProtected)
});

/**
 * Put the module's six back, keeping anything the GM invented.
 *
 * A built-in the GM deleted returns; one they renamed or re-switched is reset to
 * what the module ships. That is the whole point of the button — "I have broken
 * this, give me the documented behaviour back".
 */
export function restoreConditionDefaults(draft) {
    const mine = clone(draft.rows).filter((r) => !r.isBuiltIn);
    return { ...clone(draft), rows: [...DEFAULT_CONDITIONS.map(conditionDraft), ...mine] };
}

/**
 * What Save hands to state.mjs: the stored shape, with the derived flags dropped.
 *
 * A row whose label is only whitespace falls back to its key, so clearing the name
 * of a built-in restores its translated one rather than leaving a blank chip.
 */
export const conditionRows = (draft) => (draft.rows ?? []).map((r, i) => ({
    id: r.id,
    labelKey: r.labelKey,
    label: r.label.trim(),
    effect: r.effect,
    inPlay: r.inPlay,
    cycles: r.cycles,
    // A successor pointing at a row that is no longer in the table is dropped
    // here rather than left to resolve to the fallback at read time.
    becomes: (draft.rows ?? []).some((o) => o.id === r.becomes) ? r.becomes : '',
    isFinal: r.isFinal,
    sort: i
}));

/** Rows the GM has deleted since the editor opened, by id. */
export const droppedConditions = (snapshot, draft) => {
    const kept = new Set((draft.rows ?? []).map((r) => r.id));
    return (snapshot.rows ?? []).map((r) => r.id).filter((id) => !kept.has(id));
};

const defaultVisibilityFor = (constants, kind) =>
    constants?.defaultVisibility?.[kind] ?? VISIBILITY.HIDDEN;

/** Headings in roster order, deduped, blank excluded — blank is "no heading". */
export function headingsOf(forceIds, forceGroups) {
    const seen = [];
    for (const id of forceIds ?? []) {
        const label = cleanGroup(forceGroups?.[id]);
        if (label && !seen.includes(label)) seen.push(label);
    }
    return seen;
}

// ── what Save hands to state.mjs ─────────────────────────────────────────────

/**
 * The patch, carrying only the fields this editor owns. `id` is added by the
 * caller for an edit and omitted for a create, which is what upsertRow keys on.
 */
export function patchFrom(kind, draft) {
    if (kind === EDIT_KIND.PLOT) {
        const forceIds = [...draft.forceIds];
        const forceGroups = {};
        for (const id of forceIds) {
            const label = cleanGroup(draft.forceGroups[id]);
            if (label) forceGroups[id] = label;
        }
        return {
            name: draft.name.trim(),
            description: draft.description,
            state: draft.state,
            stateMin: draft.stateMin,
            stateMax: draft.stateMax,
            lifecycle: draft.lifecycle,
            turnBehaviour: draft.turnBehaviour,
            turnLabel: draft.turnLabel,
            defaultMode: draft.defaultMode,
            // A Phase with no label is a row the GM started and abandoned; it would
            // render as an unnamed chip on the State bar, so it is not saved.
            phases: draft.phases
                .filter((p) => p.label.trim().length > 0)
                .map((p) => ({
                    ...(p.id ? { id: p.id } : {}),
                    threshold: p.threshold,
                    label: p.label.trim(),
                    tone: p.tone,
                    description: p.description,
                    gmNotes: p.gmNotes,
                    revealNodeIds: p.revealNodeIds,
                    lockNodeIds: p.lockNodeIds
                })),
            forceIds,
            forceGroups,
            visibility: draft.visibility,
            hideValues: draft.hideValues,
            // Trimmed here rather than on the way in, so a GM who types a space
            // and thinks better of it gets the default back rather than a mask
            // called " ".
            maskLabel: draft.maskLabel.trim(),
            maskNote: draft.maskNote.trim()
        };
    }

    if (kind === EDIT_KIND.NODE) {
        return {
            plotId: draft.plotId,
            name: draft.name.trim(),
            description: draft.description,
            mode: draft.mode,
            threshold: draft.threshold,
            segments: draft.segments,
            status: draft.status,
            // An outcome of nothing said and nothing moved is not an outcome.
            outcomes: draft.outcomes.filter((o) => o.delta !== 0 || o.note.trim().length > 0),
            prereqNodeIds: [...draft.prereqNodeIds],
            visibility: draft.visibility,
            hideValues: draft.hideValues,
            maskLabel: draft.maskLabel.trim(),
            maskNote: draft.maskNote.trim()
        };
    }

    if (kind === EDIT_KIND.FORCE) {
        return {
            name: draft.name.trim(),
            img: draft.img,
            icon: draft.icon,
            resources: draft.resources,
            income: draft.income,
            isActive: draft.isActive,
            tags: draft.tags.filter((t) => t.text.trim().length > 0),
            visibility: draft.visibility,
            hideValues: draft.hideValues,
            maskLabel: draft.maskLabel.trim()
        };
    }

    return {
        forceId: draft.forceId,
        name: draft.name.trim(),
        img: draft.img,
        uuid: draft.uuid,
        tags: draft.tags.filter((t) => t.text.trim().length > 0),
        modifier: { kind: draft.modifierKind, value: draft.modifierValue },
        visibility: draft.visibility,
        hideValues: draft.hideValues,
        maskLabel: draft.maskLabel.trim()
    };
}

/**
 * What has changed since the editor opened. Counted, not just flagged, because
 * "3 unsaved changes" tells a GM whether they touched more than they meant to.
 * `groups` is excluded: creating an empty heading changes nothing that saves.
 */
export function dirtyKeys(snapshot, draft) {
    const keys = new Set([...Object.keys(snapshot ?? {}), ...Object.keys(draft ?? {})]);
    keys.delete('groups');
    return [...keys].filter((k) => !same(snapshot?.[k], draft?.[k])).sort();
}

/** Which fields stop a Save. Kept tiny: a form that argues is worse than one that saves. */
export function problems(kind, draft) {
    const out = [];
    // The condition table is a list, not a row: it has no name to be missing, and
    // nothing in it can stop a save the way a nameless Plot can.
    if (kind === EDIT_KIND.CONDITIONS) return out;
    if (!str(draft?.name).trim()) out.push('name');
    if (kind === EDIT_KIND.PLOT && draft.stateMax <= draft.stateMin) out.push('stateRange');
    if (kind === EDIT_KIND.ASSET && !str(draft?.forceId)) out.push('forceId');
    return out;
}

// ── structural mutations ─────────────────────────────────────────────────────
// Each returns a NEW draft. The app harvests the form into the draft first, then
// calls one of these, then re-renders — so nothing typed is lost when a card is
// added, and nothing here has to know a DOM exists.

const withPhases = (draft, phases) => ({ ...clone(draft), phases });

/** A new Phase lands above the highest one, which is where a GM is usually adding. */
export function addPhase(draft) {
    const top = draft.phases.reduce((max, p) => Math.max(max, p.threshold), 0);
    return withPhases(draft, [...clone(draft.phases), phaseDraft({
        threshold: draft.phases.length ? top + 10 : 0
    })]);
}

export const removePhase = (draft, index) =>
    withPhases(draft, clone(draft.phases).filter((_, i) => i !== index));

export function addTag(draft, polarity, text) {
    const value = str(text).trim();
    const next = clone(draft);
    if (!value) return next;
    const p = polarity === POLARITY.WEAKNESS ? POLARITY.WEAKNESS : POLARITY.STRENGTH;
    // Two identical tags on one row say nothing twice.
    if (next.tags.some((t) => t.polarity === p && t.text === value)) return next;
    next.tags.push({ text: value, polarity: p });
    return next;
}

export function removeTag(draft, polarity, index) {
    const next = clone(draft);
    let seen = -1;
    next.tags = next.tags.filter((t) => {
        if (t.polarity !== polarity) return true;
        seen += 1;
        return seen !== index;
    });
    return next;
}

export function addPrereq(draft, nodeId) {
    const next = clone(draft);
    if (nodeId && !next.prereqNodeIds.includes(nodeId)) next.prereqNodeIds.push(nodeId);
    return next;
}

export const removePrereq = (draft, nodeId) => ({
    ...clone(draft),
    prereqNodeIds: draft.prereqNodeIds.filter((id) => id !== nodeId)
});

export function setOutcome(draft, forceId, patch) {
    const next = clone(draft);
    const row = next.outcomes.find((o) => o.forceId === forceId);
    if (row) Object.assign(row, patch);
    else next.outcomes.push({ forceId, delta: 0, note: '', ...patch });
    return next;
}

// ── the roster ───────────────────────────────────────────────────────────────

export function addForceToPlot(draft, forceId, group = '') {
    const next = clone(draft);
    if (!forceId || next.forceIds.includes(forceId)) return next;
    next.forceIds.push(forceId);
    const label = cleanGroup(group);
    if (label) {
        next.forceGroups[forceId] = label;
        if (!next.groups.includes(label)) next.groups.push(label);
    }
    return next;
}

export function removeForceFromPlot(draft, forceId) {
    const next = clone(draft);
    next.forceIds = next.forceIds.filter((id) => id !== forceId);
    delete next.forceGroups[forceId];
    return next;
}

/** Moving a Force to a heading that does not exist yet creates it. Blank un-groups. */
export function setForceGroup(draft, forceId, group) {
    const next = clone(draft);
    if (!next.forceIds.includes(forceId)) return next;
    const label = cleanGroup(group);
    if (label) {
        next.forceGroups[forceId] = label;
        if (!next.groups.includes(label)) next.groups.push(label);
    } else {
        delete next.forceGroups[forceId];
    }
    return next;
}

export function addGroup(draft, label) {
    const next = clone(draft);
    const value = cleanGroup(label);
    if (value && !next.groups.includes(value)) next.groups.push(value);
    return next;
}

/** Deleting a heading empties it rather than deleting anyone: the Forces stay on the Plot. */
export function removeGroup(draft, label) {
    const next = clone(draft);
    const value = cleanGroup(label);
    next.groups = next.groups.filter((g) => g !== value);
    for (const [forceId, g] of Object.entries(next.forceGroups)) {
        if (g === value) delete next.forceGroups[forceId];
    }
    return next;
}

/**
 * The roster as columns: every heading in order, then the unheaded bucket, which
 * is always rendered so there is somewhere to drop a Force to un-group it.
 *
 * @returns {{label: string, hasLabel: boolean, forceIds: string[]}[]}
 */
export function rosterColumns(draft) {
    const headings = [...new Set([
        ...draft.groups.map(cleanGroup).filter(Boolean),
        ...headingsOf(draft.forceIds, draft.forceGroups)
    ])];

    const columns = headings.map((label) => ({
        label,
        hasLabel: true,
        forceIds: draft.forceIds.filter((id) => cleanGroup(draft.forceGroups[id]) === label)
    }));

    columns.push({
        label: '',
        hasLabel: false,
        forceIds: draft.forceIds.filter((id) => !cleanGroup(draft.forceGroups[id]))
    });

    return columns;
}
