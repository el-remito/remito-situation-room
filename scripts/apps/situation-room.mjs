/**
 * The board. One window, three segments.
 *
 * There is deliberately only one application class. The GM's Cockpit is a mode of
 * the same window rather than a second app, so a GM can flip to Player View and
 * see literally what the table sees — not a second render path that agrees with
 * the first only until someone edits one of them.
 *
 * Help is the third segment and is available to players too, with role-adjusted
 * copy chosen by an i18n variant suffix rather than by building strings in JS.
 *
 * All withholding happens HERE, in _prepareContext, via logic/visibility.mjs.
 * Templates receive only what the viewer is already allowed to read. Nothing is
 * rendered-then-hidden, because anything in the context can be read out of the DOM.
 */

import {
    CONSTANT_DEFAULTS, EDIT_KIND, LIFECYCLE, LOG_KIND, MODE, NODE_STATUS, POLARITY,
    PREFIX, TEMPLATES, VIEW, VISIBILITY, VISIBILITY_KINDS
} from '../constants.mjs';
import {
    readBoard, visiblePlots, plotById, nodesForPlot, forcesForPlot,
    assetsForNode, hasExample, forceById, allForces, assetsForForce,
    plotsForForce, turnPreview, readLog
} from '../data/state.mjs';
import { resolvePhase, resolvePhaseForGM, statePercent } from '../logic/state-track.mjs';
import { resolveMode, effectiveThreshold, isFull } from '../logic/progress.mjs';
import { engagedForceIds, uncommittedAssets } from '../logic/economy.mjs';
import * as Cond from '../logic/condition.mjs';
import {
    visibleRows, projectIdentity, projectProgress, projectClock, projectForceChip,
    projectTone, projectMode, maskNoteOf, showValues, isHidden, isMasked
} from '../logic/visibility.mjs';
import * as Edit from '../logic/editing.mjs';
import { harvest, readField, clearField, editorContext } from './board-editor.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Help sections, in reading order. Each resolves to RSR.help.<key>.title and
 * RSR.help.<key>.body.<gm|player> — the variant picks the string, rather than JS
 * assembling one. A milestone that adds a feature adds its key here.
 */
/**
 * Every action except the ones that only LOOK is dead while the preview is on.
 *
 * The markup already withholds the controls — a previewing GM is projected as a
 * player, so nothing that writes is drawn — and this is the second lock on the
 * same door. It is worth having because the list is inverted: a NEW action added
 * next year is guarded by default, and has to be named here to work while the
 * GM is pretending to be somebody who cannot use it. The alternative, a list of
 * things to block, is a list somebody eventually forgets to add to.
 *
 * @param {object} actions      the data-action map
 * @param {string[]} navigation names that only move the reader around
 */
const whileLooking = (actions, navigation = ['selectView', 'openPlot', 'closePlot', 'togglePreview']) =>
    Object.fromEntries(Object.entries(actions).map(([name, handler]) => [
        name,
        navigation.includes(name) ? handler : function (...args) {
            if (this.isPreviewing) return undefined;
            return handler.apply(this, args);
        }
    ]));

const HELP_SECTIONS = [
    { key: 'plots' },
    { key: 'threads' },
    { key: 'advancing' },
    { key: 'forces' },
    { key: 'state' },
    { key: 'log' },
    // Authoring, not playing. A player reading "this is how you edit a Phase"
    // would be reading about a screen they cannot open, so they are not offered
    // the section at all rather than offered a paragraph explaining that.
    { key: 'editing', gmOnly: true },
    { key: 'settings', gmOnly: true }
];

/**
 * How many developments the column shows. The world keeps more (logic/log.mjs),
 * but a column is read from the top and a scroll of two hundred lines is an
 * archive rather than a glance.
 */
const LOG_ROWS = 40;

/** Which glyph each kind of development wears in the chronicle. */
const LOG_ICONS = {
    [LOG_KIND.PUSH]: 'fa-solid fa-arrow-right-long',
    [LOG_KIND.CONCLUDE]: 'fa-solid fa-gavel',
    [LOG_KIND.REOPEN]: 'fa-solid fa-rotate-left',
    [LOG_KIND.COMMIT]: 'fa-solid fa-shield-halved',
    [LOG_KIND.RELEASE]: 'fa-solid fa-hand',
    [LOG_KIND.CONDITION]: 'fa-solid fa-heart-crack',
    [LOG_KIND.CYCLE]: 'fa-solid fa-hourglass-end'
};

/**
 * Our own drag payload type. Foundry's document drops carry a `uuid`, so the two
 * kinds of drop are told apart by shape rather than by which listener caught them.
 */
const ASSET_DRAG = 'rsr-asset';

/** A Force chip being dragged between headings inside the Plot editor. */
const ROSTER_DRAG = 'rsr-roster-force';

/**
 * What a masked row of this KIND is called, localized once per row rather than
 * held, because it is cheap and holding it invites it going stale.
 *
 * A bare "???" says something is being withheld and nothing about what sort of
 * something. "Unknown activity — ???" says a Thread is running, which is what a
 * mask is FOR: the table is meant to know there is a thing there. The row's own
 * `maskLabel` beats this, and logic/visibility.mjs does that preferring, so
 * nothing here has to remember to.
 */
const MASK_KEYS = {
    [EDIT_KIND.PLOT]: 'RSR.visibility.maskPlot',
    [EDIT_KIND.NODE]: 'RSR.visibility.maskNode',
    [EDIT_KIND.FORCE]: 'RSR.visibility.maskForce',
    [EDIT_KIND.ASSET]: 'RSR.visibility.maskAsset'
};

const maskLabel = (kind) =>
    game.i18n.localize(MASK_KEYS[kind] ?? 'RSR.visibility.maskedName');

export class SituationRoom extends HandlebarsApplicationMixin(ApplicationV2) {

    /**
     * Marker for ui/refresh.mjs. It finds our instances by this rather than by
     * importing this class, which is what stops settings -> refresh -> apps from
     * closing an import cycle.
     */
    static RSR_APP = true;

    static DEFAULT_OPTIONS = {
        id: `${PREFIX}-board`,
        // System class, system style class, module prefix, per-window prefix.
        classes: ['daggerheart', 'dh-style', PREFIX, `${PREFIX}-board`],
        tag: 'div',
        window: {
            frame: true,
            positioned: true,
            title: 'RSR.board.title',
            icon: 'fa-solid fa-tower-observation',
            minimizable: true,
            resizable: true,
            contentClasses: [`${PREFIX}-window-content`]
        },
        // Must be a fixed integer. "auto" scrolls the page instead of the window.
        position: { width: 1100, height: 760 },
        actions: whileLooking({
            selectView: SituationRoom._onSelectView,
            openPlot: SituationRoom._onOpenPlot,
            closePlot: SituationRoom._onClosePlot,
            createPlot: SituationRoom._onCreatePlot,
            editPlot: SituationRoom._onEditPlot,
            removePlot: SituationRoom._onRemovePlot,
            createThread: SituationRoom._onCreateThread,
            editThread: SituationRoom._onEditThread,
            removeThread: SituationRoom._onRemoveThread,
            pushThread: SituationRoom._onPushThread,
            concludeThread: SituationRoom._onConcludeThread,
            reopenThread: SituationRoom._onReopenThread,
            createForce: SituationRoom._onCreateForce,
            editForce: SituationRoom._onEditForce,
            removeForce: SituationRoom._onRemoveForce,
            adjustResources: SituationRoom._onAdjustResources,
            nudgeResources: SituationRoom._onNudgeResources,
            createAsset: SituationRoom._onCreateAsset,
            editAsset: SituationRoom._onEditAsset,
            setAssetCondition: SituationRoom._onSetAssetCondition,
            editConditions: SituationRoom._onEditConditions,
            removeAsset: SituationRoom._onRemoveAsset,
            releaseAsset: SituationRoom._onReleaseAsset,
            advanceTurn: SituationRoom._onAdvanceTurn,
            toggleForceActive: SituationRoom._onToggleForceActive,
            saveEdit: SituationRoom._onSaveEdit,
            revertEdit: SituationRoom._onRevertEdit,
            closeEdit: SituationRoom._onCloseEdit,
            addPhase: SituationRoom._onAddPhase,
            removePhase: SituationRoom._onRemovePhase,
            addTag: SituationRoom._onAddTag,
            removeTag: SituationRoom._onRemoveTag,
            addPrereq: SituationRoom._onAddPrereq,
            removePrereq: SituationRoom._onRemovePrereq,
            addRosterForce: SituationRoom._onAddRosterForce,
            removeRosterForce: SituationRoom._onRemoveRosterForce,
            addGroup: SituationRoom._onAddGroup,
            clearAssetLink: SituationRoom._onClearAssetLink,
            removeGroup: SituationRoom._onRemoveGroup,
            addCondition: SituationRoom._onAddCondition,
            removeCondition: SituationRoom._onRemoveCondition,
            restoreConditions: SituationRoom._onRestoreConditions,
            saveSettings: SituationRoom._onSaveSettings,
            resetSettings: SituationRoom._onResetSettings,
            clearLog: SituationRoom._onClearLog,
            generateExample: SituationRoom._onGenerateExample,
            clearExample: SituationRoom._onClearExample,
            togglePreview: SituationRoom._onTogglePreview
        })
    };

