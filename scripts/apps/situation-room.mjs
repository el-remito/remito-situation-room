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
    CONCLUDED_BY_CONSEQUENCE, CONSTANT_DEFAULTS, EDIT_KIND, LIFECYCLE, LOG_KIND, MODE,
    NODE_STATUS, POLARITY, PREFIX, TEMPLATES, TRACK, VIEW, VISIBILITY, VISIBILITY_KINDS
} from '../constants.mjs';
import {
    readBoard, visiblePlots, plotById, nodesForPlot, forcesForPlot,
    assetsForNode, hasExample, forceById, allForces, assetsForForce,
    plotsForForce, turnPreview, readLog, gateFor
} from '../data/state.mjs';
import { resolvePhase, resolvePhaseForGM, statePercent } from '../logic/state-track.mjs';
import {
    resolveMode, effectiveThreshold, isFull, depletes, outcomeFor,
    hasConsequence, consequenceShared, consequenceIsPips, consequenceSize,
    consequenceOf, consequenceFull
} from '../logic/progress.mjs';
import { layout } from '../logic/graph-layout.mjs';
import { parseCustomColor, tagStyle } from '../logic/palette.mjs';
import { refusal, nextMark, hasMark } from '../logic/cycle.mjs';
import {
    worldClock, plotClock, cycleReading, runLabelAt, runName, expiryLabel
} from '../ui/clock.mjs';
import * as Expiry from '../logic/expiry.mjs';
import {
    engagedForceIds, uncommittedAssets, followsTurn, hasOwnTurn
} from '../logic/economy.mjs';
import * as Cond from '../logic/condition.mjs';
import {
    visibleRows, projectIdentity, projectProgress, projectClock, projectForceChip,
    projectTone, projectMode, projectCountdown, maskNoteOf, showValues, isHidden, isMasked
} from '../logic/visibility.mjs';
import * as Edit from '../logic/editing.mjs';
import { harvest, readField, clearField, editorContext } from './board-editor.mjs';
// The only import from the relay outside state.mjs: Show Players says something
// rather than writing something, and the socket has exactly one home.
import { announce } from '../data/relay.mjs';

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
const whileLooking = (actions, navigation = [
    'selectView', 'openPlot', 'closePlot', 'togglePreview', 'setPlotTab'
]) =>
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
    // Written in M6 and left off this list until the M7 read-through, which is
    // the only reason it was ever found: pass 2 of tools/check.mjs treated the
    // whole help namespace as one dynamic prefix, so three defined-and-never-
    // rendered keys looked exactly like the eight that were being rendered. The
    // pass now names each section, and it sits with Threads because a shut gate
    // is something a reader meets on a Thread row.
    { key: 'gating' },
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
    [LOG_KIND.CYCLE]: 'fa-solid fa-hourglass-end',
    [LOG_KIND.EXPIRE]: 'fa-solid fa-hourglass-half'
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

/**
 * What each editor is editing, for the toast that says a save landed.
 *
 * "Saved." on its own is the least useful thing a confirmation can say. A GM who
 * has been in and out of four editors wants to know WHICH row they just wrote,
 * and a toast that names it is also the one that catches the mistake — pressing
 * Save on the wrong screen looks identical to pressing it on the right one.
 */
const KIND_NOUNS = {
    [EDIT_KIND.PLOT]: 'RSR.plot.singular',
    [EDIT_KIND.NODE]: 'RSR.thread.singular',
    [EDIT_KIND.FORCE]: 'RSR.force.singular',
    [EDIT_KIND.ASSET]: 'RSR.asset.singular'
};

/**
 * One row's searchable text, lowercased and joined.
 *
 * Every caller passes strings that have ALREADY been projected for the viewer.
 * That is not a convention this function can enforce, so it is stated at both
 * ends: see #searchText and the line that builds a Thread row's own.
 */
const haystack = (...parts) => parts.filter(Boolean).join(' ').toLowerCase();

/**
 * Which stored query a search box shows, by the scope in its markup.
 *
 * Threads and Requirements are two readings of ONE list, so they read and write
 * one query: a name typed on either tab is still typed on the other, and
 * pressing a card on the diagram — which fills the box — leaves the list
 * filtered to the Thread that was pressed rather than filtered to nothing.
 *
 * The SCOPES stay separate because the two boxes hide different things. The list
 * hides rows that do not match; the diagram hides every chain that contains no
 * match, whole, because half a chain is a lie about what is blocking what.
 */
const SEARCH_QUERY = { plots: 'plots', threads: 'threads', graph: 'threads' };

/**
 * Everything that goes into a chronicle sentence, made safe to put there.
 *
 * The sentence is the one string this window hands to the template UNESCAPED,
 * because it carries the tags that colour the names in it. That is only sound
 * if every value substituted into it has been through here first — names,
 * mask labels, condition labels and a GM's own word for a clock are all typed
 * by somebody.
 */
