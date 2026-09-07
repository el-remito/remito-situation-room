/**
 * The DOM half of the in-board editors: reading a form back into a draft, and
 * shaping a draft into a render context.
 *
 * logic/editing.mjs holds everything that can be decided without a document — the
 * draft, the patch, the structural mutations. This file is the part that has to
 * touch elements, and it is deliberately thin.
 *
 * TWO CONVENTIONS DO ALL THE WORK.
 *
 *  1. Scalar controls are named after the field they hold, and the list of them
 *     is logic/editing.mjs FIELDS. Template, harvest and suite all read the same
 *     list, so a field cannot be added to one and forgotten in another.
 *
 *  2. Repeating controls carry three data attributes instead of an encoded name:
 *     data-row-group (phases, outcomes), data-row-key (an index or an id) and
 *     data-row-field. Harvesting them is then one loop that knows nothing about
 *     what is being repeated — which is what keeps this file from growing a
 *     branch per widget.
 *
 * Contexts hand the template i18n KEYS, never localized strings, matching the
 * rest of the module: the template localizes, so a language change at runtime
 * does not leave a stale label behind.
 */

import {
    ASSET_MODIFIER, CONDITION_EFFECT, CONSTANT_DEFAULTS, EDIT_KIND, LIFECYCLE, MODE,
    NODE_STATUS, TURN_BEHAVIOUR, VISIBILITY
} from '../constants.mjs';
import * as Edit from '../logic/editing.mjs';
import * as Cond from '../logic/condition.mjs';

// ── harvesting ───────────────────────────────────────────────────────────────

/** What one control currently holds. A checkbox answers `checked`; everything else `value`. */
function readControl(el) {
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked;
    return el.value;
}

/**
 * Read the form back into the draft.
 *
 * Called before every structural action as well as on Save, because adding a
 * Phase card re-renders the whole part — anything typed since the last render
 * would be gone otherwise. That is the single most important line in the editor.
 */
export function harvest(kind, form, draft) {
    if (!form) return draft;
    const next = { ...draft };

    for (const { name, type } of Edit.FIELDS[kind] ?? []) {
        const el = form.elements[name];
        if (!el) continue;
        next[name] = Edit.coerce(type, readControl(el));
    }

    // Repeating rows, by convention rather than by name-parsing.
    const rows = {};
    for (const el of form.querySelectorAll('[data-row-group]')) {
        const { rowGroup, rowKey, rowField } = el.dataset;
        if (!rowGroup || rowKey === undefined || !rowField) continue;
        rows[rowGroup] ??= {};
        rows[rowGroup][rowKey] ??= {};
        rows[rowGroup][rowKey][rowField] = readControl(el);
    }

    if (rows.phases) {
        next.phases = draft.phases.map((phase, index) => {
            const row = rows.phases[String(index)];
            if (!row) return phase;
            return {
                ...phase,
                threshold: Edit.coerce('int', row.threshold),
                label: Edit.coerce('text', row.label),
                tone: Edit.coerce('text', row.tone) || phase.tone,
                description: Edit.coerce('text', row.description),
                gmNotes: Edit.coerce('text', row.gmNotes)
            };
        });
    }

    if (rows.conditions) {
        // Keyed by the condition's own id rather than by index: rows are added and
        // deleted while the editor is open, and an index would rebind a typed name
        // to whichever row happened to slide into that slot.
        next.rows = draft.rows.map((row) => {
            const harvested = rows.conditions[row.id];
            if (!harvested) return row;
            return {
                ...row,
                label: Edit.coerce('text', harvested.label),
                effect: Edit.coerce('text', harvested.effect) || row.effect,
                inPlay: Edit.coerce('bool', harvested.inPlay),
                cycles: Math.max(0, Edit.coerce('int', harvested.cycles)),
                becomes: Edit.coerce('text', harvested.becomes),
                isFinal: Edit.coerce('bool', harvested.isFinal)
            };
        });
    }

    if (rows.outcomes) {
        // Rebuilt from the form rather than patched into the draft: the rows on
        // screen are one per Force on the Plot, which is the authoritative set.
        next.outcomes = Object.entries(rows.outcomes).map(([forceId, row]) => ({
            forceId,
            delta: Edit.coerce('int', row.delta),
            note: Edit.coerce('text', row.note)
        }));
    }

    return next;
}