    /**
     * `scrollable` is the native v14 mechanism: the Handlebars mixin snapshots the
     * listed elements' scroll positions in _preSyncPartState and restores them in
     * _syncPartState. Without it every re-render — including one triggered by
     * another client — throws the reader back to the top of the board.
     *
     * The same pass restores focus, but only for an element with an id or a [name],
     * which is why the advance buttons carry a name.
     */
    static PARTS = {
        main: { template: TEMPLATES.BOARD, scrollable: ['.rsr-body'] }
    };

    /** Which segment is showing. Instance state — a view preference, not world data. */
    #view = VIEW.SITUATION;

    /** The plot currently drilled into, or null for the list. */
    #plotId = null;

    /**
     * Whether the GM is looking at the board as the table sees it.
     *
     * Instance state, like #view: a way of looking, not world data, and nobody
     * else's client learns it. It exists because the M5 rule — withheld data
     * never reaches a player's context — is invisible from the GM's side by
     * construction. A GM who has masked four Threads and hidden a Force has no
     * way to check their own work short of logging in as somebody else, and a GM
     * who cannot check tends to either over-hide or stop bothering.
     *
     * It is deliberately not a projection of a projection. #viewer() is the ONE
     * flag every builder reads, so the preview is the same code path a player
     * gets, not a second rendering of it that could drift. What it does not
     * prove is what is on the player's MACHINE — see the Help callout.
     */
    #asPlayer = false;

    /**
     * The open editor, or null.
     *
     * `{ kind, id, draft, snapshot }`. The draft is a working copy and the world
     * knows nothing about it until Save — see logic/editing.mjs for why this is
     * the one control on the board that does not write immediately.
     *
     * There is no `returnTo`: edit mode renders OVER whatever view is current,
     * leaving #view and #plotId untouched, so closing it simply reveals what was
     * already underneath.
     */
    #edit = null;

