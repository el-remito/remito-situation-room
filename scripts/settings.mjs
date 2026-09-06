/**
 * THE ONLY place `game.settings` is touched.
 *
 * Everything above this file goes through data/state.mjs, which goes through
 * these accessors. Nothing else may call game.settings.get/set — that rule is
 * what makes the GM relay in data/relay.mjs airtight, because there is exactly
 * one funnel to route through.
 *
 * Two conventions carried from the siblings:
 *
 *  - Setting names and hints are registered as RAW i18n KEYS and left for Foundry
 *    to localize. Eager game.i18n.localize() at registration time does not survive
 *    a language change at runtime (the reputation-tracker convention).
 *
 *  - Object-shaped settings are stored as ArrayField(ObjectField), never a plain
 *    object keyed by id. foundry.utils.mergeObject recurses into plain objects, so
 *    a key can be added but never removed; an array is the only shape a delete
 *    actually sticks in (the battle-decks rule).
 */

import { MODULE_ID, SETTINGS, VISIBILITY } from './constants.mjs';
import {
    normalizePlots, normalizeNodes, normalizeForces, normalizeAssets, normalizeTurn
} from './data/normalize.mjs';
import { refreshAll } from './ui/refresh.mjs';

/** Collections stored as ArrayField(ObjectField), each normalized on the way out. */
const COLLECTIONS = {
    [SETTINGS.PLOTS]: normalizePlots,
    [SETTINGS.NODES]: normalizeNodes,
    [SETTINGS.FORCES]: normalizeForces,
    [SETTINGS.ASSETS]: normalizeAssets
};

export function registerSettings() {
    const { ArrayField, ObjectField } = foundry.data.fields;

    for (const key of Object.keys(COLLECTIONS)) {
        game.settings.register(MODULE_ID, key, {
            scope: 'world',
            config: false,          // one setting, one editor — the board is the only writer
            type: new ArrayField(new ObjectField()),
            default: [],
            onChange: refreshAll
        });
    }

    game.settings.register(MODULE_ID, SETTINGS.TURN, {
        scope: 'world',
        config: false,
        type: new ObjectField(),
        default: { count: 0 },
        onChange: refreshAll
    });

    game.settings.register(MODULE_ID, SETTINGS.DEFAULT_VISIBILITY, {
        name: 'RSR.settings.defaultVisibility.name',
        hint: 'RSR.settings.defaultVisibility.hint',
        scope: 'world',
        config: true,
        type: String,
        default: VISIBILITY.HIDDEN,
        choices: {
            [VISIBILITY.VISIBLE]: 'RSR.visibility.visible',
            [VISIBILITY.MASKED]: 'RSR.visibility.masked',
            [VISIBILITY.HIDDEN]: 'RSR.visibility.hidden'
        }
    });
}

/**
 * The GM-only fallback entry point, for a world whose Journal sidebar has been
 * customised out from under our button.
 *
 * Takes the application class as an argument rather than importing it: settings.mjs
 * is imported by data/state.mjs, which apps/ imports, so importing an app here
 * would close the cycle.
 */
export function registerBoardMenu(ApplicationClass) {
    game.settings.registerMenu(MODULE_ID, 'boardMenu', {
        name: 'RSR.board.title',
        label: 'RSR.board.open',
        hint: 'RSR.settings.boardMenu.hint',
        icon: 'fa-solid fa-tower-observation',
        type: ApplicationClass,
        restricted: true
    });
}

// ── reads ────────────────────────────────────────────────────────────────────
// Every read normalizes, so no caller ever has to defend against a missing field.
// Normalization already returns fresh objects, so the cached setting cannot be
// mutated through what these hand back.

const readCollection = (key) => COLLECTIONS[key](game.settings.get(MODULE_ID, key));

export const getPlots = () => readCollection(SETTINGS.PLOTS);
export const getNodes = () => readCollection(SETTINGS.NODES);
export const getForces = () => readCollection(SETTINGS.FORCES);
export const getAssets = () => readCollection(SETTINGS.ASSETS);
export const getTurn = () => normalizeTurn(game.settings.get(MODULE_ID, SETTINGS.TURN));

export const getDefaultVisibility = () =>
    game.settings.get(MODULE_ID, SETTINGS.DEFAULT_VISIBILITY) ?? VISIBILITY.HIDDEN;

// ── writes ───────────────────────────────────────────────────────────────────
// GM-only by construction: data/state.mjs routes a non-GM caller through the relay
// before it ever reaches one of these. Calling these directly as a player throws.

const writeCollection = (key, rows) =>
    game.settings.set(MODULE_ID, key, COLLECTIONS[key](rows));

export const setPlots = (rows) => writeCollection(SETTINGS.PLOTS, rows);
export const setNodes = (rows) => writeCollection(SETTINGS.NODES, rows);
export const setForces = (rows) => writeCollection(SETTINGS.FORCES, rows);
export const setAssets = (rows) => writeCollection(SETTINGS.ASSETS, rows);
export const setTurn = (turn) => game.settings.set(MODULE_ID, SETTINGS.TURN, normalizeTurn(turn));
