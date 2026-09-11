/**
 * The example Plot the Help tab generates.
 *
 * This is real, tagged, removable data rather than a read-only mock, because the
 * point is that a GM can click Conclude and Advance Turn on it and watch the board
 * react. A fixture you cannot touch does not teach the loop.
 *
 * Every row carries isExample: true, which is what lets Remove Example delete
 * exactly its own output and nothing hand-authored. Ids are stable and prefixed,
 * so pressing Generate twice overwrites the example rather than growing a second
 * copy of it.
 *
 * It grows with each milestone: whatever a milestone adds, the fixture must
 * exercise. If the example cannot express a case, that feature is not finished.
 *
 * Pure — returns rows, writes nothing. data/state.mjs owns the writing.
 *
 * Its prose lives in the language files under RSR.example.*, and is resolved HERE,
 * at generation time, rather than at render time. What this function returns is
 * world data the GM then edits: a name that re-translated itself under them on the
 * next reload would overwrite their edit. So the example is written once, in the
 * language in force when Generate was pressed, and stays in it. That is also why
 * every key below is spelled out in full rather than built from a stem — it is
 * what lets tools/check.mjs pass 2 see all ninety-odd of them.
 */

import {
    EXPIRY_CLOCK, LIFECYCLE, LOG_KIND, MODE, NODE_STATUS, VISIBILITY, POLARITY, ASSET_MODIFIER,
    ASSET_CONDITION, TURN_BEHAVIOUR
} from '../constants.mjs';

/** Stable ids so Generate is an overwrite, not an append. */
const ID = {
    plot: 'rsr-ex-plot-northwall',
    road: 'rsr-ex-plot-road',
    legion: 'rsr-ex-force-legion',
    guard: 'rsr-ex-force-guard',
    siege: 'rsr-ex-node-siege',
    watch: 'rsr-ex-node-watch',
    grain: 'rsr-ex-node-grain',
    subject: 'rsr-ex-node-subject',
    gate: 'rsr-ex-node-gate',
    ledger: 'rsr-ex-node-ledger',
    quarter: 'rsr-ex-node-quarter',
    stores: 'rsr-ex-node-stores',
    fit: 'rsr-ex-node-fit',
    envoy: 'rsr-ex-node-envoy',
    ford: 'rsr-ex-node-ford',
    court: 'rsr-ex-node-court',
    battalion: 'rsr-ex-asset-battalion',
    dragon: 'rsr-ex-asset-dragon',
    runners: 'rsr-ex-asset-runners'
};

const example = { isExample: true };

/**
 * @returns {{plots: object[], nodes: object[], forces: object[], assets: object[],
 *            log: object[]}}
 */
