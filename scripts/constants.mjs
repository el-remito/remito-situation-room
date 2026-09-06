/**
 * Shared identifiers and enums.
 *
 * Kept as bare exported constants rather than one wrapper object, matching the
 * convention in remito-heroic-skill-tree and remito-daggerheart-battle-decks.
 *
 * NAMING RULE — read this before adding anything:
 *   The domain object is `node` in code and "Thread" in the UI. Every identifier,
 *   setting key, schema field, file name and CSS class here says `node`. The word
 *   "Thread" appears in exactly one file, lang/en.json. No code path ever builds
 *   a user-facing noun by concatenation, which is what keeps that split free.
 */

export const MODULE_ID = 'remito-situation-room';
export const PREFIX = 'rsr';

/** Socket channel. `socket: true` is declared in module.json — without it this is silently dead. */
export const SOCKET = `module.${MODULE_ID}`;

export const SETTINGS = {
    // Shared world state. All config:false — edited only through the module's own UI.
    PLOTS: 'plots',
    NODES: 'nodes',
    FORCES: 'forces',
    ASSETS: 'assets',
    TURN: 'turn',
    // Player-facing options.
    DEFAULT_VISIBILITY: 'defaultVisibility'
};

export const TEMPLATES = {
    BOARD: `modules/${MODULE_ID}/templates/situation-room.hbs`,
    PLOT_CARD: `modules/${MODULE_ID}/templates/partials/plot-card.hbs`,
    NODE_ROW: `modules/${MODULE_ID}/templates/partials/node-row.hbs`,
    FORCE_PANEL: `modules/${MODULE_ID}/templates/partials/force-panel.hbs`,
    ASSET_CHIP: `modules/${MODULE_ID}/templates/partials/asset-chip.hbs`,
    GRAPH: `modules/${MODULE_ID}/templates/partials/graph.hbs`,
    HELP: `modules/${MODULE_ID}/templates/partials/help.hbs`
};

/** The three header segments. Help is available to players too, with role-adjusted copy. */
export const VIEW = {
    SITUATION: 'situation',
    COCKPIT: 'cockpit',
    HELP: 'help'
};

/** Per-entity visibility. `masked` renders "???" in place of the name; `hidden` omits it entirely. */
export const VISIBILITY = {
    VISIBLE: 'visible',
    MASKED: 'masked',
    HIDDEN: 'hidden'
};

/** Only ACTIVE plots are paid income by Advance Turn. ARCHIVED is filtered out of the board. */
export const LIFECYCLE = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    RESOLVED: 'resolved',
    ARCHIVED: 'archived'
};

/** Set as a Plot default; any node may override it. `null` on a node means "inherit". */
export const MODE = {
    FIAT: 'fiat',
    INVEST: 'invest',
    CLOCK: 'clock',
    CONTESTED: 'contested'
};

export const NODE_STATUS = {
    LOCKED: 'locked',
    ACTIVE: 'active',
    CONCLUDED: 'concluded'
};

export const POLARITY = {
    STRENGTH: 'strength',
    WEAKNESS: 'weakness'
};

export const ASSET_MODIFIER = {
    COST_REDUCTION: 'costReduction',
    BONUS_INVEST: 'bonusInvest',
    BONUS_TICK: 'bonusTick'
};

/** Every entity carries this shape. Kept here so normalize.mjs and state.mjs cannot drift. */
export const ENTITY_DEFAULTS = {
    visibility: VISIBILITY.VISIBLE,
    hideValues: false,
    isExample: false
};
