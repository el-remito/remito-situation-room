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

import {
    ASSET_MODIFIER, CONCLUDED_BY_CONSEQUENCE, MODE, TRACK, VISIBILITY
} from '../constants.mjs';
import {
    readBoard, plotById, nodeById, deletePlot, deleteNode,
    removeExample, concludeNode, forceById,
    deleteForce, upsertAsset, deleteAsset, adjustForceResources, advanceTurn,
    turnPreview, turnTimers, turnDeadlines, turnResolvable, turnSkips, advancePlotTurn,
    readConstants, advanceNode,
    readConditions, setAssetCondition, revertTurn, beginChapter
} from '../data/state.mjs';
import { getDefaultVisibility } from '../settings.mjs';
import {
    investmentOf, outcomeFor, stateAfterConclusion, effectiveThreshold, leader,
    resolveMode, depletes, pushSign, hasConsequence, consequenceShared,
    consequenceSize, consequenceOf, consequenceFull
} from '../logic/progress.mjs';
import { canAfford, pushCost, hasOwnTurn } from '../logic/economy.mjs';
import * as Expiry from '../logic/expiry.mjs';
import {
    worldClock, plotClock, cycleReading, runLabelAt, runMarks, expiryLabel
} from '../ui/clock.mjs';
import {
    threadRemoval, plotRemoval, forceRemoval, assetRemoval
} from '../logic/removal.mjs';
import {
    refusal as revertRefusal, summary as revertSummary, nextMark, hasMark
} from '../logic/cycle.mjs';
import { rowFor, labelOf } from '../logic/condition.mjs';

const { DialogV2 } = foundry.applications.api;
const esc = (v) => foundry.utils.escapeHTML(String(v ?? ''));
const L = (key) => game.i18n.localize(key);

// ── markup helpers ───────────────────────────────────────────────────────────