    get view() { return this.#view; }

    /** Read by whileLooking, which cannot reach a private field from outside. */
    get isPreviewing() { return this.#asPlayer; }

    /**
     * The flag every context builder projects against.
     *
     * A GM previewing the board is a player for the whole of this window: not
     * "a GM who is shown less", which would leave every builder deciding for
     * itself which of the two flags it meant.
     */
    #viewer() { return game.user.isGM && !this.#asPlayer; }

    /** Players have no Cockpit and no Settings; asking for one lands them back. */
    setView(view) {
        const gmOnly = view === VIEW.COCKPIT || view === VIEW.SETTINGS;
        this.#view = (gmOnly && !this.#viewer()) ? VIEW.SITUATION : view;
        this.render();
    }

    /**
     * Look at the board as the table does, or stop.
     *
     * Leaves the editor first, with its own dirty guard: an editor is authoring,
     * and there is no such thing as authoring as a player.
     */
    async togglePreview() {
        if (!game.user.isGM) return;
        if (!await this.#leaveEditor()) return;
        this.#asPlayer = !this.#asPlayer;
        // A GM who was in the Cockpit and presses this would otherwise preview a
        // segment no player has.
        if (this.#asPlayer && this.#view !== VIEW.HELP) this.#view = VIEW.SITUATION;
        this.render();
    }

    // ── edit mode ────────────────────────────────────────────────────────────

    /** The editor's form element, or null when no editor is open. */
    #form() {
        return this.element?.querySelector('form.rsr-editor-form') ?? null;
    }

    /**
     * Open an editor over the current view.
     *
     * @param {string} kind   EDIT_KIND
     * @param {string|null} id  null to create
     * @param {object} seed   context a blank needs: plotId for a Thread, forceId
     *                        for an Asset
     */
    #openEditor(kind, id, seed = {}) {
        if (!this.#viewer()) return;
        const board = readBoard();
        if (kind === EDIT_KIND.CONDITIONS) seed = { rows: board.conditions };
        const entity = id ? this.#findEntity(board, kind, id) : null;
        if (id && !entity) return;

        const draft = Edit.draftFrom(kind, entity, board.constants, seed);
        // The snapshot is what Revert restores and what the Save bar counts
        // against: how the row looked when this editor opened, not how it looks
        // in the world now.
        this.#edit = { kind, id: id ?? null, draft, snapshot: foundry.utils.deepClone(draft) };
        this.render();
    }

    #findEntity(board, kind, id) {
        if (kind === EDIT_KIND.PLOT) return plotById(board, id);
        if (kind === EDIT_KIND.NODE) return board.nodes.find((n) => n.id === id) ?? null;
        if (kind === EDIT_KIND.FORCE) return forceById(board, id);
        return board.assets.find((a) => a.id === id) ?? null;
    }

    /**
     * Take what is on screen into the draft, then change it, then re-render.
     *
     * Every structural button goes through here. Adding a Phase card re-renders
     * the whole part, so anything typed since the last render has to be captured
     * BEFORE the mutation or it is silently lost — which is the one bug this
     * design is most likely to grow.
     */
    #mutate(change) {
        if (!this.#edit) return;
        const form = this.#form();
        const harvested = harvest(this.#edit.kind, form, this.#edit.draft);
        this.#edit.draft = change(harvested, form) ?? harvested;
        this.render();
    }

    /**
     * Leave the editor, asking first if there is anything to lose. Returns false
     * when the GM decides to stay, which is what stops a view switch mid-edit.
     */
    async #leaveEditor() {
        if (!this.#edit) return true;
        this.#edit.draft = harvest(this.#edit.kind, this.#form(), this.#edit.draft);
        if (Edit.dirtyKeys(this.#edit.snapshot, this.#edit.draft).length > 0) {
            const { confirmDiscard } = await import('./editors.mjs');
            if (!await confirmDiscard()) return false;
        }
        this.#edit = null;
        this.render();
        return true;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        // Not game.user.isGM: a GM in preview IS a player as far as everything
        // below is concerned, and there is exactly one flag saying so.
        const isGM = this.#viewer();
        const board = readBoard();

        // Every branch the template needs is decided here. Not because `eq` is
        // missing — v14 registers it globally — but because a branch resolved in
        // the markup needs both sides of it in the context, and half of what this
        // window renders is data a player must never be sent.
        const segments = [
            { id: VIEW.SITUATION, label: 'RSR.board.viewSituation', icon: 'fa-solid fa-map' },
            ...(isGM ? [
                { id: VIEW.COCKPIT, label: 'RSR.board.viewCockpit', icon: 'fa-solid fa-chess-rook' },
                { id: VIEW.SETTINGS, label: 'RSR.board.viewSettings', icon: 'fa-solid fa-sliders' }
            ] : []),
            { id: VIEW.HELP, label: 'RSR.board.viewHelp', icon: 'fa-solid fa-circle-question' }
        ].map((s) => ({ ...s, active: s.id === this.#view }));

        // An editor renders over everything else. Nothing underneath is built
        // while it is open: a Cockpit nobody can see is not worth shaping.
        if (this.#edit && isGM) {
            return {
                ...context,
                isGM,
                segments,
                canPreview: game.user.isGM,
                isPreview: this.#asPlayer,
                isEditing: true,
                turn: board.turn.count,
                editor: editorContext(this.#edit.kind, this.#edit, board)
            };
        }

        // A plot the GM hid out from under a player who had it open.
        const open = this.#plotId ? plotById(board, this.#plotId) : null;
        const openVisible = open && visibleRows([open], isGM).length === 1 ? open : null;

        return {
            ...context,
            isGM,
            segments,
            // The control belongs to the real GM, and has to survive the preview
            // it turns on — it is the only way back out.
            canPreview: game.user.isGM,
            isPreview: this.#asPlayer,
            isSituation: this.#view === VIEW.SITUATION,
            isCockpit: this.#view === VIEW.COCKPIT,
            isHelp: this.#view === VIEW.HELP,
            turn: board.turn.count,
            hasExample: hasExample(board),
            helpSections: HELP_SECTIONS
                .filter((section) => isGM || !section.gmOnly)
                .map(({ key, gmOnly }) => ({
                    key,
                    title: `RSR.help.${key}.title`,
                    // A GM-only section has no player variant to choose between.
                    body: gmOnly ? `RSR.help.${key}.body.gm`
                        : `RSR.help.${key}.body.${isGM ? 'gm' : 'player'}`
                })),
            plots: this.#buildPlotList(board, isGM),
            openPlot: openVisible ? this.#buildPlotDetail(board, openVisible, isGM) : null,
            // The chronicle stands beside the Plot list, so it is built only when
            // that list is what is on screen.
            log: this.#view === VIEW.SITUATION && !openVisible
                ? this.#buildLog(board, isGM)
                : null,
            // The Cockpit is GM-only, so nothing in it is projected. It is built
            // only when it is on screen: a world with forty Forces should not pay
            // to shape them while the reader is looking at the Plot list.
            cockpit: isGM && this.#view === VIEW.COCKPIT ? this.#buildCockpit(board) : null,
            settings: isGM && this.#view === VIEW.SETTINGS ? this.#buildSettings(board) : null
        };
    }

    // ── context builders ─────────────────────────────────────────────────────

    #buildPlotList(board, isGM) {
        return visibleRows(visiblePlots(board), isGM).map((plot) => ({
            ...this.#plotHeader(board, plot, isGM),
            threadCount: visibleRows(nodesForPlot(board, plot.id), isGM).length
        }));
    }

    /**
     * The header a Plot shows in both the list and the detail view.
     *
     * Only ONE Phase is ever projected. Sending plot.phases would tell a player
     * there is a "Rain of Fire" Phase coming and roughly how far off it is — the
     * exact thing the masking controls exist to withhold — so the ladder never
     * leaves this method.
     */
    #plotHeader(board, plot, isGM) {
        const identity = projectIdentity(plot, isGM, maskLabel(EDIT_KIND.PLOT));
        const phase = isGM ? resolvePhaseForGM(plot) : resolvePhase(plot);
        const reveal = showValues(plot, isGM);

        return {
            id: plot.id,
            ...identity,
            isExample: plot.isExample,
            lifecycle: plot.lifecycle,
            isActive: plot.lifecycle === LIFECYCLE.ACTIVE,
            lifecycleLabel: `RSR.plot.lifecycle.${plot.lifecycle}`,
            // A masked plot surrenders its Phase along with its name.
            phaseLabel: identity.masked ? null : (phase?.label ?? null),
            // What this Phase looks like from the table. Authored per Phase and
            // printed for everyone — unlike gmNotes, which is the GM's own copy.
            phaseDescription: identity.masked ? '' : (phase?.description ?? ''),
            phaseTone: projectTone(plot, isGM, phase?.tone),
            gmNotes: isGM ? (phase?.gmNotes ?? '') : '',
            percent: statePercent(plot),
            // What the table hears instead of the State bar. Written by the GM
            // on a masked Plot, and it replaces the reading rather than sitting
            // under it: a bar beside "nobody can say how it is going" would be
            // answering the question the sentence just declined.
            maskNote: maskNoteOf(plot, isGM),
            showBar: !maskNoteOf(plot, isGM),
            showState: reveal && !identity.masked,
            state: reveal && !identity.masked ? plot.state : null,
            stateMax: reveal && !identity.masked ? plot.stateMax : null,
            forces: forcesForPlot(board, plot)
                .map((f) => projectForceChip(f, isGM, maskLabel(EDIT_KIND.FORCE)))
                .filter(Boolean)
        };
    }

    #buildPlotDetail(board, plot, isGM) {
        const nodes = visibleRows(nodesForPlot(board, plot.id), isGM);
        return {
            ...this.#plotHeader(board, plot, isGM),
            description: projectIdentity(plot, isGM, maskLabel(EDIT_KIND.PLOT)).description,
            groups: this.#buildGroups(board, plot, isGM),
            threads: nodes.map((node) => this.#buildThread(board, plot, node, isGM)),
            threadCount: nodes.length,
            tray: this.#buildTray(board, plot, isGM)
        };
    }

    /**
     * The roster, printed under whatever headings the GM has arranged it in.
     *
     * Groupings are cosmetic and nothing reads them to decide anything — but which
     * side a Force is on is the first question anyone asks about a war, and a flat
     * row of six names does not answer it. Order follows the roster, so a grouping
     * appears where its first member does, and the Forces the GM never grouped
     * come last: "everyone else" is not an arrangement, so it gets no heading of
     * its own unless there is at least one real one to distinguish it from.
     */
    #buildGroups(board, plot, isGM) {
        const order = [];
        const byLabel = new Map();

        for (const force of forcesForPlot(board, plot)) {
            const chip = projectForceChip(force, isGM, maskLabel(EDIT_KIND.FORCE));
            if (!chip) continue;                        // hidden: not even a count
            const label = plot.forceGroups?.[force.id] ?? '';
            if (!byLabel.has(label)) {
                byLabel.set(label, []);
                order.push(label);
            }
            byLabel.get(label).push(chip);
        }

        // Stable sort, so this only moves the unlabelled bucket to the end.
        const labelled = order.filter((l) => l !== '').length;
        return order
            .sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0))
            .map((label) => ({
                label,
                hasLabel: label !== '',
                // Only worth calling out as "the rest" when something else is named.
                isRemainder: label === '' && labelled > 0,
                forces: byLabel.get(label)
            }));
    }

    /**
     * The chronicle: what has happened, as the viewer is allowed to know it.
     *
     * Five rules, in order:
     *   - An entry the GM marked HIDDEN never reaches a player's context at all,
     *     note included. It is a development the table is not having.
     *   - An entry the GM marked MASKED, and an entry that was SEALED when it was
     *     written, survive only as their note. So does one naming something the
     *     viewer may not know exists. The note is fiction the GM wrote FOR the
     *     table, so it is not withheld with the row it happens to hang off; but
     *     nothing around it may hint at what moved. With no note, the entry is
     *     dropped entirely rather than rendered as a blank.
     *   - The seal is why revealing a Force does not hand the table its history.
     *     A line written while anything it named was withheld stays a note, and
     *     the fact that the row is public NOW does not reopen it. Reveal is a
     *     decision about the present.
     *   - A masked row keeps its "???" here exactly as it does everywhere else.
     *   - Amounts follow the Thread's own hideValues, and what a push COST is GM
     *     bookkeeping and never reaches a player's context at all.
     *
     * The GM reads everything, and gets a chip on any line the table reads less of
     * than they do — otherwise the one screen that says what the table knows would
     * be the one screen that does not say it.
     */
    #buildLog(board, isGM) {
        const mask = {
            plot: maskLabel(EDIT_KIND.PLOT), node: maskLabel(EDIT_KIND.NODE),
            force: maskLabel(EDIT_KIND.FORCE), asset: maskLabel(EDIT_KIND.ASSET)
        };
        const nodeById = new Map(board.nodes.map((n) => [n.id, n]));
        const assetById = new Map(board.assets.map((a) => [a.id, a]));

        return readLog(board, LOG_ROWS)
            .map((e) => {
                const plot = e.plotId ? plotById(board, e.plotId) : null;
                const node = e.nodeId ? nodeById.get(e.nodeId) ?? null : null;
                const force = e.forceId ? forceById(board, e.forceId) : null;
                const asset = e.assetId ? assetById.get(e.assetId) ?? null : null;

                // Marked unreadable by the GM as it was written. Dropped before
                // anything else is computed, so nothing about it is built into a
                // player's context in the first place.
                if (!isGM && e.visibility === VISIBILITY.HIDDEN) return null;

                const row = {
                    id: e.id,
                    kind: e.kind,
                    icon: LOG_ICONS[e.kind] ?? LOG_ICONS[LOG_KIND.PUSH],
                    when: game.i18n.format('RSR.log.when', { turn: e.turn }),
                    note: e.note,
                    // What the table reads of this line, told to the GM alone.
                    // Absent when it is the same as what the GM reads.
                    seen: isGM && (e.visibility !== VISIBILITY.VISIBLE || e.sealed)
                        ? (e.sealed && e.visibility === VISIBILITY.VISIBLE
                            ? 'RSR.log.sealedChip'
                            : `RSR.visibility.${e.visibility}`)
                        : null,
                    // A spend is negative and a windfall positive; both are the
                    // GM's books, and a player's context carries neither.
                    cost: isGM && e.cost !== 0 ? e.cost : null,
                    isExample: e.isExample
                };

                // A reference that no longer resolves: the GM deleted the Thread,
                // Force or Asset this line was about. Deletes deliberately do not
                // sweep the chronicle — an account of a campaign that edits itself
                // when something is removed is not an account — so the line is
                // treated exactly like a withheld one and keeps only its note.
                const dangling = [
                    [e.plotId, plot], [e.nodeId, node],
                    [e.forceId, force], [e.assetId, asset]
                ].some(([id, entity]) => !!id && !entity);

                // Three ways to lose the sentence and keep the note: the GM said
                // so, the rows were secret when it was written, or one of them is
                // secret now.
                const withheld = dangling
                    || (!isGM && (e.sealed || e.visibility === VISIBILITY.MASKED))
                    || [plot, node, force, asset]
                        .some((entity) => entity && isHidden(entity, isGM));
                if (withheld) {
                    if (!e.note) return null;
                    return { ...row, icon: 'fa-solid fa-feather', text: '', masked: true };
                }

                const text = this.#logSentence(e, { board, plot, node, force, asset, isGM, mask });
                if (!text && !e.note) return null;
                return { ...row, text, masked: false };
            })
            .filter(Boolean);
    }

    /**
     * One entry as a sentence, built here rather than stored, because the names in
     * it depend on who is reading and on what is secret at the moment of reading —
     * neither of which was known when the entry was written.
     */
    #logSentence(e, { board, plot, node, force, asset, isGM, mask }) {
        const F = (key, data) => game.i18n.format(key, data);
        // One line can name a Plot, a Thread, a Force and an Asset, and each is
        // masked as its own kind of thing.
        const name = (entity, kind) => projectIdentity(entity, isGM, mask[kind]).name;

        const thread = node ? name(node, 'node') : '';
        const who = force ? name(force, 'force') : '';
        const where = plot ? name(plot, 'plot') : '';

        switch (e.kind) {
            case LOG_KIND.PUSH: {
                // The number is the Thread's own, so it follows the Thread's own
                // rule about whether its numbers are public. A push of zero moved
                // nothing and happened for its note alone; "by +0" is not a fact
                // anyone wants read out.
                const values = node
                    ? e.amount !== 0 && showValues(node, isGM) && !isMasked(node, isGM)
                    : false;
                const amount = e.amount > 0 ? `+${e.amount}` : String(e.amount);
                if (who) {
                    return values
                        ? F('RSR.log.push', { force: who, thread, amount })
                        : F('RSR.log.pushQuiet', { force: who, thread });
                }
                return values
                    ? F('RSR.log.pushWorld', { thread, amount })
                    : F('RSR.log.pushWorldQuiet', { thread });
            }
            case LOG_KIND.CONCLUDE:
                return who
                    ? F('RSR.log.conclude', { force: who, thread })
                    : F('RSR.log.concludeWorld', { thread });
            case LOG_KIND.REOPEN:
                return F('RSR.log.reopen', { thread });
            case LOG_KIND.COMMIT:
                return thread
                    ? F('RSR.log.commit', { force: who, asset: name(asset, 'asset'), thread })
                    : F('RSR.log.commitPlot', { force: who, asset: name(asset, 'asset'), plot: where });
            case LOG_KIND.RELEASE:
                return F('RSR.log.release', { force: who, asset: name(asset, 'asset') });
            case LOG_KIND.CONDITION:
                // The condition is stored as its id and named here, like every
                // other name in this file, so the line reads in the reader's
                // language rather than the language it was written in. A condition
                // the GM has since deleted resolves to the fallback rather than
                // rendering a raw id at the table.
                return F('RSR.log.condition', {
                    force: who,
                    asset: name(asset, 'asset'),
                    condition: game.i18n.localize(
                        Cond.labelOf(Cond.rowFor(board.conditions, e.condition))
                    )
                });
            case LOG_KIND.CYCLE:
                return F('RSR.log.cycle', { turn: e.turn });
            default:
                return '';
        }
    }

    /**
     * The hand: every uncommitted Asset belonging to a Force on this Plot, sitting
     * on the same screen as the Threads it can be dropped onto.
     *
     * This exists because the Cockpit was the wrong home for it. An Asset had to be
     * dragged from a Force panel onto a Thread that was two segments away, and a
     * drag does not survive changing views — so the feature was unreachable in
     * practice. Drag source and drop target now render together.
     */
    #buildTray(board, plot, isGM) {
        if (!isGM) return [];
        return forcesForPlot(board, plot)
            .map((force) => ({
                id: force.id,
                name: force.name,
                icon: force.icon || CONSTANT_DEFAULTS.forceIcon,
                resources: force.resources,
                assets: uncommittedAssets(board.assets, force.id).map((asset) => ({
                    id: asset.id,
                    name: asset.name,
                    hasModifier: asset.modifier.value !== 0,
                    modifierLabel: `RSR.asset.modifier.${asset.modifier.kind}`,
                    modifierValue: asset.modifier.value,
                    ...this.#conditionOf(asset),
                    isHiddenFromPlayers: asset.visibility === VISIBILITY.HIDDEN
                }))
            }))
            .filter((row) => row.assets.length > 0);
    }

