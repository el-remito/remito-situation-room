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

import { LIFECYCLE, MODE, NODE_STATUS, PREFIX, TEMPLATES, VIEW } from '../constants.mjs';
import {
    readBoard, visiblePlots, plotById, nodesForPlot, forcesForPlot,
    assetsForNode, hasExample, forceById
} from '../data/state.mjs';
import { resolvePhase, resolvePhaseForGM, statePercent } from '../logic/state-track.mjs';
import { resolveMode, effectiveThreshold, isFull } from '../logic/progress.mjs';
import {
    visibleRows, projectIdentity, projectProgress, projectForceChip, showValues
} from '../logic/visibility.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Help sections, in reading order. Each resolves to RSR.help.<key>.title and
 * RSR.help.<key>.body.<gm|player> — the variant picks the string, rather than JS
 * assembling one. A milestone that adds a feature adds its key here.
 */
const HELP_SECTIONS = ['plots', 'threads', 'advancing', 'state'];

/** Localized once per render rather than per row. */
const maskLabel = () => game.i18n.localize('RSR.visibility.maskedName');

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
        actions: {
            selectView: SituationRoom._onSelectView,
            openPlot: SituationRoom._onOpenPlot,
            closePlot: SituationRoom._onClosePlot,
            createPlot: SituationRoom._onCreatePlot,
            editPlot: SituationRoom._onEditPlot,
            removePlot: SituationRoom._onRemovePlot,
            createThread: SituationRoom._onCreateThread,
            editThread: SituationRoom._onEditThread,
            removeThread: SituationRoom._onRemoveThread,
            advanceThread: SituationRoom._onAdvanceThread,
            concludeThread: SituationRoom._onConcludeThread,
            reopenThread: SituationRoom._onReopenThread,
            generateExample: SituationRoom._onGenerateExample,
            clearExample: SituationRoom._onClearExample
        }
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

    get view() { return this.#view; }

    /** Players have no Cockpit; asking for one lands them back on the board. */
    setView(view) {
        const allowed = view === VIEW.COCKPIT ? game.user.isGM : true;
        this.#view = allowed ? view : VIEW.SITUATION;
        this.render();
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const isGM = game.user.isGM;
        const board = readBoard();

        // No `eq` helper is available to module templates in v14, so every branch
        // the template needs is decided here.
        const segments = [
            { id: VIEW.SITUATION, label: 'RSR.board.viewSituation', icon: 'fa-solid fa-map' },
            ...(isGM ? [{ id: VIEW.COCKPIT, label: 'RSR.board.viewCockpit', icon: 'fa-solid fa-sliders' }] : []),
            { id: VIEW.HELP, label: 'RSR.board.viewHelp', icon: 'fa-solid fa-circle-question' }
        ].map((s) => ({ ...s, active: s.id === this.#view }));

        // A plot the GM hid out from under a player who had it open.
        const open = this.#plotId ? plotById(board, this.#plotId) : null;
        const openVisible = open && visibleRows([open], isGM).length === 1 ? open : null;

        return {
            ...context,
            isGM,
            segments,
            isSituation: this.#view === VIEW.SITUATION,
            isCockpit: this.#view === VIEW.COCKPIT,
            isHelp: this.#view === VIEW.HELP,
            turn: board.turn.count,
            hasExample: hasExample(board),
            helpSections: HELP_SECTIONS.map((key) => ({
                key,
                title: `RSR.help.${key}.title`,
                body: `RSR.help.${key}.body.${isGM ? 'gm' : 'player'}`
            })),
            plots: this.#buildPlotList(board, isGM),
            openPlot: openVisible ? this.#buildPlotDetail(board, openVisible, isGM) : null
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
        const identity = projectIdentity(plot, isGM, maskLabel());
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
            phaseTone: phase?.tone ?? 'neutral',
            gmNotes: isGM ? (phase?.gmNotes ?? '') : '',
            percent: statePercent(plot),
            showState: reveal && !identity.masked,
            state: reveal && !identity.masked ? plot.state : null,
            stateMax: reveal && !identity.masked ? plot.stateMax : null,
            forces: forcesForPlot(board, plot)
                .map((f) => projectForceChip(f, isGM, maskLabel()))
                .filter(Boolean)
        };
    }

    #buildPlotDetail(board, plot, isGM) {
        const nodes = visibleRows(nodesForPlot(board, plot.id), isGM);
        return {
            ...this.#plotHeader(board, plot, isGM),
            description: projectIdentity(plot, isGM, maskLabel()).description,
            threads: nodes.map((node) => this.#buildThread(board, plot, node, isGM))
        };
    }

    /**
     * One Thread row. The mode decides which bar shape renders, so the branch is
     * resolved here and the template just picks the block that is truthy.
     */
    #buildThread(board, plot, node, isGM) {
        const identity = projectIdentity(node, isGM, maskLabel());
        const mode = resolveMode(node, plot);
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
            mode,
            modeLabel: `RSR.thread.mode.${mode}`,
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

        // Prerequisites are named only when the viewer may see the prerequisite too;
        // otherwise a locked Thread would leak the name of a hidden one.
        const prereqs = node.prereqNodeIds
            .map((id) => board.nodes.find((n) => n.id === id))
            .filter(Boolean);
        row.prereqNames = visibleRows(prereqs, isGM)
            .map((n) => projectIdentity(n, isGM, maskLabel()).name);
        row.hasUnseenPrereqs = prereqs.length > row.prereqNames.length;

        if (concluded) {
            const winner = node.concludedBy ? forceById(board, node.concludedBy) : null;
            const chip = winner ? projectForceChip(winner, isGM, maskLabel()) : null;
            row.concludedBy = chip;
            const outcome = node.outcomes.find((o) => o.forceId === node.concludedBy);
            // The delta is bookkeeping; the note is fiction. Players get the fiction.
            row.outcomeNote = outcome?.note ?? '';
            row.outcomeDelta = isGM ? (outcome?.delta ?? null) : null;
            return row;
        }

        if (mode === MODE.CONTESTED) {
            row.isContested = true;
            row.contenders = (plot.forceIds ?? [])
                .map((id) => forceById(board, id))
                .filter(Boolean)
                .map((force) => {
                    const chip = projectForceChip(force, isGM, maskLabel());
                    if (!chip) return null;
                    return {
                        ...chip,
                        canPush: row.canPush,
                        ...projectProgress({
                            current: node.progress.byForce[force.id] ?? 0,
                            total: threshold, isGM, entity: node
                        })
                    };
                })
                .filter(Boolean);
            return row;
        }

        if (mode === MODE.CLOCK) {
            row.isClock = true;
            const filled = Math.min(node.segments, Math.max(0, node.progress.pool));
            // An array the template can walk — Handlebars cannot count.
            row.pips = Array.from({ length: node.segments }, (_, i) => ({ filled: i < filled }));
            row.clock = projectProgress({
                current: filled, total: node.segments, isGM, entity: node
            });
            return row;
        }

        // invest and fiat both read as one pool against a threshold. fiat simply
        // has nothing pushing it, which reads correctly as an empty bar.
        row.isPool = true;
        row.pool = projectProgress({
            current: node.progress.pool, total: threshold, isGM, entity: node
        });
        row.committedAssets = isGM
            ? assetsForNode(board, node.id).map((a) => a.name)
            : visibleRows(assetsForNode(board, node.id), isGM)
                .map((a) => projectIdentity(a, isGM, maskLabel()).name);
        return row;
    }

    // ── actions ──────────────────────────────────────────────────────────────

    static _onSelectView(event, target) {
        this.setView(target.dataset.view);
    }

    static _onOpenPlot(event, target) {
        this.#plotId = target.dataset.plotId ?? null;
        this.render();
    }

    static _onClosePlot() {
        this.#plotId = null;
        this.render();
    }

    static async _onCreatePlot() {
        const { promptPlot } = await import('./editors.mjs');
        await promptPlot(null);
    }

    static async _onEditPlot(event, target) {
        const { promptPlot } = await import('./editors.mjs');
        await promptPlot(target.dataset.plotId);
    }

    static async _onRemovePlot(event, target) {
        const { confirmDeletePlot } = await import('./editors.mjs');
        const removed = await confirmDeletePlot(target.dataset.plotId);
        if (removed && this.#plotId === target.dataset.plotId) this.#plotId = null;
    }

    static async _onCreateThread() {
        const { promptThread } = await import('./editors.mjs');
        await promptThread(null, this.#plotId);
    }

    static async _onEditThread(event, target) {
        const { promptThread } = await import('./editors.mjs');
        await promptThread(target.dataset.threadId, this.#plotId);
    }

    static async _onRemoveThread(event, target) {
        const { confirmDeleteThread } = await import('./editors.mjs');
        await confirmDeleteThread(target.dataset.threadId);
    }

    /** Amount and spender ride on the button, so one handler serves every mode. */
    static async _onAdvanceThread(event, target) {
        const { advanceNode } = await import('../data/state.mjs');
        await advanceNode(
            target.dataset.threadId,
            Number(target.dataset.amount) || 1,
            target.dataset.forceId || null
        );
    }

    static async _onConcludeThread(event, target) {
        const { promptConclude } = await import('./editors.mjs');
        await promptConclude(target.dataset.threadId);
    }

    static async _onReopenThread(event, target) {
        const { reopenNode } = await import('../data/state.mjs');
        await reopenNode(target.dataset.threadId);
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
