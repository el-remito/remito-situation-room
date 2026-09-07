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
    CONSTANTS: 'constants',
    LOG: 'log',
    CONDITIONS: 'conditions',
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
    SETTINGS: `modules/${MODULE_ID}/templates/partials/settings.hbs`,
    LOG: `modules/${MODULE_ID}/templates/partials/log.hbs`,
    EDITOR: `modules/${MODULE_ID}/templates/partials/editor.hbs`,
    EDITOR_CONDITIONS: `modules/${MODULE_ID}/templates/partials/editor-conditions.hbs`,
    EDITOR_PLOT: `modules/${MODULE_ID}/templates/partials/editor-plot.hbs`,
    EDITOR_THREAD: `modules/${MODULE_ID}/templates/partials/editor-thread.hbs`,
    EDITOR_FORCE: `modules/${MODULE_ID}/templates/partials/editor-force.hbs`,
    EDITOR_ASSET: `modules/${MODULE_ID}/templates/partials/editor-asset.hbs`,
    HELP: `modules/${MODULE_ID}/templates/partials/help.hbs`
};

/**
 * The header segments. Help is available to players too, with role-adjusted copy;
 * Cockpit and Settings are GM-only and are simply absent from a player's context.
 */
export const VIEW = {
    SITUATION: 'situation',
    COCKPIT: 'cockpit',
    SETTINGS: 'settings',
    HELP: 'help'
};

/**
 * What an in-board editor is editing. Edit mode takes over the view the entity
 * lives in rather than opening a window: a dialog cannot hold a repeating widget,
 * which is how the Phase ladder ended up as a pipe-delimited textarea.
 *
 * The code word is `node`, as everywhere else; the reader sees "Thread".
 */