    /**
     * One Thread row. The mode decides which bar shape renders, so the branch is
     * resolved here and the template just picks the block that is truthy.
     */
    #buildThread(board, plot, node, isGM) {
        const identity = projectIdentity(node, isGM, maskLabel(EDIT_KIND.NODE));
        const mode = resolveMode(node, plot);
        // What the mode is, and whether this viewer may know it. They are two
        // different questions: the numbers below still come from the real mode —
        // a clock counts its segments however little the table is told — while
        // `shown` decides both the chip and the shape, and is null under a mask.
        const shown = projectMode(node, isGM, mode);
        const concluded = node.status === NODE_STATUS.CONCLUDED;
        const locked = node.status === NODE_STATUS.LOCKED;
        const assets = assetsForNode(board, node.id);

        // Assets committed to this Thread change what it costs, so the bar and the
        // GM's controls both work against the effective number, not the raw one.
        const threshold = effectiveThreshold(node, assets);

        const row = {
            id: node.id,
            ...identity,
            isExample: node.isExample,
            mode: shown,
            modeLabel: shown ? `RSR.thread.mode.${shown}` : null,
            inheritsMode: node.mode === null,
            status: node.status,
            statusLabel: `RSR.thread.status.${node.status}`,
            isConcluded: concluded,
            isLocked: locked,
            isContested: false,
            isClock: false,
            isPool: false,
            // GM affordances. A locked Thread is still advanceable — locking is about
            // what the fiction allows, and the GM is the one deciding that.
            canPush: isGM && !concluded,
            canConclude: isGM && !concluded,
            canReopen: isGM && concluded,
            isFull: isFull(node, plot, assets),
            discounted: isGM && threshold !== node.threshold ? node.threshold : null
        };

