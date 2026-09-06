/**
 * Plot and Thread editors, plus the destructive confirmations.
 *
 * All DialogV2. Three v14 facts shape this file:
 *
 *  - DialogV2 lives at foundry.applications.api.DialogV2, and `content` is RAW
 *    HTML. Every value that came from a user goes through escapeHTML on the way
 *    in, or a Force named `<img onerror=...>` executes.
 *  - A button's callback RETURN VALUE is the dialog result: _onSubmit does
 *    `(await button.callback(...)) ?? button.action`. So a callback returns the
 *    parsed form and the caller gets it directly; returning nothing would silently
 *    hand back the action string instead.
 *  - Form values are read off `button.form.elements.<name>` inside the callback.
 *
 * Phases are edited as one line per Phase rather than a repeating widget. That is
 * deliberate for now: the reveal/lock lists that land in M6 need real per-Phase UI,
 * and building a throwaway widget twice is worse than a text format a GM can read.
 */

import { LIFECYCLE, MODE, NODE_STATUS, VISIBILITY } from '../constants.mjs';
import {
    readBoard, plotById, nodeById, nodesForPlot, upsertPlot, deletePlot,
    upsertNode, deleteNode, removeExample
} from '../data/state.mjs';
import { getDefaultVisibility } from '../settings.mjs';

const { DialogV2 } = foundry.applications.api;
const esc = (v) => foundry.utils.escapeHTML(String(v ?? ''));
const L = (key) => game.i18n.localize(key);

// ── markup helpers ───────────────────────────────────────────────────────────

const field = (label, control, hint = '') => `
    <div class="form-group">
        <label>${esc(label)}</label>
        <div class="form-fields">${control}</div>
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
    </div>`;

const text = (name, value) => `<input type="text" name="${name}" value="${esc(value)}">`;
const number = (name, value) => `<input type="number" name="${name}" value="${esc(value)}">`;
const area = (name, value, rows = 3) =>
    `<textarea name="${name}" rows="${rows}">${esc(value)}</textarea>`;
const check = (name, on) =>
    `<input type="checkbox" name="${name}"${on ? ' checked' : ''}>`;