/** One value out of the form without harvesting the rest — for the add-a-thing inputs. */
export const readField = (form, name) => readControl(form?.elements?.[name]) ?? '';

/** Clear an add-a-thing input after its value has been taken. */
export function clearField(form, name) {
    const el = form?.elements?.[name];
    if (el && el.type !== 'checkbox') el.value = '';
}

// ── shared context pieces ────────────────────────────────────────────────────

const optionsOf = (enumObj, prefix, current) =>
    Object.values(enumObj).map((value) => ({
        value, label: `${prefix}.${value}`, selected: value === current
    }));

const TONES = ['calm', 'neutral', 'warn', 'danger'];

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * The heading each editor wears. Written out as whole keys rather than assembled
 * from a kind — the UI word for a `node` is "Thread", and building that by
 * concatenation is exactly what the naming rule exists to prevent.
 */
const TITLE_KEYS = {
    [EDIT_KIND.PLOT]: { edit: 'RSR.editor.editPlot', new: 'RSR.editor.newPlot' },
    [EDIT_KIND.NODE]: { edit: 'RSR.editor.editThread', new: 'RSR.editor.newThread' },
    [EDIT_KIND.FORCE]: { edit: 'RSR.editor.editForce', new: 'RSR.editor.newForce' },
    [EDIT_KIND.ASSET]: { edit: 'RSR.editor.editAsset', new: 'RSR.editor.newAsset' },
    // Not an entity, so there is nothing to be new or existing about.
    [EDIT_KIND.CONDITIONS]: { edit: 'RSR.asset.conditionsTitle', new: 'RSR.asset.conditionsTitle' }
};

/**
 * The shell: what the header and the Save bar need, for any kind.
 *
 * `dirty` is a count rather than a flag because "3 unsaved changes" answers a
 * question a lone dot cannot — whether you touched more than you meant to.
 */
/**
 * The default name for a masked row of each kind, as an i18n KEY: the template
 * localizes it into the field's placeholder, so an empty box reads as what the
 * table would actually see rather than as an empty box.
 */
const MASK_KEYS = {
    [EDIT_KIND.PLOT]: 'RSR.visibility.maskPlot',
    [EDIT_KIND.NODE]: 'RSR.visibility.maskNode',
    [EDIT_KIND.FORCE]: 'RSR.visibility.maskForce',
    [EDIT_KIND.ASSET]: 'RSR.visibility.maskAsset'
};

function shell(kind, edit, extra = {}) {
    const dirty = Edit.dirtyKeys(edit.snapshot, edit.draft);
    return {
        kind,
        isPlot: kind === EDIT_KIND.PLOT,
        isThread: kind === EDIT_KIND.NODE,
        isForce: kind === EDIT_KIND.FORCE,
        isAsset: kind === EDIT_KIND.ASSET,
        isConditions: kind === EDIT_KIND.CONDITIONS,
        // The world's own table is not a row, so it carries none of what a row
        // carries: no name in the header, and no "what the table sees" section.
        isEntity: kind !== EDIT_KIND.CONDITIONS,
        isNew: !edit.id,
        title: TITLE_KEYS[kind][edit.id ? 'edit' : 'new'],
        name: edit.draft.name ?? '',
        dirtyCount: dirty.length,
        isDirty: dirty.length > 0,
        problems: Edit.problems(kind, edit.draft),
        visibility: optionsOf(VISIBILITY, 'RSR.visibility', edit.draft.visibility),
        hideValues: edit.draft.hideValues,
        // What a masked row is called, and what the table hears in place of its
        // reading. Both are answers to "what do they see instead", so they sit
        // under the same heading as the visibility itself rather than in the
        // body of the form where they would read as properties of the row.
        maskLabel: edit.draft.maskLabel ?? '',
        maskDefault: MASK_KEYS[kind] ?? 'RSR.visibility.maskedName',
        // Only where there is a reading to stand in for.
        hasMaskNote: kind === EDIT_KIND.PLOT || kind === EDIT_KIND.NODE,
        maskNote: edit.draft.maskNote ?? '',
        maskNoteHint: kind === EDIT_KIND.PLOT
            ? 'RSR.editor.maskNoteHintPlot' : 'RSR.editor.maskNoteHintThread',
        ...extra
    };
}

