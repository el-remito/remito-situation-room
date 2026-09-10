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
    const forces = [
        {
            ...example, id: ID.legion, name: 'The Iron Legion', img: '',
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
                { text: 'Siegecraft', polarity: POLARITY.STRENGTH },
                { text: 'Disciplined ranks', polarity: POLARITY.STRENGTH },
                { text: 'Overextended supply line', polarity: POLARITY.WEAKNESS }
            ]
        },
        {
            ...example, id: ID.guard, name: 'The Northwall Guard', img: '',
            resources: 7, income: 3, isPlayerForce: false, sort: 1,
            // A different Force counts a different thing. The Guard is fed, not paid.
            icon: 'fa-solid fa-wheat-awn', isActive: true,
            // And the other side gets one, so the two are told apart in a
            // chronicle line that names both.
            color: 'moss',
            visibility: VISIBILITY.VISIBLE, hideValues: false,
            tags: [
                { text: 'Knows every stone of the wall', polarity: POLARITY.STRENGTH },
                { text: 'Outnumbered four to one', polarity: POLARITY.WEAKNESS },
                { text: 'Divided command', polarity: POLARITY.WEAKNESS }
            ]
        }
    ];

    const plots = [{
        ...example,
        id: ID.plot,
        name: 'Invasion of Northwall',
        description: 'The Legion has crossed the Salt Road and sits three days from the wall. '
            + 'Northwall has grain for a month and soldiers for a week.',
        lifecycle: LIFECYCLE.ACTIVE,
        state: 58,
        stateMin: 0,
        stateMax: 100,
        // Authored low-to-high. normalize sorts anyway, but reading them in order
        // is how a GM checks their own ladder.
        phases: [
            // Two texts per Phase, two audiences: `description` is printed under
            // the State bar for everyone, `gmNotes` is what the GM does about it.
            { id: 'rsr-ex-phase-quiet', label: 'Quiet', tone: 'calm', threshold: 0,
              description: 'Trade moves. The road south is open and nobody hurries.',
              gmNotes: 'Rumours only. The Legion is a story told by merchants.',
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-tense', label: 'Tense', tone: 'neutral', threshold: 25,
              description: 'Refugees at the gate, and grain costs twice what it did.',
              gmNotes: 'Refugees on the road. Grain prices double.',
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-critical', label: 'Critical', tone: 'warn', threshold: 50,
              description: 'Siege lines are visible from the wall. Nobody on it sleeps.',
              gmNotes: 'Siege lines visible from the wall. The Guard stops sleeping.',
              // The lines close the river, so the grain stops. State is 58, so
              // this has already fired: Smuggling Grain reads as shut, with the
              // reason on the row. Type State back under 50 in this editor and
              // it opens again — a Phase gate is not an event that
              // happened, it is where the situation currently stands.
              revealNodeIds: [], lockNodeIds: [ID.grain] },
            { id: 'rsr-ex-phase-fire', label: 'Rain of Fire', tone: 'danger', threshold: 75,
              description: 'The bombardment has started. Nothing in the city is safe.',
              gmNotes: 'Bombardment begins. Every scene in the city takes a complication.',
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
            [ID.legion]: 'The Besiegers',
            [ID.guard]: 'The Defenders'
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
        name: 'The Long Road South',
        description: 'A Guard envoy rode out before the lines closed, carrying a plea to '
            + 'the Duke at Vaelport. Nobody in Northwall knows where she is.',
        lifecycle: LIFECYCLE.ACTIVE,
        state: 20,
        stateMin: 0,
        stateMax: 100,
        phases: [
            { id: 'rsr-ex-phase-riding', label: 'Riding', tone: 'neutral', threshold: 0,
              description: 'She is somewhere on the Salt Road. That is all anyone can say.',
              gmNotes: 'Two weeks out. Legion outriders have the road as far as the ford.',
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-heard', label: 'Heard From', tone: 'calm', threshold: 60,
              description: 'A rider came back with her seal. The plea reached somebody.',
              gmNotes: 'Vaelport now knows. What the Duke does about it is the next question.',
              // Nobody gets an audience before word arrives. State is 20, so
              // this has not fired and the audience is shut twice over.
              revealNodeIds: [ID.court], lockNodeIds: [] }
        ],
        defaultMode: MODE.INVEST,
        forceIds: [ID.guard],
        forceGroups: { [ID.guard]: 'The Petitioners' },
        playerAssignable: false,
        visibility: VISIBILITY.VISIBLE,
        hideValues: false,
        turnBehaviour: TURN_BEHAVIOUR.ISOLATED,
        // Its own clock, three cycles behind whatever the world is on, and
        // called something of its own — which is the point of being able to name
        // one at all. Clear the field in the editor and it reads Plot Cycle.
        turnLabel: 'Days on the Road',
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
            name: 'Preparing Siege Engines',
            description: 'Legion engineers work the treeline north of the wall, out of bowshot.',
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
            consequenceNote: 'Rain and rot take the half-built engines where no raid could.',
            outcomes: [
                { forceId: ID.legion, delta: 15, note: 'The engines reach the wall intact.' },
                { forceId: ID.guard, delta: -15, note: 'A night raid burns the engines in the yard.' }
            ],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.watch, plotId: ID.plot, sort: 1,
            name: 'Bribing the Watch',
            description: 'Someone on the east gate roster has debts. The Legion is counting.',
            mode: MODE.CLOCK,
            threshold: 9, segments: 6,
            progress: { pool: 3, byForce: {} },
            outcomes: [{ forceId: ID.legion, delta: 10, note: 'The east gate opens quietly.' }],
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
            name: 'Smuggling Grain Past the Siege',
            description: 'The Guard is paying river runners in silver they cannot spare.',
            mode: MODE.INVEST,
            threshold: 11, segments: 6,
            progress: { pool: 7, byForce: { [ID.guard]: 7 } },
            outcomes: [{ forceId: ID.guard, delta: -12, note: 'The city eats for another month.' }],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // Visible, but the numbers are withheld — the bar shows, the count does not.
            visibility: VISIBILITY.VISIBLE, hideValues: true, playerAssignable: false
        },
        {
            ...example, id: ID.subject, plotId: ID.plot, sort: 3,
            name: 'Finding a Test Subject',
            description: 'The Legion needed one living body from inside the walls. They have it.',
            mode: MODE.FIAT,
            threshold: 9, segments: 6,
            progress: { pool: 0, byForce: {} },
            outcomes: [{ forceId: ID.legion, delta: 15, note: 'They know what the wards do now.' }],
            status: NODE_STATUS.CONCLUDED, concludedBy: ID.legion, prereqNodeIds: [],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.gate, plotId: ID.plot, sort: 4,
            name: 'Breaching the Gate',
            description: 'Nothing happens here until the engines are ready.',
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
                { forceId: ID.legion, delta: 25, note: 'Northwall falls before winter.' },
                { forceId: ID.guard, delta: -20, note: 'The breach is held. Barely.' }
            ],
            status: NODE_STATUS.LOCKED, concludedBy: null,
            prereqNodeIds: [ID.siege],
            // Hidden outright: the table should not know this thread exists yet.
            visibility: VISIBILITY.HIDDEN, hideValues: false, playerAssignable: false
        },
        {
            ...example, id: ID.ledger, plotId: ID.plot, sort: 5,
            name: 'A Name in the Ledger',
            description: 'A Legion paymaster is buying somebody inside the Guard.',
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
            outcomes: [{ forceId: ID.legion, delta: 12, note: 'The name is confirmed.' }],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            // Masked, and the mask says what it likes: this is the row that
            // demonstrates both halves of round 2. The table gets the GM's own
            // name for it, and a rumour standing where the bar would be —
            // because they have HEARD about this one rather than watched it, and
            // a bar would tell them how close it is.
            visibility: VISIBILITY.MASKED, hideValues: false, playerAssignable: false,
            maskLabel: 'Somebody is asking questions — ???',
            maskNote: 'Rumours about a foreigner running about with a loaded purse, '
                + 'talking to ex-guardsmen.'
        },
        {
            ...example, id: ID.quarter, plotId: ID.plot, sort: 6,
            name: 'Turning the Quartermaster',
            description: 'Both sides have made him an offer. Neither knows about the other.',
            mode: MODE.CONTESTED,
            threshold: 9, segments: 6,
            progress: { pool: 0, byForce: { [ID.legion]: 4, [ID.guard]: 2 } },
            outcomes: [
                { forceId: ID.legion, delta: 10, note: 'The stores answer to the Legion now.' },
                { forceId: ID.guard, delta: -10, note: 'He takes the Guard\'s coin and stays bought.' }
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
            name: 'The Granary Stores',
            description: 'What the city has left to eat, counted in weeks.',
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
            consequenceNote: 'What is left in the granary is not fit to eat.',
            outcomes: [
                { forceId: ID.legion, delta: 20,
                  note: 'The gates open because there is nothing left inside them.' },
                { forceId: ID.guard, delta: -8,
                  note: 'A convoy gets through, and the counting starts again.' }
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
            name: 'Men Still Fit to Fight',
            description: 'Camp fever below the wall, thin rations above it. Both sides are '
                + 'counting who can still stand a watch.',
            mode: MODE.CONTESTED,
            threshold: 12, segments: 6,
            progress: { pool: 0, byForce: { [ID.legion]: 5, [ID.guard]: 8 } },
            outcomes: [
                { forceId: ID.legion, delta: 12,
                  note: 'The wall is manned by too few, and everyone below can see it.' },
                { forceId: ID.guard, delta: -12,
                  note: 'Camp fever wins. The Legion pulls back to winter quarters.' }
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
            name: 'Slipping the Ford Patrol',
            description: 'Legion outriders hold the Salt Road crossing. She has to be past them '
                + 'before anything else on this road matters.',
            mode: MODE.CLOCK,
            threshold: 4, segments: 4,
            progress: { pool: 2, byForce: {} },
            outcomes: [{ forceId: ID.guard, delta: 10, note: 'She is across, and nobody saw her.' }],
            status: NODE_STATUS.ACTIVE, concludedBy: null, prereqNodeIds: [],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        },
        {
            // On the other Plot, and therefore on the other clock. Pressing Next
            // Cycle for the siege does not move her; the Long Road's own button
            // does, and that is the whole of what this Thread is here to show.
            ...example, id: ID.envoy, plotId: ID.road, sort: 1,
            name: 'Reaching Vaelport',
            description: 'Six hundred miles, two rivers, and a Legion patrol on the ford.',
            mode: MODE.INVEST,
            threshold: 12, segments: 6,
            progress: { pool: 4, byForce: { [ID.guard]: 4 }, expiry: 1 },
            // A deadline on THIS PLOT'S OWN CLOCK, which is the setting that only
            // means anything on an isolated Plot. Her supplies are counted in the
            // same weeks the road is, so pressing the siege's cycle does not
            // shorten them and the Long Road's own button does.
            expiryOn: true, expirySize: 5, expiryClock: EXPIRY_CLOCK.PLOT,
            expiryLabel: 'Out of road',
            outcomes: [{ forceId: ID.guard, delta: 40, note: 'The plea is read aloud at court.' }],
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
            name: 'An Audience at Court',
            description: 'The Duke of Vaelport hears petitions on the first of the month, '
                + 'and has heard nothing from Northwall in a year.',
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
            expiryLabel: 'Petitions closed',
            outcomes: [{ forceId: ID.guard, delta: 35, note: 'Vaelport rides north.' }],
            status: NODE_STATUS.LOCKED, concludedBy: null, prereqNodeIds: [ID.envoy],
            visibility: VISIBILITY.VISIBLE, hideValues: false, playerAssignable: false
        }
    ];

    const assets = [
        {
            ...example, id: ID.battalion, forceId: ID.legion, sort: 0,
            name: '437th Infantry Battalion', img: '', uuid: null,
            tags: [
                { text: 'Veterans of the Salt Road', polarity: POLARITY.STRENGTH },
                { text: 'Will not fight in the dark', polarity: POLARITY.WEAKNESS }
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
            name: 'The River Runners', img: '', uuid: null,
            tags: [
                { text: 'Know every channel of the delta', polarity: POLARITY.STRENGTH },
                { text: 'Loyal only to whoever paid last', polarity: POLARITY.WEAKNESS }
            ],
            plotId: null, nodeId: null,
            modifier: { kind: ASSET_MODIFIER.NONE, value: 0 },
            visibility: VISIBILITY.VISIBLE, hideValues: false
        },
        {
            ...example, id: ID.dragon, forceId: ID.legion, sort: 1,
            name: 'The Red Dragon of Scarmound', img: '', uuid: null,
            tags: [
                { text: 'Ends a siege in an afternoon', polarity: POLARITY.STRENGTH },
                { text: 'Owes the Legion nothing', polarity: POLARITY.WEAKNESS }
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
            note: 'The runners took the north channel and lost only one boat.'
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
            note: 'Something moved against the east gate in the dark. No one will say what.'
        },
        {
            ...example, id: 'rsr-ex-log-subject', kind: LOG_KIND.CONCLUDE, turn: 1, at: ago(48),
            plotId: ID.plot, nodeId: ID.subject, forceId: ID.legion, assetId: null,
            amount: 15, cost: 0, visibility: VISIBILITY.MASKED, sealed: false,
            note: 'They know what the wards do now.'
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
