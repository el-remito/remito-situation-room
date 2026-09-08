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
    normalizePlots, normalizeNodes, normalizeForces, normalizeAssets, normalizeTurn,
    normalizeConstants, normalizeLog, normalizeConditions
} from './data/normalize.mjs';
import { resolveConditions } from './logic/condition.mjs';
import { refreshAll } from './ui/refresh.mjs';
import { announcePhaseCrossings } from './ui/phase-note.mjs';

/** Collections stored as ArrayField(ObjectField), each normalized on the way out. */
const COLLECTIONS = {
    [SETTINGS.PLOTS]: normalizePlots,
    [SETTINGS.NODES]: normalizeNodes,
    [SETTINGS.FORCES]: normalizeForces,
    [SETTINGS.ASSETS]: normalizeAssets,
    [SETTINGS.LOG]: normalizeLog,
    [SETTINGS.CONDITIONS]: normalizeConditions
};

export function registerSettings() {
    const { ArrayField, ObjectField } = foundry.data.fields;

    for (const key of Object.keys(COLLECTIONS)) {
        // Plots carry State, and a State that has crossed a Phase boundary has a
        // note waiting for the GM. It hangs off the setting rather than off the
        // operation that moved it, because four different writes move State and
        // this is the one place all four pass through. See ui/phase-note.mjs.
        const onChange = key === SETTINGS.PLOTS
            ? (raw) => { refreshAll(); announcePhaseCrossings(normalizePlots(raw)); }
            : refreshAll;

        game.settings.register(MODULE_ID, key, {
            scope: 'world',
            config: false,          // one setting, one editor — the board is the only writer
            type: new ArrayField(new ObjectField()),
            default: [],
            onChange
        });
    }

    // World-wide defaults, edited in the board's own Settings segment rather than
    // in Foundry's settings sheet — they are campaign numbers, and they belong
    // beside the things they are defaults for.
    game.settings.register(MODULE_ID, SETTINGS.CONSTANTS, {
        scope: 'world',
        config: false,
        type: new ObjectField(),
        default: {},
        onChange: refreshAll
    });

    game.settings.register(MODULE_ID, SETTINGS.TURN, {
        scope: 'world',
        config: false,
        type: new ObjectField(),
        default: { count: 0 },
        onChange: refreshAll
    });

    /**
     * The pre-split default visibility, kept registered and read exactly once.
     *
     * There is now one default per KIND of row, and they live in the `constants`
     * object where the Settings segment edits them. This setting is no longer
     * written and no longer appears in Foundry's own settings sheet — it survives
     * so that a world that set it before the split opens with the GM's choice
     * carried across all four kinds instead of quietly reverting to Hidden.
     */
    game.settings.register(MODULE_ID, SETTINGS.DEFAULT_VISIBILITY, {
        scope: 'world',
        config: false,
        type: String,
        default: VISIBILITY.HIDDEN
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
/**
 * Every Asset, with its condition already resolved.
 *
 * This is the one place the GM's condition table is applied, and applying it here
 * is what keeps `effectiveThreshold(node, assets)` from becoming
 * `effectiveThreshold(node, assets, conditions)` all the way down the pure layer.
 * Nothing downstream takes a new argument, so nothing downstream can forget one.
 *
 * The attached `rule` is derived, not stored: normalizeAsset builds a fresh object
 * from known keys, so it is dropped again on the way back in.
 */
export const getAssets = () =>
    resolveConditions(readCollection(SETTINGS.ASSETS), getConditions());

/** The GM's condition table. Seeded with the module's six when the world has none. */
export const getConditions = () => readCollection(SETTINGS.CONDITIONS);
export const getLog = () => readCollection(SETTINGS.LOG);
export const getTurn = () => normalizeTurn(game.settings.get(MODULE_ID, SETTINGS.TURN));

/**
 * World-wide defaults, with the one upgrade this module carries.
 *
 * Default visibility used to be a single setting for every kind of row. A world
 * written before the split has no `defaultVisibility` key in its constants at
 * all, and that absence — not a value — is what distinguishes "never saved" from
 * "saved as Hidden". So the old setting is read here, once, and handed to the
 * normalizer as the seed for all four kinds.
 */
export function getConstants() {
    const raw = game.settings.get(MODULE_ID, SETTINGS.CONSTANTS);
    const stored = raw && typeof raw === 'object' ? raw : {};
    if (stored.defaultVisibility === undefined) {
        const legacy = game.settings.get(MODULE_ID, SETTINGS.DEFAULT_VISIBILITY);
        return normalizeConstants({ ...stored, defaultVisibility: legacy });
    }
    return normalizeConstants(stored);
}

/** What a new row of one kind starts as. `kind` is a key of constants.defaultVisibility. */
export const getDefaultVisibility = (kind) =>
    getConstants().defaultVisibility[kind] ?? VISIBILITY.HIDDEN;

// ── writes ───────────────────────────────────────────────────────────────────
// GM-only by construction: data/state.mjs routes a non-GM caller through the relay
// before it ever reaches one of these. Calling these directly as a player throws.

const writeCollection = (key, rows) =>
    game.settings.set(MODULE_ID, key, COLLECTIONS[key](rows));

export const setPlots = (rows) => writeCollection(SETTINGS.PLOTS, rows);
export const setNodes = (rows) => writeCollection(SETTINGS.NODES, rows);
export const setForces = (rows) => writeCollection(SETTINGS.FORCES, rows);
export const setAssets = (rows) => writeCollection(SETTINGS.ASSETS, rows);
export const setConditions = (rows) => writeCollection(SETTINGS.CONDITIONS, rows);
export const setLog = (rows) => writeCollection(SETTINGS.LOG, rows);
export const setTurn = (turn) => game.settings.set(MODULE_ID, SETTINGS.TURN, normalizeTurn(turn));
export const setConstants = (constants) =>
    game.settings.set(MODULE_ID, SETTINGS.CONSTANTS, normalizeConstants(constants));
