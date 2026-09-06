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
 */

import { PREFIX, TEMPLATES, VIEW } from '../constants.mjs';
import { readBoard, visiblePlots } from '../data/state.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
            closePlot: SituationRoom._onClosePlot
        }
    };

    static PARTS = { main: { template: TEMPLATES.BOARD } };

    /** Which segment is showing. Instance state, not persisted — it is a view preference. */
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

        return {
            ...context,
            isGM,
            segments,
            isSituation: this.#view === VIEW.SITUATION,
            isCockpit: this.#view === VIEW.COCKPIT,
            isHelp: this.#view === VIEW.HELP,
            plotCount: visiblePlots(board).length,
            turn: board.turn.count
        };
    }

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
}

/** One board per client. Re-opening brings the existing window forward. */
let instance = null;

export function openBoard({ view } = {}) {
    if (!instance || instance.closed) instance = new SituationRoom();
    if (view) instance.setView(view);
    return instance.render(true);
}