export const EDIT_KIND = {
    PLOT: 'plot',
    NODE: 'node',
    FORCE: 'force',
    ASSET: 'asset',
    // Not an entity: the world's own condition table, edited through the same
    // draft-and-Save machinery because it is a repeating widget and that is what
    // the board editors are for. Its Save writes a whole list rather than a patch.
    CONDITIONS: 'conditions'
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

/**
 * What kind of development a log entry records. The log stores references and a
 * kind, never a finished sentence — see logic/log.mjs for why.
 */
export const LOG_KIND = {
    PUSH: 'push',
    CONCLUDE: 'conclude',
    REOPEN: 'reopen',
    COMMIT: 'commit',
    RELEASE: 'release',
    CONDITION: 'condition',
    CYCLE: 'cycle'
};

export const POLARITY = {
    STRENGTH: 'strength',
    WEAKNESS: 'weakness'
};

/**
 * NONE is the default and exists for the common case: most Assets are fiction, not
 * arithmetic. A battalion that is simply *there* still matters at the table without
 * moving a number, and forcing every Asset to pick a mechanical effect would make
 * the board lie about which ones actually carry one.
 */
export const ASSET_MODIFIER = {
    NONE: 'none',
    COST_REDUCTION: 'costReduction',
    BONUS_INVEST: 'bonusInvest',
    BONUS_TICK: 'bonusTick'
};

/**
 * What state an Asset is in.
 *
 * An Asset is not a switch. A battalion can be at the front and broken, held down
 * by someone else, sitting in reserve, pulled out to heal, or gone for good, and a
 * GM wants to say which without deleting the row and losing everything written on
 * it.
 *
 * These ids are the DEFAULTS, not the vocabulary. The world's own table lives in
 * the `conditions` setting and the GM owns it outright: rename these, re-switch
 * them, delete the ones their campaign has no use for, add "Besieged" or
 * "Mutinous". These ids are what a fresh world is seeded with and what Restore the
 * defaults puts back — nothing in the module tests for one by name except READY,
 * which is the fallback every unrecognised condition resolves to.
 */
export const ASSET_CONDITION = {
    READY: 'ready',
    DAMAGED: 'damaged',
    SUPPRESSED: 'suppressed',
    INACTIVE: 'inactive',
    RECOVERING: 'recovering',
    DESTROYED: 'destroyed'
};

/**
 * What a condition does to the Asset's mechanical effect.
 *
 * A scale rather than a switch, because "broken" and "held down" are not the same
 * claim. HALF rounds toward zero, so a 1-point discount on a Damaged Asset is
 * worth nothing — which is the right answer: half of a marginal benefit is not a
 * benefit, and rounding it up would make Damaged free.
 */
export const CONDITION_EFFECT = {
    FULL: 'full',
    HALF: 'half',
    NONE: 'none'
};

/**
 * The six a fresh world starts with.
 *
 * Each row is the whole of what a condition does:
 *
 *   effect    FULL / HALF / NONE — what happens to its modifier
 *   inPlay    whether it may be committed, and whether it stays committed. Turning
 *             this off releases the Asset in the same write.
 *   cycles    how many Cycles the timer starts at when this condition is set.
 *             0 is no timer at all, which is most of them.
 *   becomes   what it turns into when that timer reaches zero. '' stays put.
 *   isFinal   ask before setting it, and set the Asset aside in a Lost group.
 *             Nobody should destroy a dragon by misclicking a dropdown.
 *
 * `labelKey` rather than a label: an untouched built-in renders in the reader's
 * language. A GM who renames one writes a plain `label`, which wins from then on
 * — because a name they chose is not a translatable string.
 *
 * READY is the only row that cannot be deleted. Everything resolves to it, so a
 * table without it has no answer to "what is normal".
 */
export const DEFAULT_CONDITIONS = [
    {
        id: ASSET_CONDITION.READY, labelKey: 'RSR.asset.condition.ready',
        effect: CONDITION_EFFECT.FULL, inPlay: true,
        cycles: 0, becomes: '', isFinal: false
    },
    {
        id: ASSET_CONDITION.DAMAGED, labelKey: 'RSR.asset.condition.damaged',
        effect: CONDITION_EFFECT.HALF, inPlay: true,
        cycles: 0, becomes: '', isFinal: false
    },
    {
        id: ASSET_CONDITION.SUPPRESSED, labelKey: 'RSR.asset.condition.suppressed',
        effect: CONDITION_EFFECT.NONE, inPlay: true,
        cycles: 0, becomes: '', isFinal: false
    },
    {
        id: ASSET_CONDITION.INACTIVE, labelKey: 'RSR.asset.condition.inactive',
        effect: CONDITION_EFFECT.NONE, inPlay: false,
        cycles: 0, becomes: '', isFinal: false
    },
    {
        id: ASSET_CONDITION.RECOVERING, labelKey: 'RSR.asset.condition.recovering',
        effect: CONDITION_EFFECT.NONE, inPlay: false,
        cycles: 2, becomes: ASSET_CONDITION.READY, isFinal: false
    },
    {
        id: ASSET_CONDITION.DESTROYED, labelKey: 'RSR.asset.condition.destroyed',
        effect: CONDITION_EFFECT.NONE, inPlay: false,
        cycles: 0, becomes: '', isFinal: true
    }
];

/**
 * World-wide defaults, edited in the Settings segment. These are the numbers a GM
 * should be able to set once for their campaign instead of retyping into every
 * editor — what a Force starts with, what a new Thread costs, what developing an
 * Asset takes out of a Force's purse.
 *
 * Stored as one object-shaped setting. Read through settings.mjs like everything
 * else, and normalized on read, so a world saved before a key existed still opens.
 */
export const CONSTANT_DEFAULTS = {
    forceResources: 0,
    forceIncome: 3,
    forceIcon: 'fa-solid fa-coins',
    assetCost: 0,
    threadThreshold: 9,
    clockSegments: 6,
    stateMin: 0,
    stateMax: 100,
    /**
     * What the table may see of a row the moment it is created, per kind of row.
     *
     * One default for everything was wrong in practice: a GM wants the Forces on
     * the board named from the start and the Threads they are running kept quiet,
     * and having to fix the visibility of every Force by hand taught them to stop
     * looking at the field at all. Hidden stays the default everywhere, because
     * the failure that cannot be undone is a leak.
     */
    defaultVisibility: {
        plot: VISIBILITY.HIDDEN,
        node: VISIBILITY.HIDDEN,
        force: VISIBILITY.HIDDEN,
        asset: VISIBILITY.HIDDEN
    }
};

/** The entity kinds that carry their own default visibility, in Settings order. */
export const VISIBILITY_KINDS = ['plot', 'node', 'force', 'asset'];

/** Every entity carries this shape. Kept here so normalize.mjs and state.mjs cannot drift. */
export const ENTITY_DEFAULTS = {
    visibility: VISIBILITY.VISIBLE,
    hideValues: false,
    isExample: false
};
