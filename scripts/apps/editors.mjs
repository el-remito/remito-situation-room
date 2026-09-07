/**
 * The dialogs that remain: the ones that ACT on the board rather than author it.
 *
 * The four entity editors used to live here and now do not. A DialogV2 is a
 * fixed-width modal with nowhere to put a repeating widget, which is how a Plot's
 * Phase ladder ended up as a pipe-delimited textarea the GM had to type by hand.
 * Editing moved onto the board itself — see apps/board-editor.mjs and
 * logic/editing.mjs. What is left here is push, conclude, the cycle bill, the
 * purse, document links and the destructive confirmations: moments, not
 * documents, each of which should fit on one screen without scrolling.
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
 *  - `content` is passed through foundry.utils.cleanHTML, which DROPS any tag not
 *    on ALLOWED_HTML_TAGS and any attribute not on ALLOWED_HTML_ATTRIBUTES —
 *    silently, as an empty fragment. Verified against common/constants.mjs that
 *    everything below survives: input keeps checked/disabled/name/value/
 *    placeholder/type, select and textarea keep name, option keeps selected/value,
 *    and the global list covers class, data-*, style and id. Adding a tag or
 *    attribute outside those lists here fails by rendering nothing, with no error.
 *  - The one place that bites in this file: `textarea` does NOT carry placeholder
 *    on its allow-list (common/constants.mjs:1885) though `input` does. A
 *    placeholder written into the markup of a textarea is dropped without a word,
 *    so the push note sets its own from the render callback instead.
 */

import { ASSET_MODIFIER, MODE, VISIBILITY } from '../constants.mjs';
import {
    readBoard, plotById, nodeById, nodesForPlot, deletePlot, deleteNode,
    removeExample, concludeNode, forceById, plotsForForce, assetsForForce,
    deleteForce, upsertAsset, deleteAsset, adjustForceResources, advanceTurn,
    turnPreview, readConstants, advanceNode, readConditions, setAssetCondition
} from '../data/state.mjs';
import { getDefaultVisibility } from '../settings.mjs';
import {
    investmentOf, outcomeFor, stateAfterConclusion, effectiveThreshold, leader,
    resolveMode
} from '../logic/progress.mjs';
import { canAfford, pushCost } from '../logic/economy.mjs';
import { rowFor, labelOf } from '../logic/condition.mjs';

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
/**
 * An explanation the reader can ask for.
 *
 * These dialogs act on the board rather than author it, and each one should fit
 * on a screen without scrolling. A paragraph under every field is what stopped
 * that: four fields became four paragraphs and a window twice the height of the
 * form inside it. The words are the same words — they now live on a tooltip.
 *
 * data-* is on the global attribute allow-list, so this survives cleanHTML.
 *
 * NOT `inert`, though it looks decorative and every other bare icon here is. An
 * inert node is skipped by hit testing, so `pointerenter` fires on its parent
 * instead — and TooltipManager reads `event.target.dataset` (tooltip-manager.mjs
 * :132), which by then is the wrong element. A badge has to be hoverable to be a
 * badge, so this one is left alone — the same is true of every .rsr-info in the
 * templates.
 */
const info = (key) =>
    `<i class="fa-regular fa-circle-question rsr-info" data-tooltip="${esc(L(key))}"></i>`;

/**
 * What the table reads of ONE development, offered by every dialog that writes
 * one. Decided per development rather than inherited from the row it is about: the
 * same +1 can be a public rout or a quiet manoeuvre, and the moment the GM presses
 * the button is the only moment anyone knows which.
 */
const seenOptions = () => [
    { value: VISIBILITY.VISIBLE, label: L('RSR.log.seen.visible') },
    { value: VISIBILITY.MASKED, label: L('RSR.log.seen.masked') },
    { value: VISIBILITY.HIDDEN, label: L('RSR.log.seen.hidden') }
];