const esc = (v) => foundry.utils.escapeHTML(String(v ?? ''));

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
            setPlotTab: SituationRoom._onSetPlotTab,
            findThread: SituationRoom._onFindThread,
            revertTurn: SituationRoom._onRevertTurn,
            beginChapter: SituationRoom._onBeginChapter,
            addChapter: SituationRoom._onAddChapter,
            removeChapter: SituationRoom._onRemoveChapter,
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
            advancePlotTurn: SituationRoom._onAdvancePlotTurn,
            toggleForceActive: SituationRoom._onToggleForceActive,
            saveEdit: SituationRoom._onSaveEdit,
            revertEdit: SituationRoom._onRevertEdit,
            closeEdit: SituationRoom._onCloseEdit,
            addPhase: SituationRoom._onAddPhase,
            removePhase: SituationRoom._onRemovePhase,
            addPhaseReveal: SituationRoom._onAddPhaseReveal,
            addPhaseLock: SituationRoom._onAddPhaseLock,
            removePhaseGate: SituationRoom._onRemovePhaseGate,
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
            togglePreview: SituationRoom._onTogglePreview,
            showPlayers: SituationRoom._onShowPlayers
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
     * Which half of an open Plot is showing: its Threads, or what requires what.
     *
     * Instance state like #view, and reset when a Plot is opened — the graph is a
     * thing you go and look at, not a mode the board stays in, and arriving at a
     * different Plot in Requirements would hide the Threads somebody came for.
     */
    #plotTab = 'threads';

    /**
     * What is typed into each search box, by scope.
     *
     * Instance state like #view, and deliberately NOT part of the render
     * context: filtering happens in the DOM against the haystack each row
     * carries, so typing never re-renders and the caret never jumps. What this
     * field is for is surviving a render that happens for some OTHER reason —
     * a push landing, a cycle turning — which would otherwise silently unfilter
     * a list the GM is still reading.
     */
    #search = { threads: '', plots: '' };

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

    /**
     * The Show Players control, and whether there is anyone to show it to.
     *
     * A press with nobody connected succeeds and does nothing, which is the worst
     * of the three possible outcomes — so the button says so instead. Counted
     * from active non-GM users: a second GM is not the table.
     */
    #buildShowPlayers() {
        const watching = game.users?.filter((u) => u.active && !u.isGM).length ?? 0;
        return {
            can: watching > 0,
            hint: watching > 0 ? 'RSR.show.hint' : 'RSR.show.nobody'
        };
    }

    /**
     * What the table is sent when the GM presses Show Players.
     *
     * Only ever a view the table HAS. The Cockpit and Settings are the GM's own
     * segments, and an open editor is authoring rather than a place — sending any
     * of the three would ask every player's client to land somewhere it cannot
     * go, so all three resolve to the Situation list.
     *
     * The open Plot rides along unfiltered, and the receiving client decides
     * whether it may see it. That is the M5 rule rather than a shortcut:
     * visibility is answered against the reader's own `isGM`, and a GM's guess
     * about what a player may see is exactly the second opinion M5 exists to
     * remove.
     */
    #showPayload() {
        const ownView = this.#view === VIEW.COCKPIT
            || this.#view === VIEW.SETTINGS
            || this.#edit !== null;
        if (ownView) return { view: VIEW.SITUATION, plotId: null, tab: 'threads' };
        return { view: this.#view, plotId: this.#plotId, tab: this.#plotTab };
    }

    /**
     * Open the board here because a GM asked for it.
     *
     * An already-open window is re-pointed rather than reopened: a player who
     * has the board up should find it showing what they were called over to see,
     * not find a second one on top of the first.
     */
    showAsDirected({ view, plotId = null, tab = 'threads' }, byUserId) {
        const board = readBoard();
        const plot = plotId ? plotById(board, plotId) : null;
        // Judged here, on this client, against this reader's own eyes.
        const mine = plot && visibleRows([plot], game.user.isGM).length === 1;

        this.#plotId = mine ? plotId : null;
        this.#plotTab = mine ? tab : 'threads';
        this.#view = (view === VIEW.COCKPIT || view === VIEW.SETTINGS) ? VIEW.SITUATION : view;
        this.render(true);

        const who = game.users?.get(byUserId)?.name ?? '';
        ui.notifications?.info(game.i18n.format('RSR.show.opened', { gm: who }));
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
                turnReading: cycleReading(board),
                turnLabel: worldClock(board),
                editor: editorContext(this.#edit.kind, this.#edit, board)
            };
        }

        const plots = this.#buildPlotList(board, isGM);

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
            // Built from the REAL GM for the same reason canPreview is: a GM
            // previewing the table's board is still the person who can summon it.
            showPlayers: game.user.isGM ? this.#buildShowPlayers() : null,
            isPreview: this.#asPlayer,
            isSituation: this.#view === VIEW.SITUATION,
            isCockpit: this.#view === VIEW.COCKPIT,
            isHelp: this.#view === VIEW.HELP,
            // One string, built here, because how a count is READ is a campaign
            // setting and the template cannot ask two questions about it.
            turnReading: cycleReading(board),
            turnLabel: worldClock(board),
            // Only ever the world's clock: a Plot keeping its own carries its own
            // control, inside the Plot where it was pressed.
            turnRevert: isGM ? this.#buildRevert(board) : null,
            turnMark: isGM ? this.#buildMark(board) : null,
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
            plots,
            // Whether the Plot list is worth a search box. Decided here with
            // every other branch, rather than as `(gt plots.length 1)` in the
            // markup: the rule in this file is that the template asks no
            // questions it cannot answer from one field.
            hasManyPlots: plots.length > 1,
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

    /**
     * Whether the last cycle can still be taken back, for the button that would.
     *
     * Null when there is no record, and null when the record belongs to ANOTHER
     * clock: the control beside the world's button must never offer to undo a
     * Plot's cycle, or the other way round. The two presses do different things,
     * and a GM reaching for one of them means that one.
     *
     * A record that has gone stale still returns something, and the button is
     * drawn disabled with the reason on it. A control that has quietly vanished
     * is worse than one that will not work: this is exactly what a GM who
     * pressed the cycle by accident goes looking for, and it owes them the
     * reason rather than an absence.
     */
    #buildRevert(board, plotId = null) {
        const undo = board.turn.undo;
        if (!undo || (undo.plotId ?? null) !== plotId) return null;
        const why = refusal(undo, board.log);
        return {
            can: why === '',
            hint: why ? `RSR.turn.revertReason.${why}` : 'RSR.turn.revertHint'
        };
    }

    /**
     * Where the next Segment would open, for the button that would open it.
     *
     * Always something, never null, because unlike the revert this control is
     * not conditional on anything having happened — a campaign can be marked on
     * its first cycle. It is drawn disabled with the reason when the cycle the
     * board is standing on is already marked, which is the same courtesy the
     * revert gets and for the same reason: a GM who came looking for the control
     * is owed the reason rather than an absence.
     */
    #buildMark(board) {
        const at = nextMark(board.turn.count);
        const taken = hasMark(board.turn.chapters, at);
        return {
            at,
            can: !taken,
            // The GM's own word for a run, so the button reads "Begin a Season"
            // in a campaign that counts in seasons.
            word: runName(board),
            hint: taken ? 'RSR.turn.segmentAlready' : 'RSR.turn.segmentHint'
        };
    }

    #buildPlotList(board, isGM) {
        return visibleRows(visiblePlots(board), isGM).map((plot) => {
            const header = this.#plotHeader(board, plot, isGM);
            const nodes = visibleRows(nodesForPlot(board, plot.id), isGM);
            return {
                ...header,
                threadCount: nodes.length,
                search: this.#searchText(board, plot, header, nodes, isGM)
            };
        });
    }

    /**
     * What a Plot card can be found by.
     *
     * Its own name and description, every Thread on it that this viewer may see,
     * and every Asset committed to it. The Threads are the point: a GM looking
     * for the Granary should not have to remember which siege it is in, and the
     * card is the only thing on this screen that can answer.
     *
     * BUILT FROM PROJECTED NAMES, WHICH IS THE WHOLE RULE HERE. A search index
     * is a side channel: a haystack assembled from `node.name` would let a
     * player type a masked Thread's real name and watch a card light up, which
     * is the mask leaking through a feature that never renders it. So every
     * string in here has been through `projectIdentity` and `visibleRows`
     * first, and a masked row is findable by its mask and by nothing else.
     */
    #searchText(board, plot, header, nodes, isGM) {
        const threads = nodes.map((node) => {
            const id = projectIdentity(node, isGM, maskLabel(EDIT_KIND.NODE));
            return `${id.name} ${id.description}`;
        });
        const committed = visibleRows(
            board.assets.filter((a) => a.plotId === plot.id), isGM
        ).map((a) => projectIdentity(a, isGM, maskLabel(EDIT_KIND.ASSET)).name);
        return haystack(header.name, header.description, ...threads, ...committed);
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
            // Which clock this Plot keeps, and the button for it. GM only, both
            // of them: a Plot's cycle count is bookkeeping in the same way the
            // Cycle badge in the header is, and the table is not being asked to
            // track two calendars. `isGM` here is the projected viewer, so the
            // preview loses these along with everything else the GM has.
            ...(isGM ? {
                turnBehaviour: plot.turnBehaviour,
                onOwnClock: hasOwnTurn(plot),
                offTheClock: !followsTurn(plot) && !hasOwnTurn(plot),
                plotTurn: plot.turnCount,
                plotTurnLabel: plotClock(plot)
            } : {}),
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
        const threads = nodes.map((node) => this.#buildThread(board, plot, node, isGM));
        return {
            ...this.#plotHeader(board, plot, isGM),
            description: projectIdentity(plot, isGM, maskLabel(EDIT_KIND.PLOT)).description,
            groups: this.#buildGroups(board, plot, isGM),
            threads,
            threadCount: nodes.length,
            hasManyThreads: threads.length > 1,
            tray: this.#buildTray(board, plot, isGM),
            showThreads: this.#plotTab !== 'graph',
            showGraph: this.#plotTab === 'graph',
            // Null unless the last cycle turned on THIS Plot's clock. GM-only by
            // way of the caller, like every other control in this head.
            revert: isGM ? this.#buildRevert(board, plot.id) : null,
            graph: this.#buildGraph(nodes, threads)
        };
    }

    /**
     * What requires what, laid out in columns.
     *
     * VISIBILITY IS DONE BEFORE THIS RUNS, and that is the whole of the rule
     * here: `nodes` has already been through `visibleRows`, so a hidden Thread is
     * not in the layout's world at all. Its dependents therefore have a
     * requirement the layout cannot resolve, which comes back as `unknown` and
     * draws a mark rather than an arrow — an arrow would point at the space
     * where the hidden Thread would have been, which is a worse leak than naming
     * it, because the reader can count the columns.
     */
    #buildGraph(nodes, threads) {
        const shape = layout(nodes);
        const rows = new Map(threads.map((row) => [row.id, row]));
        const drawn = new Set(shape.layers.flat());
        const unknown = new Set(shape.unknown);

        const card = (id) => {
            const row = rows.get(id);
            const requires = (nodes.find((n) => n.id === id)?.prereqNodeIds ?? [])
                .filter((prereqId) => drawn.has(prereqId));
            const name = row?.name ?? '';
            return {
                id,
                name,
                masked: !!row?.masked,
                isConcluded: !!row?.isConcluded,
                isLocked: !!row?.isLocked,
                hasUnknown: unknown.has(id),
                // Which piece of work this card belongs to. The search on this
                // view hides whole CHAINS rather than cards — half a chain is a
                // lie about what is blocking what — so this is the one value it
                // compares, and a loose Thread is a chain of one.
                chain: shape.chains[id] ?? id,
                // What the box matches on: the projected name, and nothing else.
                // A Thread row in the list matches on far more than its name,
                // but a card shows one line of text, and hiding a whole chain
                // over a word the reader cannot see on it would be a filter
                // nobody could explain to themselves.
                search: name.toLowerCase(),
                // Space-joined for the attribute the edge drawing reads. The
                // alternative was serialising the edge list into the markup as
                // JSON, which is one escaping bug away from a broken board;
                // ids on the card that owns them cannot be mispaired.
                requires: requires.join(' ')
            };
        };

        return {
            hasEdges: shape.hasEdges,
            layers: shape.layers.map((ids) => ({ cards: ids.map(card) })),
            // Cards now, drawn under the diagram rather than counted in a
            // sentence. Keeping them out of the COLUMNS is still right — five
            // cards with no arrow on them bury the one relationship somebody
            // opened this view for — but that was never a reason to leave them
            // off the screen, and "these are waiting on nobody" is one of the
            // two answers this view exists to give.
            loose: shape.orphans.map(card),
            // Threads in a ring, or waiting behind one. They can never open, so
            // they are named outright rather than drawn in a column that would
            // imply an order they do not have.
            tangled: shape.cycles.map((id) => rows.get(id)?.name).filter(Boolean)
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

        // Every entry is stamped with the world's count, whatever moved: `record`
        // reads one clock and there is only one it could read. So the stamp says
        // which clock that is, now that the board holds more than one of them —
        // and reads it the way the campaign counts, which for a segmented one
        // means a line from cycle 4 says which run cycle 4 fell in.
        const stamp = (count) => cycleReading(board, count);

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
                    // The track wins over the kind. A line about complications
                    // is read down the left edge like every other, and an arrow
                    // pointing forward beside "complications mounted" is the
                    // one icon that would say the opposite of its own sentence.
                    icon: e.track === TRACK.CONSEQUENCE
                        ? 'fa-solid fa-triangle-exclamation'
                        : (LOG_ICONS[e.kind] ?? LOG_ICONS[LOG_KIND.PUSH]),
                    // Dropped on the one line that IS the world's clock moving,
                    // where a stamp would repeat the sentence word for word. A
                    // Plot's own cycle keeps it: "Global Cycle 2" beside "Days on
                    // the Road 4 began" is two different facts.
                    when: e.kind === LOG_KIND.CYCLE && !e.plotId ? '' : stamp(e.turn),
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
     * Which colour a name is printed in, and the one rule that is not obvious.
     *
     * Own colour, then — for an Asset alone — the colour of the Force that owns
     * it, then the default for the kind. The Force step is the reason the
     * feature exists: a GM says "the Iron Legion is grey" once and every
     * battalion, bought magistrate and dragon they own reads grey without being
     * told individually.
     *
     * A MASKED ROW WEARS THE DEFAULT, and so does an Asset whose Force is
     * masked. Colour is identity, and identity is exactly what a mask is
     * withholding: four grey names in a chronicle full of teal ones would group
     * the Legion's work for a table that has not been told the Legion is in it.
     * Same rule as the mode chip, the drain and the contested standings.
     *
     * Returns a class AND a style, because a colour is resolved in one of two
     * places: a palette id is a class the stylesheet owns, with a light half and
     * a dark half; a GM's own colour is a hex that has to be carried inline. The
     * style string is built in logic/palette.mjs out of parsed integers and is
     * never the text the GM typed — which is what makes it safe to put in an
     * attribute at all.
     */
    #tagAttrs(kind, entity, board, isGM) {
        const none = { cls: `rsr-tag-kind-${kind}`, style: '' };
        if (!entity || isMasked(entity, isGM)) return none;
        if (entity.color) return tagStyle(entity.color, kind);
        if (kind !== 'asset') return none;
        const owner = entity.forceId ? forceById(board, entity.forceId) : null;
        if (!owner || isMasked(owner, isGM) || !owner.color) return none;
        return tagStyle(owner.color, kind);
    }

    /**
     * One entry as a sentence, built here rather than stored, because the names in
     * it depend on who is reading and on what is secret at the moment of reading —
     * neither of which was known when the entry was written.
     *
     * Every name in it is WRAPPED and COLOURED. A chronicle line is four kinds of
     * noun in one sentence — "The Iron Legion moved Bribing the Watch by +1" —
     * and until now the only thing telling a Force from a Thread from an Asset
     * was the wording around them. The colour is a default per kind, so it works
     * with nothing configured, and a GM's own choice where they made one.
     *
     * The string this returns is HTML and the template prints it unescaped, so
     * everything substituted into it goes through `esc` on the way in. The
     * colour is the one thing that does not, and does not need to: a palette id
     * is one of nine known strings, and a custom colour was rebuilt from parsed
     * integers in logic/palette.mjs rather than passed through. Neither can
     * carry a character the GM typed.
     */
    #logSentence(e, { board, plot, node, force, asset, isGM, mask }) {
        const F = (key, data) => game.i18n.format(key, data);
        // One line can name a Plot, a Thread, a Force and an Asset, and each is
        // masked as its own kind of thing.
        const name = (entity, kind) => projectIdentity(entity, isGM, mask[kind]).name;
        const tag = (entity, kind) => {
            const { cls, style } = this.#tagAttrs(kind, entity, board, isGM);
            return `<span class="rsr-tag ${cls}"${style ? ` style="${style}"` : ''}>`
                + `${esc(name(entity, kind))}</span>`;
        };

        const thread = node ? tag(node, 'node') : '';
        const who = force ? tag(force, 'force') : '';
        const where = plot ? tag(plot, 'plot') : '';

        switch (e.kind) {
            case LOG_KIND.PUSH: {
                // The number is the Thread's own, so it follows the Thread's own
                // rule about whether its numbers are public. A push of zero moved
                // nothing and happened for its note alone; "by +0" is not a fact
                // anyone wants read out.
                const values = node
                    ? e.amount !== 0 && showValues(node, isGM) && !isMasked(node, isGM)
                    : false;
                const amount = esc(e.amount > 0 ? `+${e.amount}` : String(e.amount));

                // A push on the Consequence is a different sentence, not the
                // same sentence with a chip on it: "the Ashen Hand advanced the
                // Second Assault" and "complications mounted on the Second
                // Assault" describe opposite developments, and a reader
                // skimming a column of them has to be able to tell at a glance.
                if (e.track === TRACK.CONSEQUENCE) {
                    if (who) {
                        return values
                            ? F('RSR.log.consequence', { force: who, thread, amount })
                            : F('RSR.log.consequenceQuiet', { force: who, thread });
                    }
                    return values
                        ? F('RSR.log.consequenceWorld', { thread, amount })
                        : F('RSR.log.consequenceWorldQuiet', { thread });
                }

                // A deadline moved by hand. It names no Force — time passing is
                // not something a side does — and the number is said in the
                // direction the row reads it, which is what is LEFT rather than
                // what has been spent.
                if (e.track === TRACK.EXPIRY) {
                    return values
                        ? F('RSR.log.deadline', { thread, amount })
                        : F('RSR.log.deadlineQuiet', { thread });
                }

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
                // Three endings, three sentences. The Consequence one names no
                // Force because there was none — `forceId` is null on that line,
                // so `who` is empty and it would otherwise read as "nobody
                // concluded it", which is not what happened.
                if (e.track === TRACK.CONSEQUENCE) {
                    return F('RSR.log.concludeConsequence', { thread });
                }
                return who
                    ? F('RSR.log.conclude', { force: who, thread })
                    : F('RSR.log.concludeWorld', { thread });
            case LOG_KIND.EXPIRE:
                // The GM's own word for it, three fallbacks deep. The line reads
                // in the reader's language for an untouched world and in the
                // GM's own words for a renamed one — the same treatment every
                // condition label already gets, and it is escaped for the same
                // reason: somebody typed it.
                return F('RSR.log.expired', {
                    thread, label: esc(expiryLabel(board, node))
                });
            case LOG_KIND.REOPEN:
                return F('RSR.log.reopen', { thread });
            case LOG_KIND.COMMIT:
                return thread
                    ? F('RSR.log.commit', { force: who, asset: tag(asset, 'asset'), thread })
                    : F('RSR.log.commitPlot', { force: who, asset: tag(asset, 'asset'), plot: where });
            case LOG_KIND.RELEASE:
                return F('RSR.log.release', { force: who, asset: tag(asset, 'asset') });
            case LOG_KIND.CONDITION:
                // The condition is stored as its id and named here, like every
                // other name in this file, so the line reads in the reader's
                // language rather than the language it was written in. A condition
                // the GM has since deleted resolves to the fallback rather than
                // rendering a raw id at the table.
                return F('RSR.log.condition', {
                    force: who,
                    asset: tag(asset, 'asset'),
                    // A condition label can be one the GM typed into the
                    // conditions table, so it is escaped like every other name.
                    condition: esc(game.i18n.localize(
                        Cond.labelOf(Cond.rowFor(board.conditions, e.condition))
                    ))
                });
            case LOG_KIND.CYCLE:
                // A cycle that belongs to one Plot names it and counts on that
                // Plot's own clock, which is why the number comes off `amount`:
                // `turn` is stamped with the world's count by `record`, and the
                // world's count is exactly what did not move. Naming the Plot
                // puts the line through the same rule as every other — a Plot
                // the reader may not know exists takes its name back out, and a
                // line left with nothing to say is dropped.
                //
                // The table gets the same line without the count. A Plot's own
                // cycle number is bookkeeping in exactly the way the badge in
                // the header is — nobody at the table is being asked to keep two
                // calendars — but that time passed there is fiction, and theirs.
                if (!where) {
                    return F('RSR.log.cycle', { reading: esc(cycleReading(board, e.turn)) });
                }
                return isGM
                    ? F('RSR.log.cyclePlot', {
                        label: esc(plotClock(plot)), plot: where, turn: e.amount
                    })
                    : F('RSR.log.cyclePlotQuiet', { plot: where });
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
        // Which way this Thread is READ. Withheld with the mode and for the same
        // reason: a bar draining while its neighbours fill is the loudest thing
        // a chip could have said about a row the table is told nothing about.
        const draining = projectCountdown(node, isGM, depletes(node, plot));
        const concluded = node.status === NODE_STATUS.CONCLUDED;
        // Not the stored status: that is only ONE of the three things that shut a
        // Thread, and a row drawn from it alone would sit open with a
        // prerequisite outstanding, or shut after State had moved past the Phase
        // that closed it. See logic/gating.mjs — the answer is derived every time
        // because every one of its inputs can change without touching this row.
        const gate = gateFor(board, node);
        const shut = !concluded && !gate.open;
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
            isLocked: shut,
            isContested: false,
            isClock: false,
            isPool: false,
            // The second track, or null when this Thread keeps none — and null
            // for a masked one whatever it really keeps. Declared here with the
            // three shapes so every row has the same key set whichever branch
            // below it takes.
            consequence: null,
            // How long this Thread has left, or null when it keeps no deadline
            // — and null for a masked one whatever it really keeps.
            expiry: null,
            isDepleting: draining,
            // Which way the one control on this row points. A depleting Thread
            // is pushed by typing a NEGATIVE number, and an arrow aimed right
            // while the reading falls is the same argument the sign convention
            // just lost. Said twice on purpose: the chip is the word for it and
            // this is the shape, and a GM working down a list of nine reads the
            // shape first.
            pushIcon: draining ? 'fa-solid fa-arrow-left-long' : 'fa-solid fa-arrow-right-long',
            // A shut gate takes the controls with it. This used to read "a locked
            // Thread is still advanceable, because locking is about what the
            // fiction allows and the GM decides that" — which was true while the
            // only lock was the GM's own switch. It is not true of a Thread
            // waiting on one that has not concluded, and a gate that can be
            // pushed straight through is decoration. The GM's remedy is to open
            // the gate: throw the switch, conclude the prerequisite, or move
            // State off the Phase that shut it.
            canPush: isGM && !concluded && !shut,
            canConclude: isGM && !concluded && !shut,
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

        // What this row can be found by: itself, and what is standing on it.
        // Assembled from the row that was just built rather than from the stored
        // Thread, so it inherits every projection above for free — a masked
        // Thread is searchable by its mask and not by its name.
        row.search = haystack(
            row.name, row.description, ...row.committedAssets.map((a) => a.name)
        );

        // What is still OWED, and only while it is owed. The row used to list
        // every prerequisite whether or not it had concluded, which reads as
        // blocked long after the chain has been walked. Named only when the
        // viewer may see the prerequisite too, or a shut Thread would give away
        // the name of a hidden one by explaining itself.
        const owed = shut
            ? gate.unmet.map((id) => board.nodes.find((n) => n.id === id)).filter(Boolean)
            : [];
        row.prereqNames = visibleRows(owed, isGM)
            .map((n) => projectIdentity(n, isGM, maskLabel(EDIT_KIND.NODE)).name);
        row.hasUnseenPrereqs = owed.length > row.prereqNames.length;

        // WHICH gate, for the GM alone. The table is told that a Thread is shut,
        // and what it is waiting on among the Threads they can already see —
        // which of the GM's own switches is down is a fact about the GM's screen,
        // and the Phase that shut it is the GM's authoring rather than the
        // fiction. Both would read as an admission that there is more here.
        row.shutBy = !isGM || !shut ? [] : [
            ...(gate.phaseLocked ? ['RSR.gate.byPhase'] : []),
            ...(gate.manual && !gate.revealed ? ['RSR.gate.byGM'] : [])
        ];

        // The reveal that fired, said out loud. The GM authored this Thread shut
        // and a Phase has since opened it; without the line they would go looking
        // for a switch they still believe is down.
        row.revealedByPhase = isGM && gate.revealed && gate.manual && !concluded;

        if (concluded) {
            // Three ways a Thread ends now: a Force carried it, nobody did, or its
            // own complications did. The third is a reserved id rather than a
            // Force, so it is asked about FIRST — `forceById` would answer null
            // for it and the row would print as "nobody", which is the one
            // reading it must not have.
            const byConsequence = node.concludedBy === CONCLUDED_BY_CONSEQUENCE;
            const winner = !byConsequence && node.concludedBy
                ? forceById(board, node.concludedBy) : null;
            const chip = winner ? projectForceChip(winner, isGM, maskLabel(EDIT_KIND.FORCE)) : null;
            row.concludedBy = chip;
            row.byConsequence = byConsequence;
            const outcome = outcomeFor(node, node.concludedBy);
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

        // ── the Consequence ──────────────────────────────────────────────────
        // Withheld from a masked Thread entirely, with the mode chip and the
        // drain and for the same reason: a second track under a row the table
        // has been told nothing about says this one is going wrong, which is the
        // loudest thing there is to say about it. A masked Thread keeps the one
        // plain fallback bar every other withheld row keeps.
        //
        // `hideValues` is the other axis and behaves as it does everywhere: the
        // track is drawn, its numbers are not, and a clock's pips go with them —
        // projectClock already owns that rule.
        const showsConsequence = hasConsequence(node, plot) && !isMasked(node, isGM);
        const shared = consequenceShared(node, plot);
        const pips = consequenceIsPips(node, plot);
        const size = consequenceSize(node);
        // Pips when the Thread it stands under counts in pips, a bar otherwise:
        // the Consequence mirrors the reading it is beside rather than inventing
        // a third kind of number for one row to hold.
        const consequenceReading = (forceId) => {
            const args = { current: consequenceOf(node, forceId), total: size, isGM, entity: node };
            return pips ? projectClock(args) : projectProgress(args);
        };

        if (showsConsequence && shared) {
            row.consequence = {
                isPips: pips,
                isFull: consequenceFull(node, plot),
                canPush: row.canPush,
                ...consequenceReading(null)
            };
        }

        // ── the deadline ─────────────────────────────────────────────────────
        // Withheld from a masked Thread with everything else, and for the
        // sharpest version of the same reason: "this one is running out of
        // time" is the single loudest thing that could be said about a row the
        // table has been told nothing about.
        //
        // Always a bar, never pips — unlike the Consequence, which mirrors the
        // reading it stands under. Time is not the Thread's own arithmetic and
        // does not take its shape: a deadline drawn as segments beside a clock's
        // segments would read as more of the same number.
        //
        // The control is drawn whatever clock it rides, because GM fiat is
        // possible on all three. That is the whole meaning of the FIAT option
        // being "only by fiat" rather than "by fiat".
        if (Expiry.hasExpiry(node) && !isMasked(node, isGM)) {
            row.expiry = {
                isExpired: Expiry.isExpired(node),
                // The GM's own word for it, three fallbacks deep — this
                // Thread's, the world's, the built-in one.
                label: expiryLabel(board, node),
                // Not gated on the Thread's own gate, unlike every other
                // control on this row. A shut Thread still runs out of time —
                // that is exactly what a window closing on something you could
                // not reach IS — so the deadline stays movable while the push
                // and the conclusion do not.
                canPush: isGM,
                // A deadline is read as what is LEFT. Nobody counts up to a
                // door closing.
                ...projectProgress({
                    current: Expiry.expirySpent(node),
                    total: Expiry.expirySize(node),
                    isGM, entity: node, countdown: true
                })
            };
            // The clock is running on nothing: this Thread rides its Plot's own
            // cycle and the Plot no longer keeps one. The GM's own authoring,
            // so it is told to the GM alone, like `shutBy`.
            row.expiryStranded = isGM && Expiry.isStranded(node, plot);
        }

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
                        // Each side against the SAME threshold, so a depleting
                        // contest is two reserves running down beside each
                        // other and the first to nothing is the side that has
                        // nothing left to spend. It still does not conclude
                        // itself; contested never does.
                        ...projectProgress({
                            current: node.progress.byForce[force.id] ?? 0,
                            total: threshold, isGM, entity: node,
                            countdown: draining
                        }),
                        // One complication per side, when the GM asked for that
                        // rather than one for the whole contest. Built here and
                        // not above because a contested row IS its contenders:
                        // there is no shared line for a per-side track to hang
                        // under.
                        ...(showsConsequence && !shared
                            ? {
                                consequence: {
                                    isPips: pips,
                                    isFull: consequenceFull(node, plot, force.id),
                                    canPush: row.canPush,
                                    forceId: force.id,
                                    ...consequenceReading(force.id)
                                }
                            }
                            : {})
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
                current: node.progress.pool, total: node.segments, isGM, entity: node,
                countdown: draining
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
            isGM, entity: node,
            // False for a masked row and for fiat, the only mode with no
            // number to run down — so the fallback bar fills, like every other
            // fallback bar on the board.
            countdown: draining
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
            reading: cycleReading(board),
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
            // What the count reads as with what is currently saved, shown beside
            // the list that decides it — the same idea as the icon preview.
            reading: cycleReading(board),
            // Where each run begins. Read off the CLOCK and not off `constants`:
            // a mark is a fact about the past, not a default for a new row, which
            // is why it is the one thing on this tab that is neither.
            chapters: board.turn.chapters.map((m) => ({
                at: m.at,
                name: m.name,
                label: runLabelAt(board, m.at)
            })),
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

        // Before the GM-only work below: the graph is drawn for everybody, and a
        // previewing GM is looking at the table's board and must see the same
        // arrows on it.
        this.#drawGraph();

        // Also everyone's: a player with eleven Threads in front of them has the
        // same problem the GM does, and the box filters what is already on their
        // screen rather than asking the world anything.
        this.#wireSearch();

        // Only present while an editor is open, and it exits quietly when it is
        // not — cheaper than asking twice.
        this.#wireColorPicker();
        this.#wireReshapers();

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

    /**
     * The controls that change WHICH CONTROLS EXIST.
     *
     * A Thread editor asks only the questions its mode can answer, so changing
     * the mode has to rebuild the section around the answer. That is a re-render
     * of a form the GM is standing in, which is the one thing this editor spent
     * its whole design avoiding — so it goes through `#mutate`, which harvests
     * the form into the draft BEFORE re-rendering. Nothing typed is lost, and the
     * mutation itself is the identity: the harvest is the entire point.
     *
     * `change` and not `input`, and wired ONLY to selects and checkboxes, which
     * is why the attribute is opt-in rather than applied to the form. A text or
     * number field carrying this would re-render between two keystrokes and the
     * GM would be typing into an element that no longer exists.
     *
     * Focus survives because ApplicationV2's `_syncPartState` restores it for an
     * element with an id or a [name], and every reshaping control has both.
     */
    #wireReshapers() {
        if (!this.#edit) return;
        for (const control of this.#form()?.querySelectorAll('[data-reshapes]') ?? []) {
            control.addEventListener('change', () => this.#mutate((draft) => draft));
        }
    }

    /**
     * Hook up every search box on screen, and re-apply what was already typed.
     *
     * Listeners are attached per render because the elements are new each time;
     * the QUERY is not, which is the point of #search. Re-applying at the end
     * means a list that was filtered before a push landed is still filtered
     * after it, without the box having to be touched again.
     */
    #wireSearch() {
        for (const box of this.element?.querySelectorAll('[data-search-scope]') ?? []) {
            const scope = box.dataset.searchScope;
            const query = SEARCH_QUERY[scope];
            const input = box.querySelector('[data-search-input]');
            if (!query || !input) continue;

            input.value = this.#search[query] ?? '';
            input.addEventListener('input', () => {
                this.#search[query] = input.value;
                this.#applySearch(scope);
            });
            box.querySelector('[data-search-clear]')?.addEventListener('click', () => {
                this.#search[query] = '';
                input.value = '';
                this.#applySearch(scope);
                input.focus();
            });

            this.#applySearch(scope);
        }
    }

    /**
     * Keep the swatch row and the custom colour box telling the same story.
     *
     * The form harvests ONE value: the radio decides, and the box is read only
     * when the radio says Custom (see logic/editing.mjs `colorPatch`). Left
     * alone, a GM could type a hex with Moss still selected and save moss — the
     * form would have shown them two answers and kept the one they were not
     * looking at. So touching either box checks Custom, and picking a swatch
     * empties both.
     *
     * No re-render anywhere in here, for the same reason the search box does
     * not: this runs while the GM is typing into one of these fields.
     */
    #wireColorPicker() {
        const form = this.#form();
        const wrap = form?.querySelector('[data-color-custom]');
        if (!form || !wrap) return;

        const text = wrap.querySelector('.rsr-color-text');
        const pick = wrap.querySelector('[data-color-pick]');
        const custom = form.querySelector('input[name="color"][value="custom"]');
        const swatch = custom?.closest('.rsr-swatch');
        if (!text || !custom) return;

        // The swatch dot shows the colour it stands for. Only ever set from a
        // PARSED value, never from the raw text: half of "#8a90" is not a colour
        // and would paint the dot black on the way to being one.
        const show = (parsed) => {
            if (!swatch) return;
            if (parsed) swatch.style.setProperty('--rsr-tag-ink', parsed);
            else swatch.style.removeProperty('--rsr-tag-ink');
        };

        const chooseCustom = () => { custom.checked = true; };

        text.addEventListener('input', () => {
            chooseCustom();
            const parsed = parseCustomColor(text.value);
            if (parsed && pick) pick.value = parsed;
            show(parsed);
        });

        pick?.addEventListener('input', () => {
            text.value = pick.value;
            chooseCustom();
            show(pick.value);
        });

        for (const radio of form.querySelectorAll('input[name="color"]')) {
            if (radio === custom) continue;
            radio.addEventListener('change', () => { text.value = ''; show(''); });
        }
    }

    /**
     * Show the rows that match and hide the rest.
     *
     * NO RE-RENDER. Rebuilding the context on every keystroke was the other
     * build and it fails in the most annoying way available: ApplicationV2
     * replaces the DOM, the input it replaces is the one being typed into, and
     * the caret lands back at the start of the box. So each row carries its own
     * haystack in an attribute and this walks them — which is also why a
     * player's board can be searched at all, since the attribute was built
     * against what that player may see.
     *
     * Every term must hit, so two words narrow rather than widen. `hidden` is
     * the switch because `.rsr [hidden]` already wins over everything.
     */
    #applySearch(scope) {
        const root = this.element;
        const list = root?.querySelector(`[data-search-list="${scope}"]`);
        if (!list) return;

        const terms = (this.#search[SEARCH_QUERY[scope]] ?? '').toLowerCase()
            .split(/\s+/).filter(Boolean);

        // Two filters, one set of chrome. The count, the clear button and the
        // "nothing matches" line say the same thing on both tabs and are worked
        // out the same way from whatever the filter reports back.
        const { shown, total } = scope === 'graph'
            ? this.#filterChains(list, terms)
            : this.#filterRows(list, terms);

        const box = root.querySelector(`[data-search-scope="${scope}"]`);
        const count = box?.querySelector('[data-search-count]');
        if (count) {
            count.hidden = terms.length === 0;
            count.textContent = game.i18n.format('RSR.search.count', { shown, total });
        }
        const clear = box?.querySelector('[data-search-clear]');
        if (clear) clear.hidden = terms.length === 0;

        // A list that has filtered itself down to nothing reads as a bug
        // otherwise — the rows are all still there, and none of them are drawn.
        const empty = root.querySelector(`[data-search-empty="${scope}"]`);
        if (empty) empty.hidden = !(terms.length > 0 && shown === 0);
    }

    /** Rows in a list: each one carries its own haystack, and hides on its own. */
    #filterRows(list, terms) {
        const rows = list.querySelectorAll('[data-search]');
        let shown = 0;
        for (const row of rows) {
            const hit = terms.every((term) => (row.dataset.search ?? '').includes(term));
            row.hidden = !hit;
            if (hit) shown += 1;
        }
        return { shown, total: rows.length };
    }

    /**
     * Cards on the Requirements view: the CHAIN hides, not the card.
     *
     * A card matches on its own name, and then brings its whole chain with it.
     * Hiding the cards that did not match would leave a diagram of stumps —
     * arrows pointing at nothing, a Thread shown as free that is in fact waiting
     * on something the filter took away — and this view exists to say what is
     * blocking what. Every card carries its chain in an attribute, worked out in
     * logic/graph-layout.mjs, so this is one comparison per card and a loose
     * Thread is a chain of one with no special case anywhere.
     *
     * A column emptied by the filter is hidden too. Left in place it is a gap
     * between two columns that still have cards, which reads as a step of the
     * chain that has gone missing rather than as one that was never shown.
     */
    #filterChains(graph, terms) {
        const cards = [...graph.querySelectorAll('.rsr-graph-card[data-chain]')];

        const keep = terms.length === 0 ? null : new Set(
            cards
                .filter((card) => terms.every((t) => (card.dataset.search ?? '').includes(t)))
                .map((card) => card.dataset.chain)
        );

        let shown = 0;
        for (const card of cards) {
            const hit = !keep || keep.has(card.dataset.chain);
            card.hidden = !hit;
            if (hit) shown += 1;
        }

        const holds = (el) => [...el.querySelectorAll('.rsr-graph-card')].some((c) => !c.hidden);
        for (const layer of graph.querySelectorAll('.rsr-graph-layer')) layer.hidden = !holds(layer);
        for (const free of graph.querySelectorAll('.rsr-graph-free')) free.hidden = !holds(free);

        // Two sentences that are about the whole Plot rather than about any card,
        // so neither can answer a search: the ring warning names Threads that are
        // not on the diagram at all, and "nothing waits on anything here" stops
        // being true of what is left the moment something is filtered out.
        for (const said of graph.querySelectorAll('.rsr-graph-tangle, .rsr-graph-nothing')) {
            said.hidden = terms.length > 0;
        }

        // The curves were measured against where the cards were standing. Hiding
        // a column moves everything to its right, so they are taken again.
        this.#drawGraph();
        return { shown, total: cards.length };
    }

    /**
     * The arrows on the requirement graph.
     *
     * Layout decided the columns; this decides the curves, and it has to run here
     * because nothing before the browser knows where a card actually landed —
     * a long Thread name wraps, a column grows, and every coordinate moves.
     * Cards carry the ids they require, so an arrow is a lookup rather than a
     * parallel list that can fall out of step with the markup.
     *
     * Coordinates are taken relative to the layer STRIP rather than to the
     * viewport. The strip is not the scroller — the frame around it is — so both
     * the strip and the cards inside it shift by the same amount when the graph
     * is scrolled sideways, and subtracting one from the other cancels it. That
     * is what keeps an arrow on its own cards once the graph outgrows the panel.
     */
    #drawGraph() {
        const graph = this.element?.querySelector('.rsr-graph');
        const svg = graph?.querySelector('.rsr-graph-edges');
        const layers = graph?.querySelector('.rsr-graph-layers');
        if (!svg || !layers) return;

        const frame = layers.getBoundingClientRect();
        const width = Math.ceil(frame.width);
        const height = Math.ceil(frame.height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        const box = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left - frame.left, y: r.top - frame.top, w: r.width, h: r.height };
        };

        const parts = [];
        for (const card of graph.querySelectorAll('.rsr-graph-card[data-requires]')) {
            // Filtered out by the search. A hidden card has no box worth
            // measuring, and an arrow drawn to it lands at the top-left corner.
            if (card.hidden) continue;
            const to = box(card);
            for (const id of card.dataset.requires.split(' ').filter(Boolean)) {
                const source = graph.querySelector(`.rsr-graph-card[data-node-id="${CSS.escape(id)}"]`);
                if (!source || source.hidden) continue;
                const from = box(source);

                // Out of the right edge of the requirement, into the left edge of
                // what requires it. The control points sit on the midline so the
                // curve leaves and arrives horizontally, which is what makes a
                // column of arrows readable when several land on one card.
                const x1 = from.x + from.w;
                const y1 = from.y + from.h / 2;
                const x2 = to.x;
                const y2 = to.y + to.h / 2;
                const mid = (x1 + x2) / 2;
                parts.push(`<path class="rsr-graph-edge" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" />`);
                // The head is drawn rather than marked up: a <marker> takes its
                // colour from context-stroke, which is one browser version away
                // from being invisible, and a triangle is three numbers.
                parts.push(`<path class="rsr-graph-head" d="M ${x2} ${y2} l -7 -4 l 0 8 z" />`);
            }
        }

        svg.innerHTML = parts.join('');
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
        this.#plotTab = 'threads';
        // A query belongs to the list it was typed at. Carried into the next
        // Plot it would hide most of what you just opened, and the box that
        // explains why is above the fold you have not scrolled to yet.
        this.#search.threads = '';
        this.render();
    }

    /**
     * Threads or Requirements. A way of looking; it writes nothing.
     *
     * The search box is deliberately NOT cleared. The two tabs share a query, so
     * a reader who has narrowed the diagram to one chain and then switches to
     * the list finds the same Threads waiting for them, with the box above
     * saying why. Clearing it here would make the two tabs disagree about what
     * the reader had asked for.
     */
    static _onSetPlotTab(event, target) {
        this.#plotTab = target.dataset.tab === 'graph' ? 'graph' : 'threads';
        this.render();
    }

    /**
     * A card on the Requirements view, pressed.
     *
     * That view answers one question — what waits on what — and cannot answer
     * any other: there is no bar on a card, no mode, no way to push it. So every
     * follow-up is a question about the row, and reaching the row meant changing
     * tab and finding it by eye among nine. This changes the tab and puts the
     * card's name in the search box, so the list opens on that Thread with the
     * box above it saying why the list is short.
     *
     * The NAME, not the id: the box matches text a reader can see, so what goes
     * into it has to be something they could have typed themselves — which for a
     * masked Thread means its mask, and that is right too.
     */
    static _onFindThread(event, target) {
        this.#plotTab = 'threads';
        this.#search.threads = target.dataset.threadName ?? '';
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

    /**
     * Delete a Thread, from the foot of its own editor.
     *
     * The editor has to be dismissed on the way out, or the GM is left looking
     * at a form for a row that no longer exists — and Save would then write it
     * back. Dismissed WITHOUT the dirty guard on purpose: the confirm they just
     * answered supersedes it, and asking a second time whether they want to keep
     * changes to the thing they have just deleted is nonsense.
     */
    static async _onRemoveThread(event, target) {
        const threadId = target.dataset.threadId;
        const { confirmDeleteThread } = await import('./editors.mjs');
        const removed = await confirmDeleteThread(threadId);
        if (removed && this.#edit?.id === threadId) {
            this.#edit = null;
            this.render();
        }
    }

    /**
     * Every push goes through the same dialog, whatever the Thread's mode. A Force
     * may ride on the button when the control sits inside a contender's row, which
     * only preselects it — the dialog still asks.
     */
    /**
     * Move one of a Thread's readings.
     *
     * ONE action for every track. Which pile is being moved comes off the button
     * that was pressed, because the button is standing beside the pile — a picker
     * in the dialog would be asking a question the press already answered. An
     * absent `data-track` is the Thread's own progress, so every control that
     * predates the second track keeps meaning what it meant.
     */
    static async _onPushThread(event, target) {
        const { promptPush } = await import('./editors.mjs');
        await promptPush(target.dataset.threadId, {
            forceId: target.dataset.forceId || null,
            track: target.dataset.track || TRACK.PROGRESS
        });
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
        ui.notifications?.info(game.i18n.format('RSR.editor.saved', {
            kind: game.i18n.localize(KIND_NOUNS[edit.kind]),
            name: edit.draft.name.trim()
        }));
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
        ui.notifications?.info(game.i18n.localize('RSR.asset.conditionsSaved'));
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

    /**
     * A Phase names a Thread it opens or one it shuts. Both buttons read the one
     * picker on that card — `pick-gate-<index>`, per card, because a Plot with
     * four Phases has four of these on screen at once and one shared name would
     * hand every card whichever value the first one happened to hold.
     */
    static #onPhaseGate(target, which) {
        const index = Number(target.dataset.index);
        this.#mutate((draft, form) => {
            const field = `pick-gate-${index}`;
            const id = readField(form, field);
            if (!id) return draft;
            clearField(form, field);
            return Edit.setPhaseGate(draft, index, which, id);
        });
    }

    static _onAddPhaseReveal(event, target) {
        SituationRoom.#onPhaseGate.call(this, target, 'reveal');
    }

    static _onAddPhaseLock(event, target) {
        SituationRoom.#onPhaseGate.call(this, target, 'lock');
    }

    static _onRemovePhaseGate(event, target) {
        const { index, which, threadId } = target.dataset;
        this.#mutate((draft) => Edit.clearPhaseGate(draft, Number(index), which, threadId));
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

        const { setConstants, setChapters } = await import('../data/state.mjs');
        await setConstants({
            forceResources: int('forceResources', CONSTANT_DEFAULTS.forceResources),
            forceIncome: int('forceIncome', CONSTANT_DEFAULTS.forceIncome),
            forceIcon: form.elements.forceIcon?.value ?? CONSTANT_DEFAULTS.forceIcon,
            assetCost: int('assetCost', CONSTANT_DEFAULTS.assetCost),
            threadThreshold: int('threadThreshold', CONSTANT_DEFAULTS.threadThreshold),
            clockSegments: int('clockSegments', CONSTANT_DEFAULTS.clockSegments),
            stateMin: int('stateMin', CONSTANT_DEFAULTS.stateMin),
            stateMax: int('stateMax', CONSTANT_DEFAULTS.stateMax),
            // Left empty on purpose when the GM clears it: '' means "use the
            // built-in word", and normalize trims, so a field of spaces is the
            // same as an empty one.
            turnLabel: form.elements.turnLabel?.value ?? CONSTANT_DEFAULTS.turnLabel,
            chapterLabel: form.elements.chapterLabel?.value ?? CONSTANT_DEFAULTS.chapterLabel,
            expiryLabel: form.elements.expiryLabel?.value ?? CONSTANT_DEFAULTS.expiryLabel,
            defaultVisibility
        });

        // A second write, and a different setting: the marks live on the clock,
        // not among the defaults. Rows are read one at a time out of the list
        // rather than through form.elements, because every row carries the same
        // two names and a repeated name is a RadioNodeList, not a value.
        await setChapters([...form.querySelectorAll('.rsr-chapter-row')]
            .filter((row) => !row.hasAttribute('data-chapter-proto'))
            .map((row) => ({
                at: Number(row.querySelector('[name="chapterAt"]')?.value),
                name: row.querySelector('[name="chapterName"]')?.value ?? ''
            })));

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

    /**
     * Take back the last cycle.
     *
     * ONE action for both clocks. The record on the board already says which
     * clock it belongs to, and the control offering it is only ever drawn beside
     * that clock — so `data-plot-id` is here to let the dialog NAME the Plot,
     * not to decide anything. The writer checks the record again regardless: a
     * render can be stale, and this is the press that must not act on one.
     */
    static async _onRevertTurn(event, target) {
        const { confirmRevertTurn } = await import('./editors.mjs');
        await confirmRevertTurn(target.dataset.plotId ?? null);
    }

    /** Open a Segment on the cycle the board is standing on. */
    static async _onBeginChapter() {
        const { confirmBeginChapter } = await import('./editors.mjs');
        await confirmBeginChapter();
    }

    /**
     * Add and remove rows in the Settings list, IN THE DOM and without a render.
     *
     * A render replaces the form, so anything half-typed in another row would be
     * lost the moment the GM added a second one — the same reason the search box
     * filters in place. The rows are harvested on Save, and until then this tab
     * is a form like any other: nothing is written by adding a row, and nothing
     * is lost by closing the tab without saving.
     */
    static _onAddChapter(event, target) {
        const list = target.closest('.rsr-settings-row')?.querySelector('.rsr-chapter-list');
        const proto = list?.querySelector('[data-chapter-proto]');
        if (!proto) return;

        const row = proto.cloneNode(true);
        row.removeAttribute('data-chapter-proto');
        row.hidden = false;
        list.insertBefore(row, proto);
        row.querySelector('[name="chapterAt"]')?.focus();
    }

    static _onRemoveChapter(event, target) {
        target.closest('.rsr-chapter-row')?.remove();
    }

    /**
     * One Plot's own cycle. The id comes off the button rather than from
     * `#plotId` because the button is drawn in the open Plot's header and the
     * open Plot is what it names — reading it back from instance state would be
     * the same answer arrived at less directly.
     */
    static async _onAdvancePlotTurn(event, target) {
        const { confirmAdvancePlotTurn } = await import('./editors.mjs');
        await confirmAdvancePlotTurn(target.dataset.plotId);
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

    /**
     * Put this board on every player's screen.
     *
     * Writes nothing, so it is not routed through state.mjs — there is no world
     * state for "the table is looking at this", and inventing one would leave a
     * stale pointer in the settings for every session after.
     */
    static _onShowPlayers() {
        if (!game.user.isGM) return;
        announce('board.show', this.#showPayload());
        ui.notifications?.info(game.i18n.localize('RSR.show.sent'));
    }
}

/**
 * What this client does when a GM says look at this.
 *
 * Exported for the entry point to hand to the relay, which must not import an
 * application class — the same reason ui/refresh.mjs finds its windows by a
 * static marker instead.
 */
export function showBoardAsDirected(payload = {}, byUserId = '') {
    if (!instance || instance.closed) instance = new SituationRoom();
    instance.showAsDirected(payload, byUserId);
}

/** One board per client. Re-opening brings the existing window forward. */
let instance = null;

export function openBoard({ view } = {}) {
    if (!instance || instance.closed) instance = new SituationRoom();
    if (view) instance.setView(view);
    return instance.render(true);
}