        // Committed Assets belong to the ROW, not to one bar shape: an Asset can be
        // committed to a clock or a contested Thread exactly as easily as to a pool.
        // The condition is told to everyone who can see the Asset at all, and
        // withheld from a masked one: "??? (Destroyed)" says more about a row the
        // table is not supposed to know than the mask was withholding.
        row.committedAssets = visibleRows(assets, isGM).map((asset) => {
            const masked = isMasked(asset, isGM);
            return {
                id: asset.id,
                name: projectIdentity(asset, isGM, maskLabel(EDIT_KIND.ASSET)).name,
                canRelease: isGM,
                ...(masked ? { isReady: true } : this.#conditionOf(asset))
            };
        });

        // Prerequisites are named only when the viewer may see the prerequisite too;
        // otherwise a locked Thread would leak the name of a hidden one.
        const prereqs = node.prereqNodeIds
            .map((id) => board.nodes.find((n) => n.id === id))
            .filter(Boolean);
        row.prereqNames = visibleRows(prereqs, isGM)
            .map((n) => projectIdentity(n, isGM, maskLabel(EDIT_KIND.NODE)).name);
        row.hasUnseenPrereqs = prereqs.length > row.prereqNames.length;

        if (concluded) {
            const winner = node.concludedBy ? forceById(board, node.concludedBy) : null;
            const chip = winner ? projectForceChip(winner, isGM, maskLabel(EDIT_KIND.FORCE)) : null;
            row.concludedBy = chip;
            const outcome = node.outcomes.find((o) => o.forceId === node.concludedBy);
            // The delta is bookkeeping; the note is fiction. Players get the fiction.
            row.outcomeNote = outcome?.note ?? '';
            row.outcomeDelta = isGM ? (outcome?.delta ?? null) : null;
            return row;
        }

        // A rumour instead of a reading. Set on a masked Thread, it takes the
        // place of every bar shape below — including the contested standings,
        // which are the most precise reading on the board and would otherwise
        // survive the one setting meant to withhold precision.
        row.maskNote = maskNoteOf(node, isGM);
        if (row.maskNote) return row;

        if (shown === MODE.CONTESTED) {
            row.isContested = true;
            row.contenders = (plot.forceIds ?? [])
                .map((id) => forceById(board, id))
                .filter(Boolean)
                .map((force) => {
                    const chip = projectForceChip(force, isGM, maskLabel(EDIT_KIND.FORCE));
                    if (!chip) return null;
                    return {
                        ...chip,
                        // A contested side gets its own push control, which only
                        // preselects it in the dialog. The purse is not printed
                        // here: the dialog names it beside the Force, which is
                        // where the number is actually about to be spent.
                        canPush: row.canPush && !!chip.id,
                        ...projectProgress({
                            current: node.progress.byForce[force.id] ?? 0,
                            total: threshold, isGM, entity: node
                        })
                    };
                })
                .filter(Boolean);
            return row;
        }

        if (shown === MODE.CLOCK) {
            row.isClock = true;
            // The pips are the count, drawn as dots, so they are withheld with
            // it: projectClock returns them only when the numbers are readable,
            // and the row falls back to a plain bar when they are not.
            row.clock = projectClock({
                current: node.progress.pool, total: node.segments, isGM, entity: node
            });
            row.pips = row.clock.pips;
            return row;
        }

        // invest and fiat both read as one pool against a threshold. fiat simply
        // has nothing pushing it, which reads correctly as an empty bar. A masked
        // Thread of ANY mode lands here too, which is the point of the fallback:
        // one plain bar says something is moving without saying what kind of
        // thing it is. Its numbers are still its own, so they come from the real
        // mode — a contest reads as its leading side, because that is how far
        // along the situation actually is, and summing the sides would both read
        // past the threshold and admit there is more than one of them.
        row.isPool = true;
        row.pool = projectProgress({
            current: mode === MODE.CONTESTED
                ? Math.max(0, ...Object.values(node.progress.byForce ?? {}))
                : node.progress.pool,
            total: mode === MODE.CLOCK ? node.segments : threshold,
            isGM, entity: node
        });
        return row;
    }

    /**
     * The GM's Cockpit: every Force, its purse, its standing tags, and the Assets
     * it has to play.
     *
     * No visibility projection happens here and none should — this view exists
     * precisely to show the GM everything, including what the table cannot see.
     * What it does show is what each row LOOKS like to the table, as a chip, so
     * the GM can tell at a glance that the dragon is still a secret.
     */
    #buildCockpit(board) {
        const engaged = engagedForceIds(board.plots);
        const roster = turnPreview(board);
        const byId = new Map(roster.map((row) => [row.forceId, row]));

        return {
            turn: board.turn.count,
            nextTurn: board.turn.count + 1,
            payingCount: roster.filter((row) => row.willBePaid).length,
            // The footnote. Every Force and what the next cycle does to it —
            // INCLUDING the ones it does nothing to, which are the rows a GM is
            // actually trying to find when a cycle seems not to have worked.
            roster: roster.map((row) => ({
                ...row,
                reason: this.#incomeReason(row)
            })),
            forces: allForces(board).map((force) => ({
                id: force.id,
                name: force.name,
                img: force.img,
                icon: force.icon || CONSTANT_DEFAULTS.forceIcon,
                resources: force.resources,
                income: force.income,
                hasIncome: force.income !== 0,
                isActive: force.isActive,
                // Engagement no longer decides income — it is shown because knowing
                // where a Force stands is useful, not because it changes the maths.
                isEngaged: engaged.has(force.id),
                willBePaid: byId.get(force.id)?.willBePaid ?? false,
                ...this.#tagColumns(force.tags),
                ...this.#audience(force),
                plots: plotsForForce(board, force.id).map((plot) => ({
                    id: plot.id,
                    name: plot.name,
                    isActive: plot.lifecycle === LIFECYCLE.ACTIVE,
                    lifecycleLabel: `RSR.plot.lifecycle.${plot.lifecycle}`
                })),
                // Held and lost are two lists, not one sorted list. A Force with
                // four wrecks at the bottom of its panel reads as a Force with
                // four Assets until you get to the badges.
                assets: assetsForForce(board, force.id)
                    .filter((asset) => !Cond.isFinal(asset))
                    .map((asset) => this.#buildAsset(board, asset)),
                lost: assetsForForce(board, force.id)
                    .filter((asset) => Cond.isFinal(asset))
                    .map((asset) => this.#buildAsset(board, asset))
            }))
        };
    }

    /** Why a Force is getting what it is getting, in the GM's words rather than a flag. */
    #incomeReason(row) {
        if (!row.isActive) return 'RSR.turn.reasonPaused';
        if (row.income === 0) return 'RSR.turn.reasonNoIncome';
        if (row.paid !== row.income) return 'RSR.turn.reasonFloor';
        return '';
    }