const select = (name, options, current, id = '') => `
    <select name="${name}"${id ? ` id="${id}"` : ''}>
        ${options.map((o) => `<option value="${esc(o.value)}"${o.value === current ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;

const readInt = (form, name, fallback = 0) => {
    const n = Number(form.elements[name]?.value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

// ── moving the needle ───────────────────────────────────────────────────────

/** What the Thread currently reads, in whatever shape its mode keeps score in. */
function readingOf(node, mode, threshold, forces) {
    if (mode === MODE.CLOCK) {
        const filled = Math.min(node.segments, Math.max(0, node.progress.pool));
        return `${filled} / ${node.segments}`;
    }
    if (mode === MODE.CONTESTED) {
        return forces.length
            ? forces.map((f) => `${f.name} ${node.progress.byForce[f.id] ?? 0}`).join('  ·  ')
            : '—';
    }
    return `${node.progress.pool} / ${threshold}`;
}

/**
 * One dialog for every push, replacing the strip of +1 / +3 / −1 buttons that used
 * to hang off each Thread and each Force.
 *
 * The buttons were unreadable in the way that matters: whether a push cost anything
 * depended on the Thread's mode and on which button you happened to be looking at,
 * and nothing on screen said so. Here the two questions are asked separately and
 * both are shown — how far the needle moves, and what that does to a Force's purse.
 * The cost starts at the old automatic figure (a Force pays one per point it moves)
 * and stays editable, because "the Dragon burned the siege works for free" and "we
 * sacked their supply train and came out ahead" are both ordinary table events.
 *
 * The note is the third field, and it is the reason the log exists: a number moving
 * is not a development until someone says what happened.
 */
export async function promptPush(threadId, { forceId = null } = {}) {
    const board = readBoard();
    const node = nodeById(board, threadId);
    if (!node) return false;
    const plot = plotById(board, node.plotId);
    const mode = resolveMode(node, plot);
    const assets = board.assets.filter((a) => a.nodeId === node.id);
    const threshold = effectiveThreshold(node, assets);
    const forces = (plot?.forceIds ?? []).map((id) => forceById(board, id)).filter(Boolean);

    // Contested Threads keep one pile per side, so there is no pile for a push in
    // nobody's name to land in.
    if (mode === MODE.CONTESTED && forces.length === 0) {
        ui.notifications?.warn(L('RSR.notify.contestedNeedsForce'));
        return false;
    }

    const NOBODY = 'nobody';
    const options = [
        ...(mode === MODE.CONTESTED ? [] : [{ value: NOBODY, label: L('RSR.editor.pushNobody') }]),
        ...forces.map((f) => ({
            value: f.id,
            label: game.i18n.format('RSR.editor.pushForceOption', {
                name: f.name, resources: f.resources
            })
        }))
    ];
    const preselect = forceId ?? (mode === MODE.CONTESTED ? forces[0]?.id ?? NOBODY : NOBODY);
    const suggested = preselect === NOBODY ? 0 : -pushCost(1);


    // One screenful: what is being moved, then the numbers, then what is said
    // about it. Every explanation is a tooltip rather than a paragraph, which is
    // most of the difference between this and the version it replaces.
    //
    // The note gets the full width and a real text area. It is the only answer
    // here that is a sentence, and it was previously a single-line input narrow
    // enough to clip its own example.
    //
    // Two quick chips, not three. A strip of them starts to read as a menu, and
    // the number beside it can be typed — these are for the push that is ±1.
    const content = `
        <header class="rsr-push-head">
            <strong class="rsr-push-name">${esc(node.name)}</strong>
            <span class="rsr-chip rsr-chip-mode">${esc(L(`RSR.thread.mode.${mode}`))}</span>
        </header>
        <p class="rsr-push-reading">${esc(readingOf(node, mode, threshold, forces))}</p>

        <div class="rsr-push-grid">
            <label for="rsr-push-amount">${esc(L('RSR.editor.pushAmount'))}${info('RSR.editor.pushAmountHint')}</label>
            <span class="rsr-push-field">
                <input type="number" id="rsr-push-amount" name="amount" value="1">
                <button type="button" class="rsr-quick" data-quick="-1">&minus;1</button>
                <button type="button" class="rsr-quick" data-quick="1">+1</button>
            </span>

            <label for="rsr-push-force">${esc(L('RSR.editor.pushForce'))}</label>
            <span class="rsr-push-field">
                ${select('forceId', options, preselect, 'rsr-push-force')}
                <label for="rsr-push-cost" class="rsr-push-inline-label">
                    ${esc(L('RSR.editor.pushCost'))}${info('RSR.editor.pushCostHint')}
                </label>
                <input type="number" id="rsr-push-cost" name="resourceDelta" value="${suggested}">
            </span>
        </div>

        <div class="rsr-push-note-block">
            <header class="rsr-push-note-head">
                <label for="rsr-push-note">${esc(L('RSR.editor.pushNote'))}${info('RSR.editor.pushNoteHint')}</label>
                <span class="rsr-push-field">
                    <label for="rsr-push-seen" class="rsr-push-inline-label">
                        ${esc(L('RSR.editor.pushSeen'))}${info('RSR.editor.pushSeenHint')}
                    </label>
                    ${select('visibility', seenOptions(), VISIBILITY.VISIBLE, 'rsr-push-seen')}
                </span>
            </header>
            <textarea id="rsr-push-note" name="note" rows="3"></textarea>
        </div>`;

    const result = await DialogV2.prompt({
        window: { title: L('RSR.editor.pushTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 480 },
        content,
        /**
         * Keep the cost in step with the amount until the GM touches it, then stop
         * — an assistant that keeps overwriting a number you just typed is worse
         * than one that never helped. `wait` forwards this callback (dialog.mjs:393)
         * and the dialog element is a <dialog> wrapping the form.
         */
        render: (event, dialog) => {
            const form = dialog.element.querySelector('form');
            if (!form) return;
            const amount = form.elements.amount;
            const who = form.elements.forceId;
            const cost = form.elements.resourceDelta;
            if (!amount || !who || !cost) return;

            let touched = false;
            cost.addEventListener('input', () => { touched = true; });

            // Set here, not in the markup: cleanHTML strips placeholder from a
            // textarea. See the file header.
            const note = form.elements.note;
            if (note) note.placeholder = L('RSR.editor.pushNotePlaceholder');

            // The quick chips write the amount rather than pushing by it: the GM
            // still sees what is about to happen, and can still edit it.
            for (const chip of form.querySelectorAll('[data-quick]')) {
                chip.addEventListener('click', () => {
                    amount.value = chip.dataset.quick;
                    amount.dispatchEvent(new Event('input', { bubbles: true }));
                });
            }

            const sync = () => {
                if (touched) return;
                // The suggestion is the module's own rule, not a second copy of
                // it: one Resource per point moved, negated because spending is
                // a negative delta on the purse.
                const n = Math.trunc(Number(amount.value) || 0);
                cost.value = String(who.value === NOBODY ? 0 : -pushCost(n));
            };
            amount.addEventListener('input', sync);
            who.addEventListener('change', sync);
        },
        ok: {
            label: L('RSR.editor.pushConfirm'),
            icon: 'fa-solid fa-arrow-right-long',
            // The return value IS the dialog result — see the header note.
            callback: (event, button) => {
                const form = button.form;
                const chosen = form.elements.forceId?.value ?? NOBODY;
                return {
                    amount: readInt(form, 'amount', 0),
                    forceId: chosen === NOBODY ? null : chosen,
                    resourceDelta: readInt(form, 'resourceDelta', 0),
                    note: form.elements.note?.value.trim() ?? '',
                    visibility: form.elements.visibility?.value ?? VISIBILITY.VISIBLE
                };
            }
        },
        rejectClose: false
    });

    if (!result) return false;
    if (result.amount === 0 && result.resourceDelta === 0 && !result.note) return false;

    // Checked here so the GM is told why nothing happened; state.mjs refuses the
    // same case silently, because by then the dialog is gone.
    const spender = result.forceId ? forceById(board, result.forceId) : null;
    if (spender && result.resourceDelta < 0 && !canAfford(spender, -result.resourceDelta)) {
        ui.notifications?.warn(game.i18n.format('RSR.notify.cannotAfford', {
            name: spender.name, resources: spender.resources
        }));
        return false;
    }

    await advanceNode(threadId, result);
    return true;
}

// ── conditions ──────────────────────────────────────────────────────────────────

/**
 * Put an Asset into a condition.
 *
 * A dialog rather than a field on the Asset's editor, because this is a moment and
 * not a document: it happens mid-session, it wants a sentence about why, and the
 * table hearing about it is half the point. Same shape as the push dialog, which
 * is the other thing on this board that changes a number and tells a story about
 * it \u2014 the reading, then the questions, then what happened.
 *
 * The Cycles row appears only for a condition that has a timer, and names what the
 * Asset becomes when it runs out, because "2 cycles" without "\u2192 Ready" is a
 * number with no consequence attached.
 */
export async function promptCondition(assetId) {
    const board = readBoard();
    const asset = board.assets.find((a) => a.id === assetId) ?? null;
    if (!asset) return false;
    const owner = forceById(board, asset.forceId);
    const conditions = readConditions();

    // localize, not print: labelOf yields an i18n key for an untouched built-in
    // and the GM's own text for anything they renamed, and localize returns an
    // unknown key unchanged.
    const named = (c) => L(labelOf(c));
    const options = conditions.map((c) => ({ value: c.id, label: named(c) }));
    const current = rowFor(conditions, asset.condition);

    // Every row's timer and successor, handed to the render callback so switching
    // the picker can rewrite the Cycles line without another trip to the world.
    const timers = Object.fromEntries(conditions.map((c) => [c.id, {
        cycles: c.cycles,
        becomes: c.becomes ? named(rowFor(conditions, c.becomes)) : '',
        isFinal: !!c.isFinal
    }]));

    const content = `
        <header class="rsr-push-head">
            <strong class="rsr-push-name">${esc(asset.name)}</strong>
            ${owner ? `<span class="rsr-chip rsr-chip-mode">${esc(owner.name)}</span>` : ''}
        </header>

        <div class="rsr-push-grid">
            <label for="rsr-cond-id">${esc(L('RSR.asset.conditionNow'))}${info('RSR.asset.conditionHint')}</label>
            <span class="rsr-push-field">
                ${select('condition', options, current.id, 'rsr-cond-id')}
            </span>

            <label for="rsr-cond-cycles" data-timer-row>${esc(L('RSR.asset.conditionFor'))}</label>
            <span class="rsr-push-field" data-timer-row>
                <input type="number" id="rsr-cond-cycles" name="cycles" value="${current.cycles}">
                <span class="rsr-push-inline-label" data-timer-becomes></span>
            </span>
        </div>

        <p class="rsr-form-note is-condition" data-final-warning hidden></p>

        <div class="rsr-push-note-block">
            <header class="rsr-push-note-head">
                <label for="rsr-cond-note">${esc(L('RSR.editor.pushNote'))}${info('RSR.editor.pushNoteHint')}</label>
                <span class="rsr-push-field">
                    <label for="rsr-cond-seen" class="rsr-push-inline-label">
                        ${esc(L('RSR.editor.pushSeen'))}${info('RSR.editor.pushSeenHint')}
                    </label>
                    ${select('visibility', seenOptions(), VISIBILITY.VISIBLE, 'rsr-cond-seen')}
                </span>
            </header>
            <textarea id="rsr-cond-note" name="note" rows="3"></textarea>
        </div>`;

    const result = await DialogV2.prompt({
        window: { title: L('RSR.asset.conditionTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 460 },
        content,
        render: (event, dialog) => {
            const form = dialog.element.querySelector('form');
            if (!form) return;
            const picker = form.elements.condition;
            const cycles = form.elements.cycles;
            if (!picker || !cycles) return;

            // cleanHTML strips placeholder from a textarea; see the file header.
            const note = form.elements.note;
            if (note) note.placeholder = L('RSR.asset.conditionNotePlaceholder');

            const rows = [...form.querySelectorAll('[data-timer-row]')];
            const becomes = form.querySelector('[data-timer-becomes]');
            const warning = form.querySelector('[data-final-warning]');

            // The Cycles number follows the picker until the GM types their own,
            // exactly as the push dialog's cost follows its amount \u2014 an assistant
            // that keeps overwriting what you just typed is worse than none.
            let touched = false;
            cycles.addEventListener('input', () => { touched = true; });

            const sync = () => {
                const timer = timers[picker.value] ?? { cycles: 0, becomes: '', isFinal: false };
                if (!touched) cycles.value = String(timer.cycles);
                const running = Number(cycles.value) > 0 || timer.cycles > 0;
                for (const row of rows) row.hidden = !running;
                becomes.textContent = timer.becomes
                    ? game.i18n.format('RSR.asset.conditionThen', { condition: timer.becomes })
                    : '';
                warning.textContent = timer.isFinal ? L('RSR.asset.conditionFinalWarning') : '';
                warning.hidden = !timer.isFinal;
            };
            picker.addEventListener('change', sync);
            sync();
        },
        ok: {
            label: L('RSR.asset.conditionConfirm'),
            icon: 'fa-solid fa-heart-crack',
            callback: (event, button) => {
                const form = button.form;
                return {
                    condition: form.elements.condition?.value ?? current.id,
                    cycles: readInt(form, 'cycles', 0),
                    note: form.elements.note?.value.trim() ?? '',
                    visibility: form.elements.visibility?.value ?? VISIBILITY.VISIBLE
                };
            }
        },
        rejectClose: false
    });

    if (!result) return false;

    // The guard a Final condition asks for. Deliberately a second press rather than
    // a checkbox in the same dialog: nobody should destroy a dragon by misclicking
    // a dropdown and then pressing the button they were always going to press.
    if (timers[result.condition]?.isFinal) {
        const sure = await DialogV2.confirm({
            window: { title: L('RSR.asset.conditionFinalTitle') },
            classes: ['daggerheart', 'dh-style', 'rsr'],
            content: `<p>${esc(game.i18n.format('RSR.asset.conditionFinalConfirm', {
                name: asset.name, condition: named(rowFor(conditions, result.condition))
            }))}</p>`,
            rejectClose: false,
            modal: true
        });
        if (!sure) return false;
    }

    await setAssetCondition(assetId, result);
    return true;
}

/**
 * Where the Assets standing in a deleted condition go.
 *
 * One picker per Asset, because the GM asked for it per Asset: four battalions in
 * a condition being retired are rarely four of the same story. There is a "set
 * them all to" control at the top, which is what makes twelve of them bearable
 * without taking the per-row choice away.
 *
 * Returns a map of asset id to condition id, or null if the GM backs out \u2014 in
 * which case nothing is written at all and the table on screen is left as it is,
 * so they can put the row back if that is what they meant.
 */
export async function promptRehome(assets, rows) {
    const named = (row) => L(labelOf(row));
    const options = rows.map((r) => ({ value: r.id, label: named(r) }));
    const fallback = rows[0]?.id ?? '';

    const content = `
        <p class="rsr-push-reading">${esc(game.i18n.format('RSR.asset.rehomeIntro', {
            count: assets.length
        }))}</p>

        <div class="rsr-rehome-all">
            <label for="rsr-rehome-all">${esc(L('RSR.asset.rehomeAll'))}</label>
            ${select('rehome-all', options, fallback, 'rsr-rehome-all')}
        </div>

        <div class="rsr-push-grid">
            ${assets.map((a) => `
                <label for="rsr-rehome-${esc(a.id)}">${esc(a.name)}</label>
                ${select(`asset-${a.id}`, options, fallback, `rsr-rehome-${esc(a.id)}`)}
            `).join('')}
        </div>`;

    const result = await DialogV2.prompt({
        window: { title: L('RSR.asset.rehomeTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 460 },
        content,
        render: (event, dialog) => {
            const form = dialog.element.querySelector('form');
            const all = form?.elements['rehome-all'];
            if (!all) return;
            // Fills every row rather than replacing them: the GM can still change
            // one afterwards, which is the whole reason the rows are there.
            all.addEventListener('change', () => {
                for (const a of assets) {
                    const el = form.elements[`asset-${a.id}`];
                    if (el) el.value = all.value;
                }
            });
        },
        ok: {
            label: L('RSR.asset.rehomeConfirm'),
            icon: 'fa-solid fa-arrow-right-arrow-left',
            callback: (event, button) => Object.fromEntries(assets.map((a) => [
                a.id, button.form.elements[`asset-${a.id}`]?.value ?? fallback
            ]))
        },
        rejectClose: false
    });

    return result ?? null;
}

// ── conclusion ───────────────────────────────────────────────────────────────

/**
 * Ask who carried the Thread, then conclude it.
 *
 * "Who won" is not a yes/no question, and contested Threads are GM-adjudicated by
 * design — the standings inform the call, they do not make it.
 *
 * The choice is a radio in each row rather than one button per Force. Force names
 * are sentences, and four of them in a button strip wrap into an unreadable mess;
 * more importantly the row is where the investment and the resulting State change
 * already are, so the decision sits next to what it follows from. The Force
 * currently ahead is preselected, which is a default, not a verdict.
 */
export async function promptConclude(threadId) {
    const board = readBoard();
    const node = nodeById(board, threadId);
    if (!node) return false;
    const plot = plotById(board, node.plotId);
    if (!plot) return false;

    const assets = board.assets.filter((a) => a.nodeId === node.id);
    const forces = plot.forceIds
        .map((id) => board.forces.find((f) => f.id === id))
        .filter(Boolean);

    // With no Forces the dialog still works: only the Nobody option is offered,
    // which concludes the Thread without moving State.
    const rows = forces.map((force) => {
        const invested = investmentOf(node, force.id);
        const after = stateAfterConclusion(plot, node, force.id);
        const delta = after - plot.state;
        const outcome = outcomeFor(node, force.id);
        return { force, invested, delta, note: outcome?.note ?? '' };
    });

    // The winner is picked in the LIST, not with one button per Force. Force names
    // are sentences ("The Northwall Guard"), and a button row cannot hold four of
    // them without wrapping into an unreadable mess. Putting the radio in the row
    // also means the choice sits beside the investment and consequence it follows
    // from, instead of a separate strip underneath.
    const ahead = leader(node, plot.forceIds);
    const options = [
        ...rows.map((r) => ({
            value: r.force.id,
            name: r.force.name,
            invested: String(r.invested),
            delta: `${r.delta >= 0 ? '+' : ''}${r.delta}`,
            note: r.note,
            checked: r.force.id === ahead
        })),
        {
            value: 'nobody', name: L('RSR.editor.concludeNobody'),
            invested: '—', delta: '0', note: L('RSR.editor.concludeNobodyHint'),
            checked: ahead === null
        }
    ];

    const table = `<ul class="rsr-conclude-list">${options.map((o) => `
        <li>
            <label class="rsr-conclude-row">
                <input type="radio" name="winner" value="${esc(o.value)}"${o.checked ? ' checked' : ''}>
                <span class="rsr-conclude-force">${esc(o.name)}</span>
                <span class="rsr-conclude-invested">${esc(o.invested)}</span>
                <span class="rsr-conclude-delta">${esc(o.delta)}</span>
                <span class="rsr-conclude-note">${esc(o.note)}</span>
            </label>
        </li>`).join('')}</ul>`;

    const threshold = effectiveThreshold(node, assets);
    const summary = game.i18n.format('RSR.editor.concludeSummary', {
        name: esc(node.name), threshold
    });

    const chosen = await DialogV2.prompt({
        window: { title: L('RSR.editor.concludeTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 560 },
        content: `<p>${summary}</p>${table}`,
        ok: {
            label: L('RSR.editor.conclude'),
            icon: 'fa-solid fa-gavel',
            // The return value IS the dialog result — see the header note.
            callback: (event, button) => button.form.elements.winner?.value ?? null
        },
        rejectClose: false
    });

    if (!chosen) return false;
    await concludeNode(threadId, chosen === 'nobody' ? null : chosen);
    return true;
}

// ── the purse ────────────────────────────────────────────────────────────────

/** GM fiat by an arbitrary amount. The ±1 buttons on the panel cover the common case. */
export async function promptAdjustResources(forceId) {
    const force = forceById(readBoard(), forceId);
    if (!force) return false;

    const delta = await DialogV2.prompt({
        window: { title: L('RSR.force.adjust') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 420 },
        content: `
            <p>${game.i18n.format('RSR.force.adjustSummary', {
                name: esc(force.name), resources: force.resources
            })}</p>
            ${field(`${L('RSR.force.adjustBy')} ${info('RSR.force.adjustHint')}`, number('delta', 0))}`,
        ok: {
            label: L('RSR.force.adjust'),
            callback: (event, button) => readInt(button.form, 'delta')
        },
        rejectClose: false
    });

    // 0, null and a closed dialog are all "no". Nothing to write either way.
    if (!delta) return false;
    await adjustForceResources(forceId, delta);
    return true;
}

/**
 * Advance Turn, with the bill shown first.
 *
 * The confirmation is not ceremony. Who gets paid depends on Plot lifecycle, which
 * is exactly the state a GM loses track of between sessions — seeing "the Guard is
 * not on this list" before pressing the button is how a Plot left Paused in
 * October gets noticed in November.
 */
export async function confirmAdvanceTurn() {
    const board = readBoard();
    const roster = turnPreview(board);

    // Every Force is listed, including the ones this cycle will not move. A bill
    // that shows only the Forces being paid cannot answer "why did the Guard get
    // nothing?", because the Guard is the row it left out.
    const reasonFor = (row) => {
        if (!row.isActive) return L('RSR.turn.reasonPaused');
        if (row.income === 0) return L('RSR.turn.reasonNoIncome');
        if (row.paid !== row.income) return L('RSR.turn.reasonFloor');
        return '';
    };

    const bill = roster.length === 0
        ? `<p class="hint">${esc(L('RSR.turn.nobodyPaid'))}</p>`
        : `<ul class="rsr-bill">${roster.map((row) => `
            <li class="${row.willBePaid ? '' : 'is-idle'}">
                <span class="rsr-bill-name">${esc(row.name)}</span>
                <span class="rsr-bill-delta">${row.paid > 0 ? '+' : ''}${row.paid || '—'}</span>
                <span class="rsr-bill-total">${row.from} &rarr; ${row.to}</span>
                <span class="rsr-bill-why">${esc(reasonFor(row))}</span>
            </li>`).join('')}</ul>`;

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.turn.advance') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 480 },
        content: `<p>${game.i18n.format('RSR.turn.advanceSummary', {
            turn: board.turn.count, next: board.turn.count + 1
        })}</p>${bill}`,
        rejectClose: false
    });
    if (!ok) return false;
    await advanceTurn();
    return true;
}

// ── document links ───────────────────────────────────────────────────────────

/**
 * An Asset may point at a real Foundry document, and both of these are reached by
 * dropping one onto the board rather than by typing a UUID.
 *
 * The record keeps its OWN name and image and only stores the uuid alongside them.
 * That is not redundancy: a compendium UUID cannot be resolved synchronously
 * (fromUuidSync is world-documents-only), so a row that rendered from its link
 * would be blank on every first paint. Copying at link time means the board draws
 * from what it already has and the document is a destination, not a dependency.
 */
async function resolveDropped(uuid) {
    const doc = await foundry.utils.fromUuid(uuid);
    if (!doc) ui.notifications?.warn(L('RSR.notify.unresolvedDocument'));
    return doc;
}

export async function linkAssetDocument(assetId, uuid) {
    const asset = readBoard().assets.find((a) => a.id === assetId);
    if (!asset) return false;
    const doc = await resolveDropped(uuid);
    if (!doc) return false;

    // The Asset's own name is left alone — a GM who named it "The Red Dragon of
    // Scarmound" does not want it renamed to "Dragon (Adult Red)" by a drop.
    await upsertAsset({ id: asset.id, uuid, img: asset.img || doc.img || '' });
    ui.notifications?.info(game.i18n.format('RSR.asset.linked', {
        name: asset.name, document: doc.name
    }));
    return true;
}

export async function createAssetFromDocument(forceId, uuid) {
    const force = forceById(readBoard(), forceId);
    if (!force) return false;

    // A dropped document creates an Asset like any other, so it costs the same.
    // Checked here as well as in state.mjs, because a drop that silently did
    // nothing would read as a broken drop target rather than an empty purse.
    const cost = readConstants().assetCost;
    if (cost > 0 && !canAfford(force, cost)) {
        ui.notifications?.warn(game.i18n.format('RSR.notify.assetUnaffordable', {
            name: force.name, cost, resources: force.resources
        }));
        return false;
    }

    const doc = await resolveDropped(uuid);
    if (!doc) return false;

    await upsertAsset({
        forceId,
        name: doc.name ?? '',
        img: doc.img ?? '',
        uuid,
        tags: [],
        plotId: null,
        nodeId: null,
        // A new Asset carries no mechanical weight until the GM gives it one. The
        // drop is for getting it onto the board fast; the editor is for what it does.
        modifier: { kind: ASSET_MODIFIER.NONE, value: 0 },
        visibility: getDefaultVisibility('asset'),
        hideValues: false
    });
    ui.notifications?.info(game.i18n.format('RSR.asset.created', {
        name: doc.name, force: force.name
    }));
    return true;
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

/**
 * Forget the chronicle. Nothing on the board changes — which is exactly why it
 * needs confirming: a GM expecting this to undo something would be very surprised.
 */
/**
 * Leaving an editor with unsaved changes.
 *
 * The only reason this dialog exists is that the editor is the one place on the
 * board that does not write as you touch it. Everywhere else, walking away loses
 * nothing.
 */
export async function confirmDiscard() {
    return DialogV2.confirm({
        window: { title: L('RSR.editor.discardTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        content: `<p>${L('RSR.editor.discardWarning')}</p>`,
        yes: { label: L('RSR.editor.discard'), icon: 'fa-solid fa-trash' },
        rejectClose: false
    });
}

export async function confirmClearLog() {
    const ok = await DialogV2.confirm({
        window: { title: L('RSR.log.clear') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        content: `<p>${L('RSR.log.clearWarning')}</p>`,
        rejectClose: false
    });
    if (!ok) return false;
    const { clearLog } = await import('../data/state.mjs');
    await clearLog();
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

export async function confirmDeleteForce(forceId) {
    const board = readBoard();
    const force = forceById(board, forceId);
    if (!force) return false;

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deleteForce') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        content: `<p>${game.i18n.format('RSR.editor.deleteForceWarning', {
            name: esc(force.name),
            plots: plotsForForce(board, forceId).length,
            assets: assetsForForce(board, forceId).length
        })}</p>`,
        rejectClose: false
    });
    if (!ok) return false;
    await deleteForce(forceId);
    return true;
}

export async function confirmDeleteAsset(assetId) {
    const asset = readBoard().assets.find((a) => a.id === assetId);
    if (!asset) return false;

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deleteAsset') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        content: `<p>${game.i18n.format('RSR.editor.deleteAssetWarning', { name: esc(asset.name) })}</p>`,
        rejectClose: false
    });
    if (!ok) return false;
    await deleteAsset(assetId);
    return true;
}
