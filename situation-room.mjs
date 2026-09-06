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
import { registerRelay } from './scripts/data/relay.mjs';
import { registerSidebarButton } from './scripts/ui/sidebar-button.mjs';
import * as state from './scripts/data/state.mjs';
import { SituationRoom, openBoard } from './scripts/apps/situation-room.mjs';

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
        TEMPLATES.HELP
    ]);
});

Hooks.once('ready', () => {
    registerRelay();

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