    /**
     * The Settings segment: the numbers a GM sets once for a campaign instead of
     * retyping into every editor. Every field here seeds a NEW row — changing one
     * never reaches back and rewrites anything already on the board.
     */
    #buildSettings(board) {
        const K = board.constants;
        return {
            constants: K,
            defaults: CONSTANT_DEFAULTS,
            // One default per KIND of row. A single setting for all four was a
            // false economy: a GM wants the sides named from the start and the
            // Threads they are running kept quiet, and having to correct every
            // new Force by hand taught them to stop looking at the field at all.
            visibilityKinds: VISIBILITY_KINDS.map((kind) => ({
                kind,
                label: `RSR.settings.visibility.${kind}`,
                options: Object.values(VISIBILITY).map((value) => ({
                    value,
                    label: `RSR.visibility.${value}`,
                    selected: value === K.defaultVisibility[kind]
                }))
            }))
        };
    }

    /** Strengths and weaknesses as two lists, because they render as two columns. */
    #tagColumns(tags) {
        return {
            strengths: (tags ?? []).filter((t) => t.polarity === POLARITY.STRENGTH).map((t) => t.text),
            weaknesses: (tags ?? []).filter((t) => t.polarity === POLARITY.WEAKNESS).map((t) => t.text)
        };
    }

    /** What the table sees of this row, shown to the GM as a chip on their own copy. */
    #audience(entity) {
        return {
            isMaskedFromPlayers: entity.visibility === VISIBILITY.MASKED,
            isHiddenFromPlayers: entity.visibility === VISIBILITY.HIDDEN,
            visibilityLabel: `RSR.visibility.${entity.visibility}`,
            hidesValues: entity.hideValues
        };
    }

    /**
     * How an Asset's condition reads, wherever one is drawn.
     *
     * Built once and spread into the Cockpit chip, the tray and a Thread's
     * committed chips, so the three cannot drift into three different answers to
     * the same question. READY says nothing at all: a board that badges every row
     * with "Ready" has spent its reader's attention on the default case.
     */
    #conditionOf(asset) {
        const rule = Cond.ruleFor(asset);
        const value = asset?.modifier?.value ?? 0;
        const worth = Cond.effectiveValue(asset, value);
        return {
            condition: rule.id,
            // The default says nothing. A board that badges every row "Ready" has
            // spent its reader's attention on the case where nothing happened.
            isReady: Cond.isDefault(asset),
            conditionLabel: Cond.labelOf(rule),
            isFinal: Cond.isFinal(asset),
            // Cycles left, and what it turns into. A number with no consequence
            // attached is not worth printing, so both travel together.
            cyclesLeft: asset?.conditionCycles ?? 0,
            // Drawn THROUGH the modifier line rather than replacing it: which
            // benefit has been scaled down is the thing the GM is looking for.
            modifierOff: worth !== value,
            modifierWorth: worth
        };
    }

    #buildAsset(board, asset) {
        const node = asset.nodeId ? board.nodes.find((n) => n.id === asset.nodeId) ?? null : null;
        const plot = asset.plotId ? plotById(board, asset.plotId) : null;

        return {
            id: asset.id,
            name: asset.name,
            img: asset.img,
            hasLink: !!asset.uuid,
            uuid: asset.uuid,
            ...this.#tagColumns(asset.tags),
            ...this.#audience(asset),
            hasModifier: asset.modifier.value !== 0,
            modifierLabel: `RSR.asset.modifier.${asset.modifier.kind}`,
            modifierValue: asset.modifier.value,
            ...this.#conditionOf(asset),
            // A Thread names its Plot too, so the GM never has to hold the join in
            // their head to know where a committed Asset actually is.
            committedTo: node ? `${plot?.name ?? ''} — ${node.name}` : (plot?.name ?? null),
            isCommitted: !!(node || plot)
        };
    }

    // ── drag and drop ────────────────────────────────────────────────────────

    /**
     * ApplicationV2 has no `dragDrop` option, so the controller is built by hand and
     * re-bound on every render — the elements it attached to last time no longer
     * exist. There is no dropSelector: the binding is window-wide, and #onDrop works
     * out what was hit by walking up from event.target rather than by trusting which
     * listener caught it.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        // v1 keeps the player write path closed, so only a GM moves Assets around
        // — and a GM previewing the table's board is not one of them, or the
        // preview would be a screenshot with live controls behind it.
        if (!this.#viewer()) return;

        new foundry.applications.ux.DragDrop.implementation({
            // Buttons inside a chip carry the same id so their handlers can read it;
            // excluding them keeps a click on Delete from arming a drag.
            dragSelector: '[data-asset-id]:not(button)',
            callbacks: {
                dragstart: this.#onDragStart.bind(this),
                drop: this.#onDrop.bind(this)
            }
        }).bind(this.element);

        // The Plot editor's roster: same controller shape, its own payload type.
        // One binding per source rather than one per target, because the drop
        // handler works out what was hit by walking up from event.target anyway.
        if (this.#edit?.kind === EDIT_KIND.PLOT) {
            new foundry.applications.ux.DragDrop.implementation({
                dragSelector: '[data-roster-force]:not(button)',
                callbacks: {
                    dragstart: this.#onRosterDragStart.bind(this),
                    drop: this.#onDrop.bind(this)
                }
            }).bind(this.element);
        }
    }

    #onRosterDragStart(event) {
        const forceId = event.currentTarget?.dataset?.rosterForce;
        if (!forceId) return;
        event.dataTransfer.setData('text/plain', JSON.stringify({ type: ROSTER_DRAG, forceId }));
        event.dataTransfer.effectAllowed = 'move';
    }

    /**
     * A Force chip dropped inside the roster editor. The column it lands in
     * carries the heading; dropping outside every column takes it off the Plot,
     * which is the same gesture as dragging a committed Asset back to its Force.
     */
    #dropRosterForce(forceId, target) {
        const column = target.closest('[data-group]');
        if (column) {
            return this.#mutate((draft) =>
                Edit.setForceGroup(draft, forceId, column.dataset.group ?? ''));
        }
        // Taking a Force off the Plot only counts inside the roster itself. The
        // drop listener covers the whole window, and a chip fumbled onto a Phase
        // card should do nothing rather than quietly delete a side.
        if (!target.closest('[data-roster-board]')) return undefined;
        return this.#mutate((draft) => Edit.removeForceFromPlot(draft, forceId));
    }

    #onDragStart(event) {
        const assetId = event.currentTarget?.dataset?.assetId;
        if (!assetId) return;
        event.dataTransfer.setData('text/plain', JSON.stringify({ type: ASSET_DRAG, assetId }));
        event.dataTransfer.effectAllowed = 'move';
    }

    async #onDrop(event) {
        // Exactly what TextEditor.getDragEventData does, without the dependency.
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
            return;                                     // not ours, and not a document
        }
        if (!data || typeof data !== 'object') return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return;

        if (data.type === ROSTER_DRAG) return this.#dropRosterForce(data.forceId, target);
        if (data.type === ASSET_DRAG) return this.#dropAsset(data.assetId, target);
        if (typeof data.uuid === 'string') return this.#dropDocument(data.uuid, target);
    }

    /**
     * One of ours. Onto a Thread commits it there, onto a Plot commits it to the
     * Plot, and onto a Force panel takes it back into that Force's hand. Innermost
     * target wins, which is what makes a Plot chip inside a panel work.
     */
    async #dropAsset(assetId, target) {
        const { commitAsset, releaseAsset } = await import('../data/state.mjs');

        const thread = target.closest('[data-thread-id]');
        if (thread) return commitAsset(assetId, { nodeId: thread.dataset.threadId });

        const plot = target.closest('[data-plot-id]');
        if (plot) return commitAsset(assetId, { plotId: plot.dataset.plotId });

        if (target.closest('[data-force-id]')) return releaseAsset(assetId);
    }

    /**
     * A Foundry document. Onto an Asset it becomes that Asset's link; onto a Force
     * panel it becomes a new Asset named after the document — which is the fastest
     * way there is to turn an Actor the party just met into a Force's holding.
     */
    async #dropDocument(uuid, target) {
        const chip = target.closest('[data-asset-id]');
        if (chip) {
            const { linkAssetDocument } = await import('./editors.mjs');
            return linkAssetDocument(chip.dataset.assetId, uuid);
        }

        const panel = target.closest('[data-force-id]');
        if (!panel) return;
        const { createAssetFromDocument } = await import('./editors.mjs');
        return createAssetFromDocument(panel.dataset.forceId, uuid);
    }

    // ── actions ──────────────────────────────────────────────────────────────

    static async _onSelectView(event, target) {
        if (!await this.#leaveEditor()) return;
        this.setView(target.dataset.view);
    }

    static async _onTogglePreview() {
        await this.togglePreview();
    }

    static async _onOpenPlot(event, target) {
        if (!await this.#leaveEditor()) return;
        this.#plotId = target.dataset.plotId ?? null;
        this.render();
    }

    static async _onClosePlot() {
        if (!await this.#leaveEditor()) return;
        this.#plotId = null;
        this.render();
    }

    static _onCreatePlot() {
        this.#openEditor(EDIT_KIND.PLOT, null);
    }

    static _onEditPlot(event, target) {
        this.#openEditor(EDIT_KIND.PLOT, target.dataset.plotId);
    }

    static async _onRemovePlot(event, target) {
        const { confirmDeletePlot } = await import('./editors.mjs');
        const removed = await confirmDeletePlot(target.dataset.plotId);
        if (removed && this.#plotId === target.dataset.plotId) this.#plotId = null;
    }

    static _onCreateThread() {
        if (!this.#plotId) return;
        this.#openEditor(EDIT_KIND.NODE, null, { plotId: this.#plotId });
    }

    static _onEditThread(event, target) {
        this.#openEditor(EDIT_KIND.NODE, target.dataset.threadId);
    }

    static async _onRemoveThread(event, target) {
        const { confirmDeleteThread } = await import('./editors.mjs');
        await confirmDeleteThread(target.dataset.threadId);
    }

    /**
     * Every push goes through the same dialog, whatever the Thread's mode. A Force
     * may ride on the button when the control sits inside a contender's row, which
     * only preselects it — the dialog still asks.
     */
    static async _onPushThread(event, target) {
        const { promptPush } = await import('./editors.mjs');
        await promptPush(target.dataset.threadId, { forceId: target.dataset.forceId || null });
    }

    static async _onClearLog() {
        const { confirmClearLog } = await import('./editors.mjs');
        await confirmClearLog();
    }

    static async _onConcludeThread(event, target) {
        const { promptConclude } = await import('./editors.mjs');
        await promptConclude(target.dataset.threadId);
    }

    static async _onReopenThread(event, target) {
        const { reopenNode } = await import('../data/state.mjs');
        await reopenNode(target.dataset.threadId);
    }

    static _onCreateForce() {
        this.#openEditor(EDIT_KIND.FORCE, null);
    }

    static _onEditForce(event, target) {
        this.#openEditor(EDIT_KIND.FORCE, target.dataset.forceId);
    }

    static async _onRemoveForce(event, target) {
        const { confirmDeleteForce } = await import('./editors.mjs');
        await confirmDeleteForce(target.dataset.forceId);
    }

    static async _onAdjustResources(event, target) {
        const { promptAdjustResources } = await import('./editors.mjs');
        await promptAdjustResources(target.dataset.forceId);
    }

    /** The ±1 on the panel. The dialog behind adjustResources covers everything else. */
    static async _onNudgeResources(event, target) {
        const { adjustForceResources } = await import('../data/state.mjs');
        await adjustForceResources(target.dataset.forceId, Number(target.dataset.delta) || 0);
    }

    static _onCreateAsset(event, target) {
        this.#openEditor(EDIT_KIND.ASSET, null, { forceId: target.dataset.forceId });
    }

    /**
     * The one editor that can be opened from inside another: a Force's Asset chips
     * link straight to it, so the leave guard has to run first or an unsaved Force
     * draft would vanish on the way.
     */
    static async _onEditAsset(event, target) {
        const assetId = target.dataset.assetId;
        if (!await this.#leaveEditor()) return;
        this.#openEditor(EDIT_KIND.ASSET, assetId);
    }

    /**
     * Put an Asset into a condition.
     *
     * A dialog rather than a field on the editor: it happens mid-session, it wants
     * a sentence about why, and who hears about it is the GM's call each time.
     */
    static async _onSetAssetCondition(event, target) {
        const { promptCondition } = await import('./editors.mjs');
        await promptCondition(target.dataset.assetId);
    }

    /** The GM's condition table, edited on the board like everything else. */
    static _onEditConditions() {
        this.#openEditor(EDIT_KIND.CONDITIONS, null);
    }

    static async _onRemoveAsset(event, target) {
        const { confirmDeleteAsset } = await import('./editors.mjs');
        await confirmDeleteAsset(target.dataset.assetId);
    }

    static async _onReleaseAsset(event, target) {
        const { releaseAsset } = await import('../data/state.mjs');
        await releaseAsset(target.dataset.assetId);
    }

    // ── editor actions ───────────────────────────────────────────────────────

    /**
     * Write the draft to the world.
     *
     * A new row is given its id HERE rather than by state.mjs, so that saving
     * twice updates one row instead of creating two — the editor stays open after
     * a save, which is the whole point of a Save bar.
     */
    static async _onSaveEdit() {
        if (!this.#edit) return;
        const edit = this.#edit;
        edit.draft = harvest(edit.kind, this.#form(), edit.draft);

        // The condition table is a list, not a row, so it saves a list. Deleted
        // rows are resolved first, because a table saved while Assets point at a
        // condition that is gone is a table that cannot be read back.
        if (edit.kind === EDIT_KIND.CONDITIONS) {
            await this.#saveConditions(edit);
            return;
        }

        // Named explicitly rather than assembled from the problem: a key built by
        // concatenation is invisible to the static pass that checks they exist.
        const PROBLEM_KEYS = {
            name: 'RSR.notify.nameRequired',
            stateRange: 'RSR.notify.stateRangeRequired',
            forceId: 'RSR.notify.ownerRequired'
        };
        const problems = Edit.problems(edit.kind, edit.draft);
        if (problems.length) {
            ui.notifications?.warn(game.i18n.localize(PROBLEM_KEYS[problems[0]]));
            return;
        }

        const id = edit.id ?? foundry.utils.randomID();
        const patch = { id, ...Edit.patchFrom(edit.kind, edit.draft) };

        const state = await import('../data/state.mjs');
        if (edit.kind === EDIT_KIND.PLOT) await state.upsertPlot(patch);
        else if (edit.kind === EDIT_KIND.NODE) await state.upsertNode(patch);
        else if (edit.kind === EDIT_KIND.FORCE) await state.upsertForce(patch);
        else {
            // Developing an Asset costs the world's price, charged on creation
            // only. state.mjs refuses an unaffordable one silently, so the reason
            // is given here while there is still a screen to give it on.
            const board = readBoard();
            const cost = edit.id ? 0 : board.constants.assetCost;
            const owner = forceById(board, edit.draft.forceId);
            if (cost > 0 && (owner?.resources ?? 0) < cost) {
                ui.notifications?.warn(game.i18n.format('RSR.notify.assetUnaffordable', {
                    name: owner?.name ?? '', cost, resources: owner?.resources ?? 0
                }));
                return;
            }
            await state.upsertAsset(patch);
        }

        edit.id = id;
        edit.snapshot = foundry.utils.deepClone(edit.draft);
        ui.notifications?.info(game.i18n.localize('RSR.editor.saved'));
        this.render();
    }

    /**
     * Save the condition table, resolving anything the GM deleted.
     *
     * An Asset standing in a deleted condition would resolve to the fallback at
     * read time and quietly become Ready, which is a silent repair of something
     * the GM never said to repair. So they are asked, per Asset, what each one
     * becomes — and the table and the Assets are written in one operation, so the
     * two can never disagree.
     */
    async #saveConditions(edit) {
        const rows = Edit.conditionRows(edit.draft);
        const dropped = Edit.droppedConditions(edit.snapshot, edit.draft);
        const board = readBoard();
        const stranded = board.assets.filter((a) => dropped.includes(a.condition));

        let moves = {};
        if (stranded.length) {
            const { promptRehome } = await import('./editors.mjs');
            moves = await promptRehome(stranded, rows);
            // Cancelled: nothing is written, and the table on screen is untouched
            // so the GM can put the row back if that is what they meant.
            if (!moves) return;
        }

        const { setConditions } = await import('../data/state.mjs');
        await setConditions(rows, moves);
        edit.snapshot = foundry.utils.deepClone(edit.draft);
        ui.notifications?.info(game.i18n.localize('RSR.editor.saved'));
        this.render();
    }

    static _onAddCondition() {
        // Minted here rather than in the pure layer, which has no randomID.
        this.#mutate((draft) => Edit.addCondition(draft, foundry.utils.randomID()));
    }

    static _onRemoveCondition(event, target) {
        const id = target.dataset.conditionId;
        this.#mutate((draft) => Edit.removeCondition(draft, id));
    }

    static _onRestoreConditions() {
        this.#mutate((draft) => Edit.restoreConditionDefaults(draft));
    }

    /** Back to how the row looked when this editor opened. */
    static _onRevertEdit() {
        if (!this.#edit) return;
        this.#edit.draft = foundry.utils.deepClone(this.#edit.snapshot);
        this.render();
    }

    static async _onCloseEdit() {
        await this.#leaveEditor();
    }

    static _onAddPhase() {
        this.#mutate((draft) => Edit.addPhase(draft));
    }

    static _onRemovePhase(event, target) {
        const index = Number(target.dataset.index);
        this.#mutate((draft) => Edit.removePhase(draft, index));
    }

    /** The text comes from the add-a-tag box, which is cleared once it is taken. */
    static _onAddTag(event, target) {
        const polarity = target.dataset.polarity === POLARITY.WEAKNESS
            ? POLARITY.WEAKNESS : POLARITY.STRENGTH;
        this.#mutate((draft, form) => {
            const field = `new-tag-${polarity}`;
            const text = readField(form, field);
            clearField(form, field);
            return Edit.addTag(draft, polarity, text);
        });
    }

    static _onRemoveTag(event, target) {
        const { polarity, index } = target.dataset;
        this.#mutate((draft) => Edit.removeTag(draft, polarity, Number(index)));
    }

    static _onAddPrereq() {
        this.#mutate((draft, form) => {
            const id = readField(form, 'pick-prereq');
            return id ? Edit.addPrereq(draft, id) : draft;
        });
    }

    static _onRemovePrereq(event, target) {
        this.#mutate((draft) => Edit.removePrereq(draft, target.dataset.threadId));
    }

    static _onAddRosterForce() {
        this.#mutate((draft, form) => {
            const id = readField(form, 'pick-force');
            if (!id) return draft;
            return Edit.addForceToPlot(draft, id, readField(form, 'pick-group'));
        });
    }

    static _onRemoveRosterForce(event, target) {
        this.#mutate((draft) => Edit.removeForceFromPlot(draft, target.dataset.forceId));
    }

    static _onAddGroup() {
        this.#mutate((draft, form) => {
            const label = readField(form, 'new-group');
            clearField(form, 'new-group');
            return Edit.addGroup(draft, label);
        });
    }

    static _onRemoveGroup(event, target) {
        this.#mutate((draft) => Edit.removeGroup(draft, target.dataset.group));
    }

    /** Forget the document an Asset points at. The Asset keeps its own name and image. */
    static _onClearAssetLink() {
        this.#mutate((draft) => ({ ...draft, uuid: null }));
    }

    static async _onToggleForceActive(event, target) {
        const { setForceActive } = await import('../data/state.mjs');
        await setForceActive(target.dataset.forceId, target.dataset.active === 'true');
    }

    /**
     * The Settings segment is a plain form inside the board rather than a dialog,
     * so its values are read off the nearest form element instead of a callback.
     */
    static async _onSaveSettings(event, target) {
        const form = target.closest('form');
        if (!form) return;
        const int = (name, fallback) => {
            const n = Number(form.elements[name]?.value);
            return Number.isFinite(n) ? Math.trunc(n) : fallback;
        };

        // One select per kind of row, read by the same name the template gives it.
        const defaultVisibility = {};
        for (const kind of VISIBILITY_KINDS) {
            defaultVisibility[kind] = form.elements[`visibility-${kind}`]?.value
                ?? CONSTANT_DEFAULTS.defaultVisibility[kind];
        }

        const { setConstants } = await import('../data/state.mjs');
        await setConstants({
            forceResources: int('forceResources', CONSTANT_DEFAULTS.forceResources),
            forceIncome: int('forceIncome', CONSTANT_DEFAULTS.forceIncome),
            forceIcon: form.elements.forceIcon?.value ?? CONSTANT_DEFAULTS.forceIcon,
            assetCost: int('assetCost', CONSTANT_DEFAULTS.assetCost),
            threadThreshold: int('threadThreshold', CONSTANT_DEFAULTS.threadThreshold),
            clockSegments: int('clockSegments', CONSTANT_DEFAULTS.clockSegments),
            stateMin: int('stateMin', CONSTANT_DEFAULTS.stateMin),
            stateMax: int('stateMax', CONSTANT_DEFAULTS.stateMax),
            defaultVisibility
        });

        ui.notifications?.info(game.i18n.localize('RSR.settings.saved'));
    }

    static async _onResetSettings() {
        const { setConstants } = await import('../data/state.mjs');
        await setConstants({ ...CONSTANT_DEFAULTS });
        ui.notifications?.info(game.i18n.localize('RSR.settings.reset'));
    }

    static async _onAdvanceTurn() {
        const { confirmAdvanceTurn } = await import('./editors.mjs');
        await confirmAdvanceTurn();
    }

    static async _onGenerateExample() {
        const { generateExample } = await import('../data/state.mjs');
        await generateExample();
        ui.notifications?.info(game.i18n.localize('RSR.help.exampleCreated'));
    }

    static async _onClearExample() {
        const { confirmRemoveExample } = await import('./editors.mjs');
        await confirmRemoveExample();
    }
}

/** One board per client. Re-opening brings the existing window forward. */
let instance = null;

export function openBoard({ view } = {}) {
    if (!instance || instance.closed) instance = new SituationRoom();
    if (view) instance.setView(view);
    return instance.render(true);
}