const field = (label, control, hint = '') => `
    <div class="form-group">
        <label>${label}</label>
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
 * The words are MARKUP, not a sentence. TooltipManager takes `data-tooltip`
 * through cleanHTML and assigns it as innerHTML (tooltip-manager.mjs:264), so a
 * hint written as paragraphs renders as paragraphs — and `data-tooltip-class`
 * hands the tooltip element the rule that lays them out. Escaping here is still
 * required and still correct: the attribute is written into HTML source, and the
 * parser decodes it back to markup on the way into the dataset.
 *
 * NOT `inert`, though it looks decorative and every other bare icon here is. An
 * inert node is skipped by hit testing, so `pointerenter` fires on its parent
 * instead — and TooltipManager reads `event.target.dataset` (tooltip-manager.mjs
 * :132), which by then is the wrong element. A badge has to be hoverable to be a
 * badge, so this one is left alone — the same is true of every .rsr-info in the
 * templates.
 */
const info = (key) =>
    `<i class="fa-regular fa-circle-question rsr-info" data-tooltip-class="rsr-tip"
        data-tooltip="${esc(L(key))}"></i>`;

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

/**
 * What the Thread currently reads, in whatever shape its mode keeps score in.
 *
 * A depleting Thread reads DOWN here as it does on the board, or the dialog and
 * the row it was opened from would disagree about the same number. A depleting
 * CONTEST reads each side down separately, against the one threshold they share
 * — which is the whole shape: two reserves, and whichever empties first.
 */
function readingOf(node, mode, threshold, forces, draining = false) {
    const left = (spent, total) => (draining ? Math.max(0, total - spent) : spent);
    if (mode === MODE.CLOCK) {
        const filled = Math.min(node.segments, Math.max(0, node.progress.pool));
        return `${left(filled, node.segments)} / ${node.segments}`;
    }
    if (mode === MODE.CONTESTED) {
        return forces.length
            ? forces
                .map((f) => `${f.name} ${left(node.progress.byForce[f.id] ?? 0, threshold)}`)
                .join('  ·  ')
            : '—';
    }
    return `${left(Math.min(threshold, Math.max(0, node.progress.pool)), threshold)} / ${threshold}`;
}

/**
 * What the CONSEQUENCE currently reads, in the same line the reading above
 * occupies for the Thread's own progress.
 *
 * Never inverted. A complication is what is mounting, whichever direction the
 * Thread beside it is written in — see `promptPush` on why `draining` is forced
 * off for this track.
 *
 * A per-side track prints every side, the way a contest does, so a GM pressing
 * one side's button can still see what the others are standing at.
 */
function consequenceReadingOf(node, plot, forces) {
    const size = consequenceSize(node);
    if (consequenceShared(node, plot)) return `${consequenceOf(node)} / ${size}`;
    return forces.length
        ? forces.map((f) => `${f.name} ${consequenceOf(node, f.id)} / ${size}`).join('  ·  ')
        : '—';
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
export async function promptPush(threadId, { forceId = null, track = TRACK.PROGRESS } = {}) {
    const board = readBoard();
    const node = nodeById(board, threadId);
    if (!node) return false;
    const plot = plotById(board, node.plotId);
    const mode = resolveMode(node, plot);

    /**
     * WHICH PILE THIS PRESS IS POINTED AT.
     *
     * The button standing beside the reading said so, which is why there is no
     * picker for it here: a control that moves the number it is next to needs no
     * second question about which number it meant.
     *
     * A Consequence push is refused outright when the Thread does not keep one.
     * The control is not drawn in that case, but a render can be stale — a second
     * GM may have switched the track off, or the mode to Narrative, while this one
     * was reading — and the same rule that refuses an unaffordable push applies.
     */
    const onConsequence = track === TRACK.CONSEQUENCE;
    if (onConsequence && !hasConsequence(node, plot)) {
        ui.notifications?.warn(L('RSR.notify.noConsequence'));
        return false;
    }

    const onExpiry = track === TRACK.EXPIRY;
    if (onExpiry && !Expiry.hasExpiry(node)) {
        ui.notifications?.warn(L('RSR.notify.noExpiry'));
        return false;
    }

    // The GM is never in preview here — the dialog does not open for a player —
    // so this is the stored answer rather than a projected one.
    //
    // A Consequence never drains. It is what is MOUNTING, whichever way the
    // reading beside it is written: eight weeks of rations falling to nothing is
    // still a situation whose complications are piling up, and a track that
    // inverted with the Thread it stands under would count them backwards.
    // A deadline reads DOWN always — nobody counts up to a door closing — and
    // that is not the Thread's `countdown` switch, which is about its own
    // progress. So the box is filled in the direction the deadline moves: you
    // type −1 to give it one more cycle, and the reading rises by one.
    const draining = onExpiry || (!onConsequence && depletes(node, plot));
    // What one press of the forward direction looks like in the box. −1 on a
    // depleting Thread, because the field is filled in the direction the reading
    // moves — see `pushSign`. state.mjs turns it back around at the write.
    // −1 on a deadline, because spending a cycle of it is what the button is
    // for; −1 on a depleting Thread for the reason `pushSign` gives; 1 on
    // everything else, including a Consequence, which only ever mounts.
    const sign = onExpiry ? -1 : (draining ? pushSign(node, plot) : 1);
    const assets = board.assets.filter((a) => a.nodeId === node.id);
    const threshold = effectiveThreshold(node, assets);
    const forces = (plot?.forceIds ?? []).map((id) => forceById(board, id)).filter(Boolean);

    // Contested Threads keep one pile per side, so there is no pile for a push in
    // nobody's name to land in. A Consequence on the same Thread may still be one
    // shared track, in which case nobody's name is exactly where it lands.
    // A deadline names nobody: time passing is not something a side does, and
    // the picker is not drawn for it at all.
    const needsSide = onExpiry ? false : (onConsequence
        ? (mode === MODE.CONTESTED && !consequenceShared(node, plot))
        : mode === MODE.CONTESTED);
    if (needsSide && forces.length === 0) {
        ui.notifications?.warn(L('RSR.notify.contestedNeedsForce'));
        return false;
    }

    const NOBODY = 'nobody';
    const options = [
        ...(needsSide ? [] : [{ value: NOBODY, label: L('RSR.editor.pushNobody') }]),
        ...forces.map((f) => ({
            value: f.id,
            label: game.i18n.format('RSR.editor.pushForceOption', {
                name: f.name, resources: f.resources
            })
        }))
    ];
    const preselect = forceId ?? (needsSide ? forces[0]?.id ?? NOBODY : NOBODY);
    /**
     * What the cost box opens on.
     *
     * A complication is not a purchase. Nobody buys the siege works catching
     * fire, so a Consequence push suggests nothing and the box starts at zero —
     * still typeable, because a Force that spent to make something go wrong for
     * somebody else is an ordinary table event and this dialog has never been in
     * the business of refusing those.
     */
    const suggested = onConsequence || onExpiry || preselect === NOBODY ? 0 : -pushCost(1);


    // One screenful: what is being moved, then the numbers, then what is said
    // about it. Every explanation is a tooltip rather than a paragraph, which is
    // most of the difference between this and the version it replaces.
    //
    // The note gets the full width and a real text area. It is the only answer
    // here that is a sentence, and it was previously a single-line input narrow
    // enough to clip its own example.
    //
    // Two quick chips, not three. A strip of them starts to read as a menu, and
    // the number beside it can be typed — these are a stepper for the push that
    // is counted out rather than known, and each press moves the field by one.
    // Which pile, said in the header rather than asked in a picker. The chip
    // stands where the mode chip stands on an ordinary push, because on this
    // dialog "what am I moving" is the same size of question as "what kind of
    // Thread is this" — and on a Consequence push it is the more important one.
    const trackChip = onConsequence
        ? `<span class="rsr-chip rsr-chip-consequence">${esc(L('RSR.thread.consequence'))}</span>`
        : (onExpiry
            ? `<span class="rsr-chip rsr-chip-expiry">${esc(L('RSR.thread.expiry'))}</span>`
            : '');
    const content = `
        <header class="rsr-push-head">
            <strong class="rsr-push-name">${esc(node.name)}</strong>
            <span class="rsr-chip rsr-chip-mode">${esc(L(`RSR.thread.mode.${mode}`))}</span>
            ${trackChip}
            ${draining ? `<span class="rsr-chip rsr-chip-depleting">${esc(L('RSR.thread.depleting'))}</span>` : ''}
        </header>
        <p class="rsr-push-reading">${esc(onExpiry
            ? `${Expiry.expiryLeft(node)} / ${Expiry.expirySize(node)}`
            : (onConsequence
                ? consequenceReadingOf(node, plot, forces)
                : readingOf(node, mode, threshold, forces, draining)))}</p>

        <div class="rsr-push-grid">
            <label for="rsr-push-amount">${esc(L('RSR.editor.pushAmount'))}${info('RSR.editor.pushAmountHint')}</label>
            <span class="rsr-push-field">
                <input type="number" id="rsr-push-amount" name="amount" value="${sign}">
                <button type="button" class="rsr-quick" data-quick="-1">&minus;1</button>
                <button type="button" class="rsr-quick" data-quick="1">+1</button>
            </span>

            ${onExpiry ? '' : `
            <label for="rsr-push-force">${esc(L('RSR.editor.pushForce'))}</label>
            <span class="rsr-push-field">
                ${select('forceId', options, preselect, 'rsr-push-force')}
                <label for="rsr-push-cost" class="rsr-push-inline-label">
                    ${esc(L('RSR.editor.pushCost'))}${info('RSR.editor.pushCostHint')}
                </label>
                <input type="number" id="rsr-push-cost" name="resourceDelta" value="${suggested}">
            </span>`}
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
            // The deadline's dialog has neither of the last two: time passing
            // names nobody and costs nothing, so those controls are not
            // rendered at all rather than rendered and ignored. Everything
            // below them is about keeping the cost in step with the amount, so
            // there is nothing left to wire.
            if (!amount) return;

            // Set here, not in the markup: cleanHTML strips placeholder from a
            // textarea. See the file header.
            const note = form.elements.note;
            if (note) note.placeholder = L('RSR.editor.pushNotePlaceholder');

            // The quick chips STEP the amount, they do not set it. Assigning was
            // the first build and it made a strip of nudges that could only ever
            // produce 1 or -1: pressing +1 four times left the field reading 1,
            // which is the one number the GM did not mean. Four presses now read
            // 4, and the field is still typeable for a push nobody wants to count
            // out. Nothing is clamped — stepping past a full clock is the
            // ordinary way to say "and then some", and `chargeFor` already bills
            // only what actually moved.
            //
            // Above the early return below, because these are the one control a
            // deadline's dialog shares with every other push.
            for (const chip of form.querySelectorAll('[data-quick]')) {
                chip.addEventListener('click', () => {
                    const step = Math.trunc(Number(chip.dataset.quick) || 0);
                    amount.value = String(Math.trunc(Number(amount.value) || 0) + step);
                    amount.dispatchEvent(new Event('input', { bubbles: true }));
                });
            }

            if (!who || !cost) return;

            let touched = false;
            cost.addEventListener('input', () => { touched = true; });

            const sync = () => {
                if (touched) return;
                // The suggestion is the module's own rule, not a second copy of
                // it: one Resource per point moved, negated because spending is
                // a negative delta on the purse.
                // Costed on what the push BUYS, not on what is typed: on a
                // depleting Thread the two have opposite signs and only one of
                // them is a spend.
                //
                // A Consequence buys nothing, so it suggests nothing and leaves
                // the box wherever the GM put it.
                if (onConsequence || onExpiry) return;
                const n = Math.trunc(Number(amount.value) || 0) * sign;
                cost.value = String(who.value === NOBODY ? 0 : -pushCost(n));
            };
            amount.addEventListener('input', sync);
            who.addEventListener('change', sync);
        },
        ok: {
            label: L('RSR.editor.pushConfirm'),
            // Pointing the way the reading will move, like the button that
            // opened this dialog.
            // The track first, then the direction. A deadline and a complication
            // each have a shape of their own, and only an ordinary push is
            // described by an arrow.
            icon: onExpiry ? 'fa-solid fa-hourglass-end'
                : (onConsequence ? 'fa-solid fa-triangle-exclamation'
                    : (draining ? 'fa-solid fa-arrow-left-long'
                        : 'fa-solid fa-arrow-right-long')),
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

    await advanceNode(threadId, { ...result, track });
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
    /**
     * The fourth answer: its own complications ended it.
     *
     * Offered only when the Thread keeps a Consequence, and PRESELECTED when that
     * track is at its line — which is the whole reason the ending exists. It
     * carries its own State change like every other row, so the GM reads what
     * each answer costs before choosing between them rather than after.
     *
     * `invested` is a dash because nobody spent anything: a complication is what
     * happened to this Thread, not what was bought with it.
     */
    const consequence = hasConsequence(node, plot);
    const complicated = consequence && consequenceFull(node, plot);
    const consequenceDelta = stateAfterConclusion(plot, node, CONCLUDED_BY_CONSEQUENCE)
        - plot.state;

    const ahead = leader(node, plot.forceIds);
    const options = [
        ...rows.map((r) => ({
            value: r.force.id,
            name: r.force.name,
            invested: String(r.invested),
            delta: `${r.delta >= 0 ? '+' : ''}${r.delta}`,
            note: r.note,
            // A full Consequence takes the default off whoever was ahead: the
            // reading that reached its line is the one the GM came to answer.
            checked: !complicated && r.force.id === ahead
        })),
        ...(consequence ? [{
            value: CONCLUDED_BY_CONSEQUENCE,
            name: L('RSR.thread.consequence'),
            invested: '—',
            delta: `${consequenceDelta >= 0 ? '+' : ''}${consequenceDelta}`,
            note: outcomeFor(node, CONCLUDED_BY_CONSEQUENCE).note
                || L('RSR.editor.concludeConsequenceHint'),
            checked: complicated
        }] : []),
        {
            value: 'nobody', name: L('RSR.editor.concludeNobody'),
            invested: '—', delta: '0', note: L('RSR.editor.concludeNobodyHint'),
            checked: !complicated && ahead === null
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
            ${field(`${esc(L('RSR.force.adjustBy'))} ${info('RSR.force.adjustHint')}`,
                number('delta', 0))}`,
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
 * The timers a cycle is about to move, as a list, or '' when none are running.
 *
 * `turnTimers` runs the same pure function the cycle itself runs, so this is the
 * operation rather than a description of it. A row that merely counts down says
 * so; a row that ARRIVES somewhere names where, because those are the two
 * different things a GM is looking at and only one of them is a development.
 */
function timerBill(rows, board, showPlot = false) {
    if (!rows.length) return '';
    const naming = (id) => L(labelOf(rowFor(board.conditions, id)));

    // Whose Asset it is, and what it is standing on. An Asset name alone is not
    // enough to find on a board with two Plots and four Forces on it: "The River
    // Runners are on a timer" leaves the GM to go looking for the River Runners.
    //
    // The owner is named on every bill, because ownership is the one thing a
    // committed Asset and an uncommitted one both have. The Plot is named only on
    // the world's bill — a Plot's own bill has already named it in the sentence
    // above — and the Thread on both, since a Plot holds several.
    const owner = (asset) => forceById(board, asset.forceId)?.name ?? '';
    const placeOf = (asset) => [
        showPlot && asset.plotId ? plotById(board, asset.plotId)?.name : null,
        asset.nodeId ? nodeById(board, asset.nodeId)?.name : null
    ].filter(Boolean).map(esc).join(' &rsaquo; ');

    const list = rows.map(({ asset, change }) => {
        const arrives = change.condition !== undefined;
        const place = placeOf(asset);
        return `
            <li class="${arrives ? '' : 'is-idle'}">
                <span class="rsr-bill-name">${esc(asset.name)}</span>
                <span class="rsr-bill-where">
                    <span class="rsr-bill-owner">${esc(owner(asset))}</span>
                    ${place ? `<span class="rsr-bill-place">${place}</span>` : ''}
                </span>
                <span class="rsr-bill-why">${esc(arrives
                    ? game.i18n.format('RSR.turn.timerArrives', {
                        from: naming(asset.condition), to: naming(change.condition)
                    })
                    : game.i18n.format('RSR.turn.timerCounts', {
                        condition: naming(asset.condition), left: change.conditionCycles
                    }))}</span>
            </li>`;
    }).join('');

    return `<ul class="rsr-bill rsr-bill-timers">${list}</ul>`;
}

/** A heading for one section of a bill, so the lists are told apart. */
const billHead = (key) => `<p class="rsr-bill-head">${esc(L(key))}</p>`;

/**
 * The Expiration Clocks this cycle is about to move, as a list, or '' when none
 * are running.
 *
 * The same shape as `timerBill` and for the same reason: `turnDeadlines` runs
 * the pure function the cycle itself runs, so the GM is shown the operation
 * rather than a description of it. A Thread merely counting down is `is-idle`;
 * one RUNNING OUT gets the sentence, because only one of those is a development.
 *
 * The Plot is named on the world's bill and not on a Plot's own, exactly as the
 * timers do it — a Plot's bill has already named its Plot in the sentence above.
 */
function deadlineBill(rows, board, showPlot = false) {
    if (!rows.length) return '';

    const list = rows.map(({ node, change, expires }) => {
        const plot = showPlot && node.plotId ? plotById(board, node.plotId)?.name : null;
        const left = Math.max(0, Expiry.expirySize(node) - change.progress.expiry);
        return `
            <li class="${expires ? '' : 'is-idle'}">
                <span class="rsr-bill-name">${esc(node.name)}</span>
                <span class="rsr-bill-where">
                    ${plot ? `<span class="rsr-bill-place">${esc(plot)}</span>` : ''}
                </span>
                <span class="rsr-bill-why">${esc(expires
                    ? game.i18n.format('RSR.turn.deadlineEnds', {
                        label: expiryLabel(board, node)
                    })
                    : game.i18n.format('RSR.turn.deadlineCounts', { left }))}</span>
            </li>`;
    }).join('');

    return `<ul class="rsr-bill rsr-bill-deadlines">${list}</ul>`;
}

/**
 * How many of a bill's timers actually ARRIVE somewhere, which is the same
 * test `turn.advance` uses to decide which of them is worth a line in the
 * chronicle. A counter going down is not a development and is not counted.
 */
const arrivals = (rows) => rows.filter(({ change }) => change.condition !== undefined).length;

/**
 * What could be resolved before this cycle turns, as markup, or '' when nothing
 * could.
 *
 * THE FIRST THING ON THE BILL, above the income. Everything else a cycle
 * confirmation shows is what the press is ABOUT to do; this is the one section
 * about what the GM might want to do instead, and a warning printed under three
 * lists of arithmetic is a warning nobody reads.
 *
 * It is a warning and not a refusal. The confirm button underneath is already
 * the "do you still want to proceed" — adding a second dialog would be asking
 * the same question twice, and refusing outright would be the board deciding
 * that a full bar means a finished situation, which is exactly the judgement it
 * has never made anywhere else.
 *
 * When nothing qualifies the section is absent entirely, so the ordinary press
 * looks exactly as it always did.
 */
function resolvableBill(rows, board, showPlot = false) {
    if (!rows.threads.length && !rows.plots.length) return '';

    const reasons = (list, prefix) => list.map((r) => L(`${prefix}.${r}`)).join(' · ');

    const threads = rows.threads.map(({ node, plot, reasons: why }) => `
        <li>
            <span class="rsr-bill-name">${esc(node.name)}</span>
            <span class="rsr-bill-where">
                ${showPlot && plot ? `<span class="rsr-bill-place">${esc(plot.name)}</span>` : ''}
            </span>
            <span class="rsr-bill-why">${esc(reasons(why, 'RSR.turn.resolvableReason'))}</span>
        </li>`).join('');

    // Plots second and marked as Plots, because "the Long Road could be
    // resolved" and "the envoy could be resolved" are different sizes of
    // decision and the list would otherwise read as one flat set of rows.
    const plots = rows.plots.map(({ plot, reasons: why }) => `
        <li class="is-plot">
            <span class="rsr-bill-name">
                <i class="fa-solid fa-scroll" inert></i> ${esc(plot.name)}
            </span>
            <span class="rsr-bill-where"></span>
            <span class="rsr-bill-why">${esc(reasons(why, 'RSR.turn.resolvablePlotReason'))}</span>
        </li>`).join('');

    return `${billHead('RSR.turn.resolvableTitle')}
        <p class="hint rsr-bill-lead">${esc(L('RSR.turn.resolvableLead'))}</p>
        <ul class="rsr-bill rsr-bill-resolvable">${threads}${plots}</ul>`;
}

/**
 * Advance Turn, with the bill shown first.
 *
 * The confirmation is not ceremony. What a cycle does depends on which Forces are
 * paused and which Plots keep their own clock, and both are exactly the state a
 * GM loses track of between sessions — seeing "the Guard is not on this list"
 * before pressing the button is how a Force paused in October gets noticed in
 * November, and the same goes for a Plot that has been sitting out since.
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

    // The Plots this press will not reach, named at the moment of pressing.
    // Without this the button silently does less than it says, and the GM finds
    // out weeks later by noticing a Plot that never moved.
    const skips = turnSkips(board);
    const sittingOut = skips.length === 0 ? '' : `
        ${billHead('RSR.turn.sittingOut')}
        <ul class="rsr-bill rsr-bill-plots">${skips.map((row) => `
            <li class="is-idle">
                <span class="rsr-bill-name">${esc(row.name)}</span>
                <span class="rsr-bill-why">${esc(L(`RSR.turn.reason.${row.behaviour}`))}</span>
            </li>`).join('')}</ul>`;

    const timerRows = turnTimers(board);
    const timers = timerBill(timerRows, board, true);

    // The other countdown this press moves. Beside the timers rather than
    // folded into them: an Asset arriving in a condition and a Thread running
    // out of time are different developments, and a GM scanning for one of them
    // should not have to read past the other.
    const deadlineRows = turnDeadlines(board);
    const deadlines = deadlineBill(deadlineRows, board, true);

    // What was already standing at its line when the button was reached for.
    // Read across the whole board, because that is what this press moves.
    const standing = resolvableBill(turnResolvable(board), board, true);

    const ok = await DialogV2.confirm({
        window: { title: game.i18n.format('RSR.turn.advanceNamed', {
            label: worldClock(board)
        }) },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 560 },
        content: `<p>${game.i18n.format('RSR.turn.advanceSummary', {
            from: esc(cycleReading(board, board.turn.count)),
            to: esc(cycleReading(board, board.turn.count + 1))
        })}</p>
        ${standing}
        ${roster.length ? billHead('RSR.turn.incomeTitle') : ''}${bill}
        ${timers ? billHead('RSR.turn.timersTitle') + timers : ''}
        ${deadlines ? billHead('RSR.turn.deadlinesTitle') + deadlines : ''}
        ${sittingOut}`,
        rejectClose: false
    });
    if (!ok) return false;
    await advanceTurn();

    // A cycle is the one press on this board whose effects are all somewhere
    // else: purses in the Cockpit, conditions on Assets that may not be on
    // screen, a counter in the header. Nothing under the cursor changes, so
    // without this the GM has pressed a button and watched nothing happen.
    ui.notifications?.info(game.i18n.format('RSR.turn.advancedNotice', {
        reading: cycleReading(board, board.turn.count + 1),
        paid: roster.filter((row) => row.willBePaid).length,
        arrived: arrivals(timerRows),
        // Threads that actually ran out, not Threads whose counter moved — the
        // same rule the timers already follow, and the same reason.
        ended: deadlineRows.filter((row) => row.expires).length
    }));
    return true;
}

/**
 * One Plot's own cycle, with the same bill and one thing said out loud.
 *
 * The reminder is the point of the dialog. "Advance this Plot" reads like a
 * smaller version of the button beside the Cockpit, and it is not: the world's
 * count does not move and nobody is paid, because income belongs to the Force
 * and the Force is standing on other Plots too. A GM who assumed otherwise would
 * be quietly underpaying their own campaign, so the dialog says what it does
 * and what it does not before it does anything.
 */
export async function confirmAdvancePlotTurn(plotId) {
    const board = readBoard();
    const plot = plotById(board, plotId);
    if (!plot || !hasOwnTurn(plot)) return false;

    const rows = turnTimers(board, plotId);
    const timers = timerBill(rows, board);   // no Plot column: this dialog names one Plot

    // Only the deadlines this Plot's clock owns. A Thread on this Plot that the
    // GM set to the world's cycle is counting in the campaign's time and is not
    // this button's business — the same scoping the timers already have.
    const deadlineRows = turnDeadlines(board, plotId);
    const deadlines = deadlineBill(deadlineRows, board);

    // This Plot alone. A GM pressing one Plot's cycle is not being asked about
    // another Plot's business, and the Plot itself can be one of the rows.
    const standing = resolvableBill(turnResolvable(board, plotId), board);

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.turn.plotAdvance') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 520 },
        content: `<p>${game.i18n.format('RSR.turn.plotSummary', {
            plot: esc(plot.name), label: esc(plotClock(plot)),
            turn: plot.turnCount, next: plot.turnCount + 1
        })}</p>
        ${standing}
        ${billHead('RSR.turn.timersTitle')}
        ${timers || `<p class="hint">${esc(L('RSR.turn.noTimers'))}</p>`}
        ${deadlines ? billHead('RSR.turn.deadlinesTitle') + deadlines : ''}
        <p class="hint">${esc(game.i18n.format('RSR.turn.plotNoIncome', {
            reading: cycleReading(board)
        }))}</p>`,
        rejectClose: false
    });
    if (!ok) return false;
    await advancePlotTurn(plotId);

    // Named, because a board can hold several of these and the button that
    // moved one of them sits inside the Plot it belongs to. The count is the
    // Plot's own; no Force is mentioned because none was paid.
    ui.notifications?.info(game.i18n.format('RSR.turn.plotAdvancedNotice', {
        plot: plot.name,
        label: plotClock(plot),
        turn: plot.turnCount + 1,
        arrived: arrivals(rows),
        ended: deadlineRows.filter((row) => row.expires).length
    }));
    return true;
}

/**
 * Take back the last cycle, having said exactly what that puts back.
 *
 * The only UNDO on this board, and narrow on purpose: it replays a record the
 * advance itself wrote, and it is refused the moment anything else has been
 * recorded since. logic/cycle.mjs holds both halves of that and says why.
 *
 * THE LIST IS THE DIALOG. Everything a cycle does is somewhere the GM is not
 * looking — purses in the Cockpit, counts on Plots they are not inside, timers
 * on Assets that may not be on screen at all — so an undo that only asked "are
 * you sure" would be asking them to confirm something they cannot see. Every
 * purse, count and timer is named by the row it belongs to, with both numbers.
 *
 * `plotId` is passed in only so the wrong button cannot be wired to the right
 * record by accident; the record on the board is what decides.
 */
export async function confirmRevertTurn(plotId = null) {
    const board = readBoard();
    const undo = board.turn.undo;

    // Checked here as well as on the button, and said out loud rather than
    // silently doing nothing: a disabled control the GM pressed anyway, or a
    // render that went stale while they read it, both land here.
    const why = revertRefusal(undo, board.log);
    if (why) {
        ui.notifications?.warn(L(`RSR.turn.revertReason.${why}`));
        return false;
    }
    if ((undo.plotId ?? null) !== (plotId ?? null)) {
        ui.notifications?.warn(L('RSR.turn.revertReason.since'));
        return false;
    }

    // `chapters` is on the clock rather than on the board's top level, so it is
    // handed in by name: a Segment opened on the cycle being taken back stops
    // existing with it, and the GM ought to read that before pressing.
    // `board` already carries `nodes`, so the deadlines come along with the
    // purses and the timers for free; `chapters` is the one thing that lives on
    // the clock rather than at the board's top level.
    const said = revertSummary(undo, { ...board, chapters: runMarks(board) });
    const plot = undo.plotId ? plotById(board, undo.plotId) : null;
    const clock = said.clocks.find((c) => c.id === undo.plotId) ?? null;
    const conditions = readConditions();

    // A Plot's own cycle says which Plot and which count in the question itself,
    // so its clock is not repeated in the list underneath it.
    const head = plot && clock
        ? game.i18n.format('RSR.turn.revertSummaryPlot', {
            plot: esc(plot.name), label: esc(plotClock(plot)),
            from: clock.from, to: clock.to
        })
        : game.i18n.format('RSR.turn.revertSummary', {
            from: esc(cycleReading(board)),
            to: esc(cycleReading(board, said.count))
        });

    const rows = [];
    const line = (icon, key, data) => rows.push(
        `<li><i class="${icon}" inert></i><span>${game.i18n.format(key, data)}</span></li>`
    );

    for (const purse of said.purses) {
        line('fa-solid fa-coins', 'RSR.turn.revertPurse', {
            name: `<strong>${esc(purse.name)}</strong>`, from: purse.from, to: purse.to
        });
    }
    for (const row of said.clocks) {
        if (clock && row.id === clock.id) continue;
        line('fa-solid fa-hourglass-half', 'RSR.turn.revertClock', {
            name: `<strong>${esc(row.name)}</strong>`, turn: row.to
        });
    }
    for (const timer of said.timers) {
        line('fa-solid fa-heart-crack',
            timer.recommitted ? 'RSR.turn.revertTimerHeld' : 'RSR.turn.revertTimer', {
                name: `<strong>${esc(timer.name)}</strong>`,
                condition: esc(L(labelOf(rowFor(conditions, timer.condition)))),
                cycles: timer.cycles
            });
    }
    // A window that closed and is about to be open again. Said as its own
    // sentence, because a Thread coming back from having run out is a bigger
    // fact than a counter moving by one — and it is the only line here that
    // changes what the GM can still do with a row rather than only its numbers.
    for (const deadline of said.deadlines) {
        line('fa-solid fa-hourglass-half',
            deadline.unexpires ? 'RSR.turn.revertDeadlineOpen' : 'RSR.turn.revertDeadline', {
                name: `<strong>${esc(deadline.name)}</strong>`,
                left: Math.max(0, deadline.size - deadline.to)
            });
    }
    // The only thing on this list the GM did by hand rather than by pressing the
    // cycle, which is exactly why it is worth its own line: everything else here
    // is the press being undone, and this is a decision being undone with it.
    for (const mark of said.marks) {
        line('fa-solid fa-bookmark', 'RSR.turn.revertMark', {
            name: `<strong>${esc(mark.name || runLabelAt(board, mark.at))}</strong>`
        });
    }
    // Always said, even at zero: the chronicle is the one thing the table can
    // see, and a GM ought to know before pressing that a line they watched
    // appear is about to stop being there.
    line('fa-solid fa-scroll', 'RSR.turn.revertLines', { count: said.lines });

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.turn.revertTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor', 'rsr-delete-dialog'],
        content: `<p>${head}</p>`
            + `<p class="rsr-fallout-head">${L('RSR.turn.revertHead')}</p>`
            + `<ul class="rsr-fallout">${rows.join('')}</ul>`,
        rejectClose: false
    });
    if (!ok) return false;
    await revertTurn();

    ui.notifications?.info(L('RSR.turn.revertedNotice'));
    return true;
}

/**
 * Open a Segment on the cycle the board is standing on.
 *
 * The name is optional and the dialog says what the run will be called without
 * one, because most of them never get a name and a required field for a thing a
 * GM does not have a word for yet is a field that stops them marking at all. A
 * name given here is not a second copy of anything — it REPLACES the ordinal in
 * the reading, so "The Siege · Global Cycle 3" is what the header and every
 * stamp inside that run say.
 *
 * A confirmation and not a bare press, because unlike a cycle this cannot be
 * undone by a control standing beside it: taking a mark back is a row removed in
 * Settings, one screen away.
 */
export async function confirmBeginChapter() {
    const board = readBoard();
    const at = nextMark(board.turn.count);

    // Checked here as well as on the button. The control is drawn disabled when
    // the cycle is already marked, but a second GM may have marked it while this
    // one was reading, and the writer refuses it again regardless.
    if (hasMark(runMarks(board), at)) {
        ui.notifications?.warn(L('RSR.turn.segmentAlready'));
        return false;
    }

    // What it will be called if nothing is typed: the reading of that same cycle
    // once the mark is on the board, which is the only honest preview of it.
    const numbered = runLabelAt({ ...board, turn: {
        ...board.turn, chapters: [...runMarks(board), { at, name: '' }]
    } }, at);

    const content = `
        <p class="rsr-push-reading">${esc(game.i18n.format('RSR.turn.segmentIntro', {
            segment: numbered, reading: cycleReading(board, at)
        }))}</p>

        <div class="rsr-push-grid">
            <label for="rsr-segment-name">
                ${esc(L('RSR.turn.segmentName'))}${info('RSR.turn.segmentNameHint')}
            </label>
            <span class="rsr-push-field">
                <input type="text" id="rsr-segment-name" name="name"
                       placeholder="${esc(numbered)}">
            </span>
        </div>

        <p class="rsr-form-note">${esc(L('RSR.turn.segmentNote'))}</p>`;

    const name = await DialogV2.prompt({
        window: { title: L('RSR.turn.segmentTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor'],
        position: { width: 440 },
        content,
        ok: {
            label: L('RSR.turn.segmentConfirm'),
            icon: 'fa-solid fa-bookmark',
            // A string, and the empty one is a real answer — the callback's
            // return IS the result, and only nullish falls through to the
            // action name (see the file header).
            callback: (event, button) => String(button.form.elements.name?.value ?? '')
        },
        rejectClose: false
    });
    if (name == null) return false;

    await beginChapter(name);
    ui.notifications?.info(game.i18n.format('RSR.turn.segmentBegunNotice', {
        segment: name.trim() || numbered
    }));
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

/**
 * Deleting a Plot, and saying what that costs.
 *
 * The largest delete on the board, and for a long time the one that said the
 * least: a count of Threads, and nothing about what those Threads were holding.
 * A Plot on screen is a name and a State bar — the Assets standing on its
 * Threads are drawn on Force cards, the Phase that names one of them may be in a
 * different Plot entirely, and none of it is visible from the button.
 */
export async function confirmDeletePlot(plotId) {
    const board = readBoard();
    const plot = plotById(board, plotId);
    if (!plot) return false;
    const report = plotRemoval(plotId, board);

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deletePlot') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor', 'rsr-delete-dialog'],
        content: `<p>${game.i18n.format('RSR.editor.deletePlotWarning', {
            name: esc(plot.name)
        })}</p>` + falloutMarkup(report),
        rejectClose: false
    });
    if (!ok) return false;
    await deletePlot(plotId);
    return true;
}

/**
 * The fallout list, as markup.
 *
 * One line per consequence, each naming the row it is about and what happens to
 * it — because "are you sure" is not a question a GM can answer without knowing
 * that the Ram comes loose and the Second Assault opens. The report is built in
 * logic/removal.mjs; everything here is presentation.
 *
 * The icons are per KIND, not per outcome, so the list can be read down its left
 * edge: a cube is an Asset, a broken link is a requirement, a ladder is a Phase,
 * a scroll is the chronicle. Every name goes through esc() on the way in — these
 * are GM-authored strings landing in a raw-HTML dialog.
 */
function falloutMarkup(report) {
    const lines = [];
    const line = (icon, key, data) => lines.push(
        `<li><i class="${icon}" inert></i><span>${game.i18n.format(key, data)}</span></li>`
    );

    // The Threads a Plot takes with it. First, because it is the largest thing
    // that happens and every other line below is a consequence of it.
    for (const thread of report.threads) {
        line('fa-solid fa-diagram-project',
            thread.concluded ? 'RSR.editor.falloutThreadDone' : 'RSR.editor.falloutThread',
            { name: `<strong>${esc(thread.name)}</strong>` });
    }

    // `fate` is the whole reason this is one loop and not two: a Thread and a
    // Plot RELEASE their Assets, a Force DELETES them, and those two sentences
    // must never be printed for each other.
    for (const asset of report.assets) {
        const key = asset.fate === 'deleted'
            ? 'RSR.editor.falloutAssetGone' : 'RSR.editor.falloutAsset';
        line('fa-solid fa-cubes-stacked', key, {
            name: `<strong>${esc(asset.name)}</strong>`,
            force: esc(asset.forceName),
            thread: esc(asset.nodeName ?? '')
        });
    }

    for (const plot of report.plotsCast) {
        line('fa-solid fa-scroll', 'RSR.editor.falloutCast', {
            plot: `<strong>${esc(plot.name)}</strong>`
        });
    }

    for (const contest of report.contests) {
        line('fa-solid fa-scale-balanced', 'RSR.editor.falloutContest', {
            name: `<strong>${esc(contest.name)}</strong>`, pool: contest.pool
        });
    }

    for (const outcome of report.outcomes) {
        line('fa-solid fa-pen-nib', 'RSR.editor.falloutOutcome', {
            name: `<strong>${esc(outcome.name)}</strong>`
        });
    }

    for (const credit of report.credits) {
        line('fa-solid fa-flag-checkered', 'RSR.editor.falloutCredit', {
            name: `<strong>${esc(credit.name)}</strong>`
        });
    }

    if (report.commitment) {
        const c = report.commitment;
        line('fa-solid fa-hand-holding',
            c.nodeName ? 'RSR.editor.falloutStandingOn' : 'RSR.editor.falloutLentTo',
            {
                thread: `<strong>${esc(c.nodeName)}</strong>`,
                plot: `<strong>${esc(c.plotName)}</strong>`
            });
    }

    if (report.rosterCount > 0) {
        line('fa-solid fa-users', 'RSR.editor.falloutRoster', { count: report.rosterCount });
    }

    for (const dep of report.dependents) {
        const key = dep.concluded ? 'RSR.editor.falloutConcluded'
            : dep.frees ? 'RSR.editor.falloutFrees'
                : 'RSR.editor.falloutRequires';
        line('fa-solid fa-link-slash', key, { name: `<strong>${esc(dep.name)}</strong>` });
    }

    // A Phase can both reveal and lock the same Thread — a GM authoring "shut
    // here, open there" across two rungs — so the two are asked separately
    // rather than as an either/or.
    for (const phase of report.phases) {
        const data = {
            plot: esc(phase.plotName), phase: `<strong>${esc(phase.phaseLabel)}</strong>`
        };
        if (phase.reveals) line('fa-solid fa-layer-group', 'RSR.editor.falloutReveal', data);
        if (phase.locks) line('fa-solid fa-layer-group', 'RSR.editor.falloutLock', data);
    }

    if (report.logCount > 0) {
        line('fa-solid fa-scroll', 'RSR.editor.falloutLog', { count: report.logCount });
    }

    if (lines.length === 0) {
        // Written per kind rather than once: "nothing requires it" is true of a
        // Thread and meaningless of a Force, and a reassurance that does not
        // match what was asked reads as a form letter.
        const none = {
            thread: 'RSR.editor.falloutNoneThread',
            plot: 'RSR.editor.falloutNonePlot',
            force: 'RSR.editor.falloutNoneForce',
            asset: 'RSR.editor.falloutNoneAsset'
        }[report.kind] ?? 'RSR.editor.falloutNoneThread';
        return `<p class="rsr-fallout-none">${L(none)}</p>`;
    }
    return `<p class="rsr-fallout-head">${L('RSR.editor.falloutHead')}</p>`
        + `<ul class="rsr-fallout">${lines.join('')}</ul>`;
}

/**
 * Deleting a Thread, and saying what that costs.
 *
 * The dialog used to ask about the Thread alone, which is the only part of the
 * delete that is on screen when the button is pressed. Three other things move —
 * committed Assets come loose, Threads that required this one stop requiring it,
 * and Phases lose it from their reveal and lock lists — and every one of them is
 * somewhere the GM is not looking. So the report is read first and the answer is
 * printed above the button.
 */
export async function confirmDeleteThread(threadId) {
    const board = readBoard();
    const node = nodeById(board, threadId);
    if (!node) return false;
    const report = threadRemoval(threadId, board);

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deleteThread') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor', 'rsr-delete-dialog'],
        content: `<p>${game.i18n.format('RSR.editor.deleteThreadWarning', { name: esc(node.name) })}</p>`
            + falloutMarkup(report),
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

/**
 * Deleting a Force, and saying what that costs.
 *
 * The most destructive of the four. Every other delete on this board releases
 * what it was holding; this one takes its Assets with it, permanently, and
 * refunds nothing — the Resources spent developing them are simply gone. Two
 * counts in a sentence were never going to carry that, so the Assets are named
 * one by one and the word is *deleted*.
 */
export async function confirmDeleteForce(forceId) {
    const board = readBoard();
    const force = forceById(board, forceId);
    if (!force) return false;
    const report = forceRemoval(forceId, board);

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deleteForce') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor', 'rsr-delete-dialog'],
        content: `<p>${game.i18n.format('RSR.editor.deleteForceWarning', {
            name: esc(force.name)
        })}</p>` + falloutMarkup(report),
        rejectClose: false
    });
    if (!ok) return false;
    await deleteForce(forceId);
    return true;
}

/**
 * Deleting an Asset, and saying what that costs.
 *
 * The shallowest of the four — nothing else stores an Asset's id — but not a
 * silent one. A committed Asset is discounting pushes on a Thread that is on
 * another screen, and nothing refunds what it cost to develop. A GM deleting one
 * to take back raising it should learn that here rather than from the purse.
 */
export async function confirmDeleteAsset(assetId) {
    const board = readBoard();
    const asset = board.assets.find((a) => a.id === assetId);
    if (!asset) return false;
    const report = assetRemoval(assetId, board);

    const ok = await DialogV2.confirm({
        window: { title: L('RSR.editor.deleteAsset') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-editor', 'rsr-delete-dialog'],
        content: `<p>${game.i18n.format('RSR.editor.deleteAssetWarning', {
            name: esc(asset.name)
        })}</p>` + falloutMarkup(report),
        rejectClose: false
    });
    if (!ok) return false;
    await deleteAsset(assetId);
    return true;
}
