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
import { startLanguageLoad, applyWorldLanguage, languageReady } from './scripts/i18n.mjs';
import { registerRelay, registerAnnouncements } from './scripts/data/relay.mjs';
import { registerSidebarButton } from './scripts/ui/sidebar-button.mjs';
import { seedPhaseWatch } from './scripts/ui/phase-note.mjs';
import * as state from './scripts/data/state.mjs';
import { SituationRoom, openBoard, showBoardAsDirected } from './scripts/apps/situation-room.mjs';

Hooks.once('init', () => {
    registerSettings();

    // Starts the DOWNLOAD of the world's language file. After registerSettings,
    // because it reads a setting. Nothing is written to game.i18n here: Foundry
    // replaces its translations object after this hook returns, so a merge now
    // would be thrown away. See the i18nInit hook below.
    startLanguageLoad();

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

// The earliest moment our copy survives. client/game.mjs calls `init` at :652
// and only then, at :663, awaits i18n.initialize() — which ends by assigning a
// brand new object to game.i18n.translations (localization.mjs:234) and calling
// this hook (:104). Merging here puts the WORLD's language over the client's
// own, on the object every localize() actually reads.
Hooks.once('i18nInit', applyWorldLanguage);

Hooks.once('ready', async () => {
    // Everything below this line, and everything the user can open afterwards,
    // reads strings — so the world's language file has to have landed first.
    await languageReady();

    // The Journal button is the one surface that renders before `ready`: the
    // directory is built during UI initialization, so it may already be sitting
    // there with the client's own language on it. Redrawing it re-runs our
    // injector against the merged table. Guarded on `rendered` so this never
    // forces a tab open that Foundry had not drawn yet.
    if (ui.journal?.rendered) ui.journal.render();

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
