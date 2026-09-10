/**
 * Remito Situation Room — entry point.
 *
 * Lives at the repo root because the repo root IS the module folder, junctioned
 * into %LOCALAPPDATA%\FoundryVTT\Data\modules\remito-situation-room. There is no
 * build step: what you read here is what Foundry loads.
 *
 * Load order matters in one place only — importing data/state.mjs registers its
 * operation table into the relay, so the relay must never import state back.
 */

import { MODULE_ID, TEMPLATES, VIEW } from './scripts/constants.mjs';
import { registerSettings, registerBoardMenu } from './scripts/settings.mjs';
import { registerRelay, registerAnnouncements } from './scripts/data/relay.mjs';
import { registerSidebarButton } from './scripts/ui/sidebar-button.mjs';
import { seedPhaseWatch } from './scripts/ui/phase-note.mjs';
import * as state from './scripts/data/state.mjs';
import { SituationRoom, openBoard, showBoardAsDirected } from './scripts/apps/situation-room.mjs';

Hooks.once('init', () => {
    registerSettings();
    registerSidebarButton();

    registerBoardMenu(SituationRoom);

    // v14 path for partial preload. Registers each partial under its full path,
    // which is how the templates reference them. Only templates that exist may be
    // listed — a missing file here fails the whole call, not just its own entry.
    foundry.applications.handlebars.loadTemplates([
        TEMPLATES.BOARD,
        TEMPLATES.PLOT_CARD,
        TEMPLATES.NODE_ROW,
        TEMPLATES.CONSEQUENCE,
        TEMPLATES.EXPIRY,
        TEMPLATES.FORCE_PANEL,
        TEMPLATES.ASSET_CHIP,
        TEMPLATES.SETTINGS,
        TEMPLATES.LOG,
        TEMPLATES.SEARCH_BAR,
        TEMPLATES.GRAPH,
        TEMPLATES.GRAPH_CARD,
        TEMPLATES.EDITOR,
        TEMPLATES.EDITOR_CONDITIONS,
        TEMPLATES.EDITOR_PLOT,
        TEMPLATES.EDITOR_THREAD,
        TEMPLATES.EDITOR_FORCE,
        TEMPLATES.EDITOR_ASSET,
        TEMPLATES.HELP
    ]);
});

Hooks.once('ready', () => {
    registerRelay();

    // The relay's other direction: a GM addressing the table. Registered here
    // rather than inside relay.mjs so the socket funnel keeps importing no
    // application class.
    registerAnnouncements({ 'board.show': showBoardAsDirected });

    // Where every Plot stands right now, remembered and not announced. Without
    // this the first Phase crossing after a reload would read as a first sighting
    // and pass in silence — see ui/phase-note.mjs.
    seedPhaseWatch(state.readBoard().plots);

    game.modules.get(MODULE_ID).api = {
        open: openBoard,
        openCockpit: () => openBoard({ view: VIEW.COCKPIT }),
        // Read-only board snapshot, for poking at state from the console.
        read: state.readBoard,
        removeExample: state.removeExample,
        operations: state.OPERATION_NAMES
    };

    console.log(`${MODULE_ID} | Ready.`);
});