const select = (name, options, current) => `
    <select name="${name}">
        ${options.map((o) => `<option value="${esc(o.value)}"${o.value === current ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;

const enumOptions = (enumObj, prefix) =>
    Object.values(enumObj).map((v) => ({ value: v, label: L(`${prefix}.${v}`) }));

const checkList = (name, rows) => (rows.length === 0
    ? `<p class="hint">${esc(L('RSR.editor.nothingToPick'))}</p>`
    : `<div class="rsr-checklist">${rows.map((r) => `
        <label class="rsr-checkline">
            <input type="checkbox" name="${name}" value="${esc(r.value)}"${r.on ? ' checked' : ''}>
            <span>${esc(r.label)}</span>
        </label>`).join('')}</div>`);

/** Checkboxes sharing a name come back as one element or a RadioNodeList, never an array. */
function checkedValues(form, name) {
    const el = form.elements[name];
    if (!el) return [];
    if (el instanceof RadioNodeList || el.length !== undefined && !el.tagName) {
        return [...el].filter((i) => i.checked).map((i) => i.value);
    }
    return el.checked ? [el.value] : [];
}

const readInt = (form, name, fallback = 0) => {
    const n = Number(form.elements[name]?.value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

// ── phases as text ───────────────────────────────────────────────────────────

const TONES = ['calm', 'neutral', 'warn', 'danger'];

/** `threshold | label | tone | notes` — tone and notes optional. */
function phasesToText(phases) {
    return phases.map((p) =>
        [p.threshold, p.label, p.tone, p.gmNotes].join(' | ')).join('\n');
}

function phasesFromText(raw, existing) {
    const byLabel = new Map(existing.map((p) => [p.label, p]));
    return String(raw ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [threshold, label = '', tone = '', ...rest] = line.split('|').map((s) => s.trim());
            const previous = byLabel.get(label);
            return {
                // Keep the id when the label survives an edit, so reveal/lock lists
                // pointing at this Phase in M6 do not break on a rename of its notes.
                id: previous?.id,
                label,
                tone: TONES.includes(tone) ? tone : (previous?.tone ?? 'neutral'),
                threshold: Number(threshold) || 0,
                gmNotes: rest.join(' | '),
                revealNodeIds: previous?.revealNodeIds ?? [],
                lockNodeIds: previous?.lockNodeIds ?? []
            };
        });
}

// ── Plot editor ──────────────────────────────────────────────────────────────

export async function promptPlot(plotId) {
    const board = readBoard();
    const plot = plotId ? plotById(board, plotId) : null;
    const isNew = !plot;

    const current = plot ?? {
        name: '', description: '', state: 0, stateMin: 0, stateMax: 100,
        lifecycle: LIFECYCLE.ACTIVE, defaultMode: MODE.FIAT, phases: [],
        forceIds: [], visibility: getDefaultVisibility(),
        hideValues: false
    };

    const content = `
        ${field(L('RSR.editor.name'), text('name', current.name))}
        ${field(L('RSR.editor.description'), area('description', current.description))}
        ${field(L('RSR.editor.state'), `
            ${number('state', current.state)}
            ${number('stateMin', current.stateMin)}
            ${number('stateMax', current.stateMax)}`,
            L('RSR.editor.stateHint'))}
        ${field(L('RSR.editor.phases'), area('phases', phasesToText(current.phases), 5),
            L('RSR.editor.phasesHint'))}
        ${field(L('RSR.editor.lifecycle'),
            select('lifecycle', enumOptions(LIFECYCLE, 'RSR.plot.lifecycle'), current.lifecycle))}
        ${field(L('RSR.editor.defaultMode'),
            select('defaultMode', enumOptions(MODE, 'RSR.thread.mode'), current.defaultMode),
            L('RSR.editor.defaultModeHint'))}
        ${field(L('RSR.force.plural'), checkList('forceIds', board.forces.map((f) => ({
            value: f.id, label: f.name, on: current.forceIds.includes(f.id)
        }))))}
        ${field(L('RSR.editor.visibility'),
            select('visibility', enumOptions(VISIBILITY, 'RSR.visibility'), current.visibility))}
        ${field(L('RSR.visibility.hideValues'), check('hideValues', current.hideValues))}`;

    const patch = await DialogV2.prompt({
        window: { title: L(isNew ? 'RSR.editor.newPlot' : 'RSR.editor.editPlot') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 560 },
        content,
        ok: {
            label: L('RSR.editor.save'),
            // The return value IS the dialog result — see the header note.
            callback: (event, button) => {
                const form = button.form;
                return {
                    ...(plot ? { id: plot.id } : {}),
                    name: form.elements.name.value.trim(),
                    description: form.elements.description.value,
                    state: readInt(form, 'state'),
                    stateMin: readInt(form, 'stateMin', 0),
                    stateMax: readInt(form, 'stateMax', 100),
                    phases: phasesFromText(form.elements.phases.value, current.phases),
                    lifecycle: form.elements.lifecycle.value,
                    defaultMode: form.elements.defaultMode.value,
                    forceIds: checkedValues(form, 'forceIds'),
                    visibility: form.elements.visibility.value,
                    hideValues: form.elements.hideValues.checked
                };
            }
        },
        rejectClose: false
    });

    if (!patch) return null;
    if (!patch.name) {
        ui.notifications?.warn(L('RSR.notify.nameRequired'));
        return null;
    }
    await upsertPlot(patch);
    return patch;
}

// ── Thread editor ────────────────────────────────────────────────────────────

export async function promptThread(threadId, plotId) {
    const board = readBoard();
    const node = threadId ? nodeById(board, threadId) : null;
    const targetPlotId = node?.plotId ?? plotId;
    const plot = plotById(board, targetPlotId);
    if (!plot) {
        ui.notifications?.warn(L('RSR.notify.noPlotForThread'));
        return null;
    }
    const isNew = !node;

    const current = node ?? {
        name: '', description: '', mode: null, threshold: 9, segments: 6,
        status: NODE_STATUS.ACTIVE, prereqNodeIds: [], outcomes: [],
        visibility: getDefaultVisibility(),
        hideValues: false
    };

    // null mode means inherit; the empty option carries that.
    const modeOptions = [
        { value: '', label: game.i18n.format('RSR.editor.inheritMode',
            { mode: L(`RSR.thread.mode.${plot.defaultMode}`) }) },
        ...enumOptions(MODE, 'RSR.thread.mode')
    ];

    const siblings = nodesForPlot(board, plot.id).filter((n) => n.id !== node?.id);
    const forces = plot.forceIds.map((id) => board.forces.find((f) => f.id === id)).filter(Boolean);

    const outcomeRows = forces.length === 0
        ? `<p class="hint">${esc(L('RSR.editor.noForcesOnPlot'))}</p>`
        : forces.map((f) => {
            const existing = current.outcomes.find((o) => o.forceId === f.id);
            return `
            <div class="rsr-outcome-row">
                <span class="rsr-outcome-force">${esc(f.name)}</span>
                <input type="number" name="outcome-delta-${esc(f.id)}" value="${esc(existing?.delta ?? 0)}">
                <input type="text" name="outcome-note-${esc(f.id)}" value="${esc(existing?.note ?? '')}"
                       placeholder="${esc(L('RSR.editor.outcomeNotePlaceholder'))}">
            </div>`;
        }).join('');

    const content = `
        ${field(L('RSR.editor.name'), text('name', current.name))}
        ${field(L('RSR.editor.description'), area('description', current.description))}
        ${field(L('RSR.editor.mode'), select('mode', modeOptions, current.mode ?? ''))}
        ${field(L('RSR.editor.threshold'), number('threshold', current.threshold),
            L('RSR.editor.thresholdHint'))}
        ${field(L('RSR.editor.segments'), number('segments', current.segments),
            L('RSR.editor.segmentsHint'))}
        ${field(L('RSR.editor.status'),
            select('status', enumOptions(NODE_STATUS, 'RSR.thread.status'), current.status))}
        ${field(L('RSR.editor.outcomes'), outcomeRows, L('RSR.editor.outcomesHint'))}
        ${field(L('RSR.editor.prereqs'), checkList('prereqNodeIds', siblings.map((n) => ({
            value: n.id, label: n.name, on: current.prereqNodeIds.includes(n.id)
        }))), L('RSR.editor.prereqsHint'))}
        ${field(L('RSR.editor.visibility'),
            select('visibility', enumOptions(VISIBILITY, 'RSR.visibility'), current.visibility))}
        ${field(L('RSR.visibility.hideValues'), check('hideValues', current.hideValues))}`;

    const patch = await DialogV2.prompt({
        window: { title: L(isNew ? 'RSR.editor.newThread' : 'RSR.editor.editThread') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 560 },
        content,
        ok: {
            label: L('RSR.editor.save'),
            callback: (event, button) => {
                const form = button.form;
                const outcomes = forces.map((f) => ({
                    forceId: f.id,
                    delta: readInt(form, `outcome-delta-${f.id}`),
                    note: form.elements[`outcome-note-${f.id}`]?.value ?? ''
                // A zero delta with no note is not an outcome, it is an untouched row.
                })).filter((o) => o.delta !== 0 || o.note.trim().length > 0);

                return {
                    ...(node ? { id: node.id } : {}),
                    plotId: plot.id,
                    name: form.elements.name.value.trim(),
                    description: form.elements.description.value,
                    mode: form.elements.mode.value || null,
                    threshold: readInt(form, 'threshold', 9),
                    segments: readInt(form, 'segments', 6),
                    status: form.elements.status.value,
                    outcomes,
                    prereqNodeIds: checkedValues(form, 'prereqNodeIds'),
                    visibility: form.elements.visibility.value,
                    hideValues: form.elements.hideValues.checked
                };
            }
        },
        rejectClose: false
    });

    if (!patch) return null;
    if (!patch.name) {
        ui.notifications?.warn(L('RSR.notify.nameRequired'));
        return null;
    }
    await upsertNode(patch);
    return patch;
}

// ── destructive confirmations ────────────────────────────────────────────────

export async function confirmDeletePlot(plotId) {
    const plot = plotById(readBoard(), plotId);
    if (!plot) return false;
    const threads = nodesForPlot(readBoard(), plotId).length;

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deletePlot') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        content: `<p>${game.i18n.format('RSR.editor.deletePlotWarning', {
            name: esc(plot.name), count: threads
        })}</p>`,
        rejectClose: false
    });
    if (!ok) return false;
    await deletePlot(plotId);
    return true;
}

export async function confirmDeleteThread(threadId) {
    const node = nodeById(readBoard(), threadId);
    if (!node) return false;

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deleteThread') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        content: `<p>${game.i18n.format('RSR.editor.deleteThreadWarning', { name: esc(node.name) })}</p>`,
        rejectClose: false
    });
    if (!ok) return false;
    await deleteNode(threadId);
    return true;
}

export async function confirmRemoveExample() {
    const ok = await DialogV2.confirm({
        window: { title: L('RSR.help.removeExample') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        content: `<p>${L('RSR.help.removeExampleWarning')}</p>`,
        rejectClose: false
    });
    if (!ok) return false;
    await removeExample();
    ui.notifications?.info(L('RSR.help.exampleRemoved'));
    return true;
}
