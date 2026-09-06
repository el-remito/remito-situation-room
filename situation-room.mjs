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
import { registerSettings } from './scripts/settings.mjs';
import { registerRelay } from './scripts/data/relay.mjs';
import { registerSidebarButton } from './scripts/ui/sidebar-button.mjs';
import * as state from './scripts/data/state.mjs';
import { SituationRoom, openBoard } from './scripts/apps/situation-room.mjs';

Hooks.once('init', () => {
    registerSettings();
    registerSidebarButton();

    // The GM-only fallback path, in case a world's Journal sidebar is customised
    // out from under the button. registerMenu accepts an ApplicationV2 in v14.
    game.settings.registerMenu(MODULE_ID, 'boardMenu', {
        name: 'RSR.board.title',
        label: 'RSR.board.open',
        hint: 'RSR.settings.boardMenu.hint',
        icon: 'fa-solid fa-tower-observation',
        type: SituationRoom,
        restricted: true
    });

    // v14 path for partial preload. Only templates that exist may be listed.
    foundry.applications.handlebars.loadTemplates([TEMPLATES.BOARD]);
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