// ── one builder per kind ─────────────────────────────────────────────────────

export function editorContext(kind, edit, board) {
    if (kind === EDIT_KIND.PLOT) return plotContext(edit, board);
    if (kind === EDIT_KIND.NODE) return threadContext(edit, board);
    if (kind === EDIT_KIND.FORCE) return forceContext(edit, board);
    if (kind === EDIT_KIND.CONDITIONS) return conditionsContext(edit, board);
    return assetContext(edit, board);
}

/**
 * The world's condition table.
 *
 * Every row offers every OTHER row as its successor, plus "stays put" — including
 * itself would let a GM write a condition that becomes itself, which is a timer
 * that fires forever with nothing to show for it.
 *
 * `usedBy` is what makes deleting safe: a row that Assets are standing in says so
 * on its own line, and the delete routes through the replacement flow instead of
 * orphaning them.
 */
function conditionsContext(edit, board) {
    const rows = edit.draft.rows ?? [];
    const counts = new Map();
    for (const asset of board.assets ?? []) {
        counts.set(asset.condition, (counts.get(asset.condition) ?? 0) + 1);
    }

    return shell(EDIT_KIND.CONDITIONS, edit, {
        rows: rows.map((row, index) => ({
            ...row,
            index,
            // An untouched built-in shows its translated name as the placeholder,
            // so the field can stay empty and still read correctly.
            placeholder: row.labelKey,
            effects: Object.values(CONDITION_EFFECT).map((value) => ({
                value, label: `RSR.asset.effectScale.${value}`, selected: value === row.effect
            })),
            successors: [
                { value: '', label: 'RSR.asset.conditionStays', selected: !row.becomes },
                ...rows.filter((o) => o.id !== row.id).map((o) => ({
                    value: o.id,
                    label: o.label || o.labelKey,
                    selected: o.id === row.becomes
                }))
            ],
            usedBy: counts.get(row.id) ?? 0
        }))
    });
}

function plotContext(edit, board) {
    const draft = edit.draft;
    const forceById = new Map(board.forces.map((f) => [f.id, f]));

    // Only members render. A world with fifty Forces would otherwise put fifty
    // rows in front of a GM who wants two of them.
    const columns = Edit.rosterColumns(draft).map((column) => ({
        ...column,
        forces: column.forceIds
            .map((id) => forceById.get(id))
            .filter(Boolean)
            .map((f) => ({ id: f.id, name: f.name, icon: f.icon || CONSTANT_DEFAULTS.forceIcon }))
    }));

    // Headings used anywhere on the board, so a GM can reuse one without retyping.
    const known = [...new Set(board.plots.flatMap((p) => Object.values(p.forceGroups ?? {})))].sort();

    return shell(EDIT_KIND.PLOT, edit, {
        draft,
        phases: draft.phases.map((phase, index) => ({
            ...phase,
            index,
            tones: TONES.map((value) => ({
                value, label: `RSR.editor.tone.${value}`, selected: value === phase.tone
            }))
        })),
        columns,
        knownGroups: known,
        available: board.forces
            .filter((f) => !draft.forceIds.includes(f.id))
            .sort(byName)
            .map((f) => ({ id: f.id, name: f.name })),
        lifecycles: optionsOf(LIFECYCLE, 'RSR.plot.lifecycle', draft.lifecycle),
        behaviours: optionsOf(TURN_BEHAVIOUR, 'RSR.plot.turnBehaviour', draft.turnBehaviour),
        modes: optionsOf(MODE, 'RSR.thread.mode', draft.defaultMode)
    });
}