export function buildExample() {
    const t = (key) => game.i18n.localize(key);

    const forces = [
        {
            ...example, id: ID.legion, name: t('RSR.example.legion.name'), img: '',
            resources: 12, income: 4, isPlayerForce: false, sort: 0,
            // Coin, and paid every cycle: the Legion is a going concern.
            icon: 'fa-solid fa-coins', isActive: true,
            // The colour the chronicle prints this Force's name in, AND the one
            // its Assets fall back to — so the battalion and the dragon read
            // Legion-grey without either of them being told. The example asked
            // for by name: "make sure the Iron Legion always colours their
            // Assets greyish."
            color: 'stone',
            visibility: VISIBILITY.VISIBLE, hideValues: false,
            tags: [
                { text: t('RSR.example.legion.strength1'), polarity: POLARITY.STRENGTH },
                { text: t('RSR.example.legion.strength2'), polarity: POLARITY.STRENGTH },
                { text: t('RSR.example.legion.weakness1'), polarity: POLARITY.WEAKNESS }
            ]
        },
        {
            ...example, id: ID.guard, name: t('RSR.example.guard.name'), img: '',
            resources: 7, income: 3, isPlayerForce: false, sort: 1,
            // A different Force counts a different thing. The Guard is fed, not paid.
            icon: 'fa-solid fa-wheat-awn', isActive: true,
            // And the other side gets one, so the two are told apart in a
            // chronicle line that names both.
            color: 'moss',
            visibility: VISIBILITY.VISIBLE, hideValues: false,
            tags: [
                { text: t('RSR.example.guard.strength1'), polarity: POLARITY.STRENGTH },
                { text: t('RSR.example.guard.weakness1'), polarity: POLARITY.WEAKNESS },
                { text: t('RSR.example.guard.weakness2'), polarity: POLARITY.WEAKNESS }
            ]
        }
    ];

    const plots = [{
        ...example,
        id: ID.plot,
        name: t('RSR.example.plot.name'),
        description: t('RSR.example.plot.description'),
        lifecycle: LIFECYCLE.ACTIVE,
        state: 58,
        stateMin: 0,
        stateMax: 100,
        // Authored low-to-high. normalize sorts anyway, but reading them in order
        // is how a GM checks their own ladder.
        phases: [
            // Two texts per Phase, two audiences: `description` is printed under
            // the State bar for everyone, `gmNotes` is what the GM does about it.
            { id: 'rsr-ex-phase-quiet', label: t('RSR.example.plot.quiet.label'), tone: 'calm', threshold: 0,
              description: t('RSR.example.plot.quiet.seen'),
              gmNotes: t('RSR.example.plot.quiet.notes'),
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-tense', label: t('RSR.example.plot.tense.label'), tone: 'neutral', threshold: 25,
              description: t('RSR.example.plot.tense.seen'),
              gmNotes: t('RSR.example.plot.tense.notes'),
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-critical', label: t('RSR.example.plot.critical.label'), tone: 'warn', threshold: 50,
              description: t('RSR.example.plot.critical.seen'),
              gmNotes: t('RSR.example.plot.critical.notes'),
              // The lines close the river, so the grain stops. State is 58, so
              // this has already fired: Smuggling Grain reads as shut, with the
              // reason on the row. Type State back under 50 in this editor and
              // it opens again — a Phase gate is not an event that
              // happened, it is where the situation currently stands.
              revealNodeIds: [], lockNodeIds: [ID.grain] },
            { id: 'rsr-ex-phase-fire', label: t('RSR.example.plot.fire.label'), tone: 'danger', threshold: 75,
              description: t('RSR.example.plot.fire.seen'),
              gmNotes: t('RSR.example.plot.fire.notes'),
              // Not reached yet. Push State to 75 and this opens the assault the
              // GM had locked — and it STAYS shut, because it also
              // waits on the siege engines. Two independent gates, and a reveal
              // is not a skeleton key for the other one.
              revealNodeIds: [ID.gate], lockNodeIds: [] }
        ],
        defaultMode: MODE.FIAT,
        forceIds: [ID.legion, ID.guard],
        // Cosmetic, and the first question anyone asks about a war.
        forceGroups: {
            [ID.legion]: t('RSR.example.plot.groupBesiegers'),
            [ID.guard]: t('RSR.example.plot.groupDefenders')
        },
        playerAssignable: false,
        visibility: VISIBILITY.VISIBLE,
        hideValues: false,
        // The world's clock, which is what almost every Plot wants.
        turnBehaviour: TURN_BEHAVIOUR.DEFAULT,
        turnCount: 0,
        sort: 0
    }, {
        // The second Plot exists for one reason: it does not keep the world's
        // clock. A siege is counted in weeks and a journey of six hundred miles
        // is not, and pressing Next Cycle for the siege should not move the
        // envoy three days further down the road. Isolated, so it sits still
        // until its own button is pressed — and the world's cycle now names it
        // as one of the Plots it will not move.
        ...example,
        id: ID.road,
        name: t('RSR.example.road.name'),
        description: t('RSR.example.road.description'),
        lifecycle: LIFECYCLE.ACTIVE,
        state: 20,
        stateMin: 0,
        stateMax: 100,
        phases: [
            { id: 'rsr-ex-phase-riding', label: t('RSR.example.road.riding.label'), tone: 'neutral', threshold: 0,
              description: t('RSR.example.road.riding.seen'),
              gmNotes: t('RSR.example.road.riding.notes'),
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-heard', label: t('RSR.example.road.heard.label'), tone: 'calm', threshold: 60,
              description: t('RSR.example.road.heard.seen'),
              gmNotes: t('RSR.example.road.heard.notes'),
              // Nobody gets an audience before word arrives. State is 20, so
              // this has not fired and the audience is shut twice over.
              revealNodeIds: [ID.court], lockNodeIds: [] }
        ],
        defaultMode: MODE.INVEST,
        forceIds: [ID.guard],
        forceGroups: { [ID.guard]: t('RSR.example.road.groupPetitioners') },
        playerAssignable: false,
        visibility: VISIBILITY.VISIBLE,
        hideValues: false,
        turnBehaviour: TURN_BEHAVIOUR.ISOLATED,
        // Its own clock, three cycles behind whatever the world is on, and
        // called something of its own — which is the point of being able to name
        // one at all. Clear the field in the editor and it reads Plot Cycle.
        turnLabel: t('RSR.example.road.turnLabel'),
        turnCount: 3,
        sort: 1
    }];

    // One thread per advancement mode, plus one concluded, one gated, three
    // masked in different ways and two that run down, so every way a row can
    // render is on screen at once — and the three masks are deliberately alike
    // from the table's side.
    const nodes = [
        {
            ...example, id: ID.siege, plotId: ID.plot, sort: 0,
            name: t('RSR.example.siege.name'),
            description: t('RSR.example.siege.description'),
            mode: MODE.CONTESTED,
            threshold: 10, segments: 6,
            progress: {
                pool: 0,
                byForce: { [ID.legion]: 6, [ID.guard]: 3 },
                // ONE COMPLICATION PER SIDE, which is the shape only a contest
                // can have. The Legion's engineers are three of four rain-swollen
                // days from losing the works entirely while the Guard, which has
                // barely started interfering, is at one — so a GM reading this
                // row can see that the side AHEAD is also the side about to come
                // apart. That is the whole argument for the per-side switch.
                consequenceByForce: { [ID.legion]: 3, [ID.guard]: 1 }
            },
            consequenceOn: true,
            consequenceSize: 4,
            consequencePerForce: true,
            consequenceDelta: -5,
            consequenceNote: t('RSR.example.siege.consequence'),
            outcomes: [
                { forceId: ID.legion, delta: 15, note: t('RSR.example.siege.legion') },
                { forceId: ID.guard, delta: -15, note: t('RSR.example.siege.guard') }
            ],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.watch, plotId: ID.plot, sort: 1,
            name: t('RSR.example.watch.name'),
            description: t('RSR.example.watch.description'),
            mode: MODE.CLOCK,
            threshold: 9, segments: 6,
            progress: { pool: 3, byForce: {} },
            outcomes: [{ forceId: ID.legion, delta: 10, note: t('RSR.example.watch.legion') }],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // Masked AND numberless, which is the pair worth having in a
            // fixture: the table knows something is happening at the gate,
            // not what and not how far along. It is also the only clock here,
            // so it is what demonstrates that a withheld clock draws a bar
            // instead of pips a player could simply count.
            visibility: VISIBILITY.MASKED, hideValues: true, playerAssignable: false
        },
        {
            ...example, id: ID.grain, plotId: ID.plot, sort: 2,
            name: t('RSR.example.grain.name'),
            description: t('RSR.example.grain.description'),
            mode: MODE.INVEST,
            threshold: 11, segments: 6,
            progress: { pool: 7, byForce: { [ID.guard]: 7 } },
            outcomes: [{ forceId: ID.guard, delta: -12, note: t('RSR.example.grain.guard') }],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // Visible, but the numbers are withheld — the bar shows, the count does not.
            visibility: VISIBILITY.VISIBLE, hideValues: true, playerAssignable: false
        },
        {
            ...example, id: ID.subject, plotId: ID.plot, sort: 3,
            name: t('RSR.example.subject.name'),
            description: t('RSR.example.subject.description'),
            mode: MODE.FIAT,
            threshold: 9, segments: 6,
            progress: { pool: 0, byForce: {} },
            outcomes: [{ forceId: ID.legion, delta: 15, note: t('RSR.example.subject.legion') }],
            status: NODE_STATUS.CONCLUDED, concludedBy: ID.legion, prereqNodeIds: [],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.gate, plotId: ID.plot, sort: 4,
            name: t('RSR.example.gate.name'),
            description: t('RSR.example.gate.description'),
            mode: MODE.FIAT,
            threshold: 9, segments: 6,
            progress: { pool: 0, byForce: {}, expiry: 0 },
            // The third setting: nothing moves this but the GM. Winter is not on
            // anybody's calendar until they say it is, and a clock that ran on
            // its own would put the Legion out of time on a schedule the fiction
            // never agreed to. The push control is drawn on this exactly as it
            // is on the two above — what the setting decides is what ELSE moves
            // it.
            expiryOn: true, expirySize: 4, expiryClock: EXPIRY_CLOCK.FIAT,
            outcomes: [
                { forceId: ID.legion, delta: 25, note: t('RSR.example.gate.legion') },
                { forceId: ID.guard, delta: -20, note: t('RSR.example.gate.guard') }
            ],
            status: NODE_STATUS.LOCKED, concludedBy: null,
            prereqNodeIds: [ID.siege],
            // Hidden outright: the table should not know this thread exists yet.
            visibility: VISIBILITY.HIDDEN, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.ledger, plotId: ID.plot, sort: 5,
            name: t('RSR.example.ledger.name'),
            description: t('RSR.example.ledger.description'),
            mode: MODE.INVEST,
            threshold: 8, segments: 6,
            // AT ITS LINE, on purpose, and it is the only row in the fixture
            // that is. Press Next Global Cycle on a freshly generated example
            // and the confirmation names this Thread before it names anything
            // else — which is the whole of what the pre-cycle check is for, and
            // impossible to demonstrate on a board where nothing is finished.
            //
            // It is also MASKED, which makes it the sharper demonstration: the
            // table has heard a rumour and the GM has a conclusion waiting, and
            // the check is the only place on the board that says so at the
            // moment it matters.
            progress: { pool: 8, byForce: { [ID.legion]: 8 } },
            outcomes: [{ forceId: ID.legion, delta: 12, note: t('RSR.example.ledger.legion') }],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // Masked, and the mask says what it likes: this is the row that
            // demonstrates both halves of round 2. The table gets the GM's own
            // name for it, and a rumour standing where the bar would be —
            // because they have HEARD about this one rather than watched it, and
            // a bar would tell them how close it is.
            visibility: VISIBILITY.MASKED, hideValues: false, playerAssignable: false,
            maskLabel: t('RSR.example.ledger.maskLabel'),
            maskNote: t('RSR.example.ledger.maskNote')
        },
        {
            ...example, id: ID.quarter, plotId: ID.plot, sort: 6,
            name: t('RSR.example.quarter.name'),
            description: t('RSR.example.quarter.description'),
            mode: MODE.CONTESTED,
            threshold: 9, segments: 6,
            progress: { pool: 0, byForce: { [ID.legion]: 4, [ID.guard]: 2 } },
            outcomes: [
                { forceId: ID.legion, delta: 10, note: t('RSR.example.quarter.legion') },
                { forceId: ID.guard, delta: -10, note: t('RSR.example.quarter.guard') }
            ],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // Masked, numbers on, and no note — which is what makes it the row
            // that demonstrates round 3. A GM reads a contest: two named sides,
            // a bar each. The table reads one plain bar and no mode chip,
            // because "Contested" would have told them somebody is being
            // opposed, and two named contenders would have told them who.
            visibility: VISIBILITY.MASKED, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.stores, plotId: ID.plot, sort: 7,
            name: t('RSR.example.stores.name'),
            description: t('RSR.example.stores.description'),
            mode: MODE.CLOCK,
            threshold: 9, segments: 8,
            progress: {
                pool: 3, byForce: {},
                // Five of six, so the fixture ships one track standing at the
                // edge rather than only ones idling. Open Conclude on this row
                // and the Consequence answer is already selected.
                consequence: 5
            },
            // The Consequence that MIRRORS its Thread: this is the only Clock on
            // the board, so this is where it draws as pips rather than as a bar,
            // beside the pips it belongs to. It is also the row that proves the
            // track does not invert with a depleting reading — the stores count
            // DOWN from eight and the spoilage counts UP to six, because a
            // complication is what is mounting whichever way the row is written.
            consequenceOn: true,
            consequenceSize: 6,
            consequenceDelta: 15,
            consequenceNote: t('RSR.example.stores.consequence'),
            outcomes: [
                { forceId: ID.legion, delta: 20, note: t('RSR.example.stores.legion') },
                { forceId: ID.guard, delta: -8, note: t('RSR.example.stores.guard') }
            ],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // The depleting Thread. Three of eight weeks are gone, so it reads
            // 5 / 8 with five pips lit rather than three — the SAME stored
            // progress as every other clock on this board, said the other way
            // round. Type −1 into its push dialog and the reading falls to 4,
            // because the box is filled in the direction the row is read.
            countdown: true,
            // Visible with its numbers on, deliberately: the point of this row
            // is the direction, and a mask would take that with it.
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.fit, plotId: ID.plot, sort: 8,
            name: t('RSR.example.fit.name'),
            description: t('RSR.example.fit.description'),
            mode: MODE.CONTESTED,
            threshold: 12, segments: 6,
            progress: { pool: 0, byForce: { [ID.legion]: 5, [ID.guard]: 8 } },
            outcomes: [
                { forceId: ID.legion, delta: 12, note: t('RSR.example.fit.legion') },
                { forceId: ID.guard, delta: -12, note: t('RSR.example.fit.guard') }
            ],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // The contest that runs DOWN, and the row that answers "left of what,
            // for whom?" — each side's own, against the same twelve. The GM reads
            // Legion 7 and Guard 4 and can see which wall gives first, which is
            // the whole reason a contest of attrition wants to be drawn this way
            // round. It still does not conclude itself: contested never does, so
            // a side reaching nothing is something the GM reads and calls.
            countdown: true,
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            // The head of the Long Road's chain, and the reason that Plot has a
            // graph worth opening: three Threads that must happen in order, which
            // a list can only ever say one row at a time.
            ...example, id: ID.ford, plotId: ID.road, sort: 0,
            name: t('RSR.example.ford.name'),
            description: t('RSR.example.ford.description'),
            mode: MODE.CLOCK,
            threshold: 4, segments: 4,
            progress: { pool: 2, byForce: {} },
            outcomes: [{ forceId: ID.guard, delta: 10, note: t('RSR.example.ford.guard') }],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            // On the other Plot, and therefore on the other clock. Pressing Next
            // Cycle for the siege does not move her; the Long Road's own button
            // does, and that is the whole of what this Thread is here to show.
            ...example, id: ID.envoy, plotId: ID.road, sort: 1,
            name: t('RSR.example.envoy.name'),
            description: t('RSR.example.envoy.description'),
            mode: MODE.INVEST,
            threshold: 12, segments: 6,
            progress: { pool: 4, byForce: { [ID.guard]: 4 }, expiry: 1 },
            // A deadline on THIS PLOT'S OWN CLOCK, which is the setting that only
            // means anything on an isolated Plot. Her supplies are counted in the
            // same weeks the road is, so pressing the siege's cycle does not
            // shorten them and the Long Road's own button does.
            expiryOn: true, expirySize: 5, expiryClock: EXPIRY_CLOCK.PLOT,
            expiryLabel: t('RSR.example.envoy.expiry'),
            outcomes: [{ forceId: ID.guard, delta: 40, note: t('RSR.example.envoy.guard') }],
            // Shut until the ford is behind her. The row says so by name, because
            // the ford is a Thread the table can see; a requirement they could
            // not see would say only that there is one.
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [ID.ford],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            // The third column, and the row that carries all three gates at once:
            // the GM has it locked, it waits on the envoy arriving, and the Plot's
            // own Heard From Phase is what lifts the lock. Reaching 60 opens the
            // switch and leaves the requirement standing.
            ...example, id: ID.court, plotId: ID.road, sort: 2,
            name: t('RSR.example.court.name'),
            description: t('RSR.example.court.description'),
            mode: MODE.FIAT,
            threshold: 9, segments: 6,
            progress: { pool: 0, byForce: {}, expiry: 2 },
            // THE ROW THAT ANSWERS THREE QUESTIONS AT ONCE about deadlines.
            //
            // It is NARRATIVE — tracking nothing, with no threshold and no
            // segments — and it still has three cycles, because how a Thread
            // comes on and how it runs out are different questions.
            //
            // It is SHUT, and the clock runs anyway. A window closing on
            // something nobody could reach is exactly what a deadline on a
            // locked Thread means, and it is the best argument on this board for
            // why the deadline is the one control a gate does not take away.
            //
            // And it rides the WORLD'S cycle from inside an isolated Plot. The
            // Duke hears petitions on the first of the month whatever calendar
            // the road is counted in, so the siege's button moves this and the
            // Long Road's does not — the exact opposite of the envoy above it.
            expiryOn: true, expirySize: 3, expiryClock: EXPIRY_CLOCK.WORLD,
            expiryLabel: t('RSR.example.court.expiry'),
            outcomes: [{ forceId: ID.guard, delta: 35, note: t('RSR.example.court.guard') }],
            status: NODE_STATUS.LOCKED, concludedBy: null, prereqNodeIds: [ID.envoy],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        }
    ];

    const assets = [
        {
            ...example, id: ID.battalion, forceId: ID.legion, sort: 0,
            name: t('RSR.example.battalion.name'), img: '', uuid: null,
            tags: [
                { text: t('RSR.example.battalion.strength'), polarity: POLARITY.STRENGTH },
                { text: t('RSR.example.battalion.weakness'), polarity: POLARITY.WEAKNESS }
            ],
            plotId: ID.plot, nodeId: ID.siege,
            modifier: { kind: ASSET_MODIFIER.COST_REDUCTION, value: 2 },
            // Damaged: still on the Thread and still counted as being there, and
            // its 2-point discount is HALVED rather than switched off, so the
            // Siege Thread reads 9 against the 8 it would read at full strength.
            // Half of a benefit is the thing worth seeing on a first look.
            condition: ASSET_CONDITION.DAMAGED, conditionCycles: 0,
            visibility: VISIBILITY.VISIBLE, hideValues: false
        },
        {
            // Mechanically inert, because most Assets are fiction rather than
            // arithmetic — and Recovering, so the Guard's tray is EMPTY. That is
            // the half of the condition rule worth seeing: an Asset that is out of
            // play is not offered as something to commit, however uncommitted it
            // technically is.
            ...example, id: ID.runners, forceId: ID.guard, sort: 0,
            // Recovering, with two Cycles left. Press Next Cycle twice and it
            // returns to Ready on its own and says so in the chronicle — which is
            // the one thing about conditions that cannot be seen standing still.
            condition: ASSET_CONDITION.RECOVERING, conditionCycles: 2,
            name: t('RSR.example.runners.name'), img: '', uuid: null,
            tags: [
                { text: t('RSR.example.runners.strength'), polarity: POLARITY.STRENGTH },
                { text: t('RSR.example.runners.weakness'), polarity: POLARITY.WEAKNESS }
            ],
            plotId: null, nodeId: null,
            modifier: { kind: ASSET_MODIFIER.NONE, value: 0 },
            visibility: VISIBILITY.VISIBLE, hideValues: false
        },
        {
            ...example, id: ID.dragon, forceId: ID.legion, sort: 1,
            name: t('RSR.example.dragon.name'), img: '', uuid: null,
            tags: [
                { text: t('RSR.example.dragon.strength'), polarity: POLARITY.STRENGTH },
                { text: t('RSR.example.dragon.weakness'), polarity: POLARITY.WEAKNESS }
            ],
            plotId: null, nodeId: null,
            modifier: { kind: ASSET_MODIFIER.BONUS_INVEST, value: 4 },
            // Hidden: the table has not learned the Legion has a dragon.
            visibility: VISIBILITY.HIDDEN, hideValues: false
        }
    ];

    // A few developments, so the chronicle column has something in it the first
    // time a GM looks at the board — including the two cases worth seeing side by
    // side. One is about the hidden Thread and is SEALED: a player reads its note
    // and nothing else, and will still read only that if the GM reveals the Thread
    // tomorrow, because revealing what is happening now is not a confession about
    // what happened then. The other names nothing secret at all and is MASKED by
    // the GM's own choice at the moment of writing — the table gets the fiction
    // without the mechanism.
    //
    // `at` counts backwards from the moment Generate is pressed. Stored, but not
    // printed: the board's own clock is what a reader is told, and "four minutes
    // ago" would be a lie about a campaign that has been running for months.
    const now = Date.now();
    const ago = (minutes) => now - (minutes * 60000);

    const log = [
        {
            ...example, id: 'rsr-ex-log-grain', kind: LOG_KIND.PUSH, turn: 2, at: ago(4),
            plotId: ID.plot, nodeId: ID.grain, forceId: ID.guard, assetId: null,
            amount: 3, cost: -3,
            note: t('RSR.example.log.grain')
        },
        {
            ...example, id: 'rsr-ex-log-battalion', kind: LOG_KIND.COMMIT, turn: 2, at: ago(9),
            plotId: ID.plot, nodeId: ID.siege, forceId: ID.legion, assetId: ID.battalion,
            amount: 0, cost: 0, note: ''
        },
        {
            ...example, id: 'rsr-ex-log-gate', kind: LOG_KIND.PUSH, turn: 1, at: ago(30),
            plotId: ID.plot, nodeId: ID.gate, forceId: ID.legion, assetId: null,
            amount: 0, cost: 0, visibility: VISIBILITY.VISIBLE, sealed: true,
            note: t('RSR.example.log.gate')
        },
        {
            ...example, id: 'rsr-ex-log-subject', kind: LOG_KIND.CONCLUDE, turn: 1, at: ago(48),
            plotId: ID.plot, nodeId: ID.subject, forceId: ID.legion, assetId: null,
            amount: 15, cost: 0, visibility: VISIBILITY.MASKED, sealed: false,
            note: t('RSR.example.log.subject')
        },
        {
            ...example, id: 'rsr-ex-log-cycle', kind: LOG_KIND.CYCLE, turn: 1, at: ago(60),
            plotId: null, nodeId: null, forceId: null, assetId: null,
            amount: 2, cost: 0, note: ''
        }
    ];

    return { plots, nodes, forces, assets, log };
}

/** Ids the fixture owns, so a caller can tell example rows from hand-authored ones. */
export const EXAMPLE_IDS = ID;