function threadContext(edit, board) {
    const draft = edit.draft;
    const plot = board.plots.find((p) => p.id === draft.plotId) ?? null;
    const forces = (plot?.forceIds ?? [])
        .map((id) => board.forces.find((f) => f.id === id))
        .filter(Boolean);

    const siblings = board.nodes
        .filter((n) => n.plotId === draft.plotId && n.id !== edit.id)
        .sort((a, b) => a.sort - b.sort);
    const chosen = new Set(draft.prereqNodeIds);

    // The empty option carries "inherit", naming what would be inherited.
    const modes = [
        { value: '', label: 'RSR.editor.inheritMode', selected: draft.mode === null, isInherit: true },
        ...optionsOf(MODE, 'RSR.thread.mode', draft.mode ?? '')
    ];

    return shell(EDIT_KIND.NODE, edit, {
        draft,
        plotName: plot?.name ?? '',
        inheritedMode: `RSR.thread.mode.${plot?.defaultMode ?? MODE.FIAT}`,
        modes,
        statuses: optionsOf(NODE_STATUS, 'RSR.thread.status', draft.status),
        outcomes: forces.map((force) => {
            const row = draft.outcomes.find((o) => o.forceId === force.id);
            return {
                forceId: force.id,
                name: force.name,
                delta: row?.delta ?? 0,
                note: row?.note ?? ''
            };
        }),
        prereqs: siblings
            .filter((n) => chosen.has(n.id))
            .map((n) => ({ id: n.id, name: n.name })),
        availablePrereqs: siblings
            .filter((n) => !chosen.has(n.id))
            .map((n) => ({ id: n.id, name: n.name }))
    });
}

function forceContext(edit, board) {
    const draft = edit.draft;
    return shell(EDIT_KIND.FORCE, edit, {
        draft,
        icon: draft.icon || CONSTANT_DEFAULTS.forceIcon,
        strengths: tagChips(draft, 'strength'),
        weaknesses: tagChips(draft, 'weakness'),
        // Its Assets are not edited here — each has its own screen, and the
        // chips are the way into them.
        assets: board.assets
            .filter((a) => a.forceId === edit.id)
            .map((a) => ({ id: a.id, name: a.name, isCommitted: !!(a.plotId || a.nodeId) }))
    });
}

function assetContext(edit, board) {
    const draft = edit.draft;
    const owner = board.forces.find((f) => f.id === draft.forceId) ?? null;
    return shell(EDIT_KIND.ASSET, edit, {
        draft,
        owners: [...board.forces].sort(byName).map((f) => ({
            value: f.id, name: f.name, selected: f.id === draft.forceId
        })),
        ownerName: owner?.name ?? '',
        effects: Object.values(ASSET_MODIFIER).map((value) => ({
            value, label: `RSR.asset.modifier.${value}`, selected: value === draft.modifierKind
        })),
        // "Does nothing" has no number to set, so the field is not offered.
        hasEffect: draft.modifierKind !== ASSET_MODIFIER.NONE,
        // Read-only here. The condition is not a field on this form: setting one
        // releases the Asset, starts a timer and writes a line in the chronicle,
        // and none of that should wait for a Save. The editor shows where the
        // Asset stands and hands off to the dialog that changes it.
        condition: conditionSummary(edit, board),
        strengths: tagChips(draft, 'strength'),
        weaknesses: tagChips(draft, 'weakness'),
        hasLink: !!draft.uuid,
        uuid: draft.uuid,
        // Charged on creation only, and only when the world says an Asset costs
        // something — so the GM is told before they press Save, not after.
        cost: edit.id ? 0 : (board.constants.assetCost ?? 0),
        purse: owner?.resources ?? 0
    });
}

/** Where an Asset stands, for an editor that reports it rather than sets it. */
function conditionSummary(edit, board) {
    const asset = (board.assets ?? []).find((a) => a.id === edit.id) ?? null;
    if (!asset) return null;
    const rule = Cond.ruleFor(asset);
    return {
        assetId: asset.id,
        condition: rule.id,
        label: Cond.labelOf(rule),
        isDefault: Cond.isDefault(asset),
        cyclesLeft: asset.conditionCycles ?? 0
    };
}

/**
 * Chips for one polarity, each carrying its index WITHIN that polarity — which is
 * what logic/editing.mjs removeTag expects, because that is how they are read.
 */
function tagChips(draft, polarity) {
    let index = -1;
    return draft.tags
        .filter((t) => t.polarity === polarity)
        .map((t) => {
            index += 1;
            return { text: t.text, index, polarity };
        });
}
