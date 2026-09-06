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

import { LIFECYCLE, MODE, NODE_STATUS, VISIBILITY, POLARITY, ASSET_MODIFIER } from '../constants.mjs';

/** Stable ids so Generate is an overwrite, not an append. */
const ID = {
    plot: 'rsr-ex-plot-northwall',
    legion: 'rsr-ex-force-legion',
    guard: 'rsr-ex-force-guard',
    siege: 'rsr-ex-node-siege',
    watch: 'rsr-ex-node-watch',
    grain: 'rsr-ex-node-grain',
    subject: 'rsr-ex-node-subject',
    gate: 'rsr-ex-node-gate',
    battalion: 'rsr-ex-asset-battalion',
    dragon: 'rsr-ex-asset-dragon'
};

const example = { isExample: true };

/**
 * @returns {{plots: object[], nodes: object[], forces: object[], assets: object[]}}
 */
export function buildExample() {
    const forces = [
        {
            ...example, id: ID.legion, name: 'The Iron Legion', img: '',
            resources: 12, income: 4, isPlayerForce: false, sort: 0,
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
            { id: 'rsr-ex-phase-quiet', label: 'Quiet', tone: 'calm', threshold: 0,
              gmNotes: 'Rumours only. The Legion is a story told by merchants.',
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-tense', label: 'Tense', tone: 'neutral', threshold: 25,
              gmNotes: 'Refugees on the road. Grain prices double.',
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-critical', label: 'Critical', tone: 'warn', threshold: 50,
              gmNotes: 'Siege lines visible from the wall. The Guard stops sleeping.',
              revealNodeIds: [], lockNodeIds: [] },
            { id: 'rsr-ex-phase-fire', label: 'Rain of Fire', tone: 'danger', threshold: 75,
              gmNotes: 'Bombardment begins. Every scene in the city takes a complication.',
              revealNodeIds: [], lockNodeIds: [] }
        ],
        defaultMode: MODE.FIAT,
        forceIds: [ID.legion, ID.guard],
        playerAssignable: false,
        visibility: VISIBILITY.VISIBLE,
        hideValues: false,
        sort: 0
    }];

    // One thread per advancement mode, plus one concluded and one gated, so every
    // way a row can render is on screen at once.
    const nodes = [
        {
            ...example, id: ID.siege, plotId: ID.plot, sort: 0,
            name: 'Preparing Siege Engines',
            description: 'Legion engineers work the treeline north of the wall, out of bowshot.',
            mode: MODE.CONTESTED,
            threshold: 10, segments: 6,
            progress: { pool: 0, byForce: { [ID.legion]: 6, [ID.guard]: 3 } },
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
            // Masked: the table knows something is happening at the gate, not what.
            visibility: VISIBILITY.MASKED, hideValues: false, playerAssignable: false
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
            progress: { pool: 0, byForce: {} },
            outcomes: [
                { forceId: ID.legion, delta: 25, note: 'Northwall falls before winter.' },
                { forceId: ID.guard, delta: -20, note: 'The breach is held. Barely.' }
            ],
            status: NODE_STATUS.LOCKED, concludedBy: null,
            prereqNodeIds: [ID.siege],
            // Hidden outright: the table should not know this thread exists yet.
            visibility: VISIBILITY.HIDDEN, hideValues: false, playerAssignable: false
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

    return { plots, nodes, forces, assets };
}

/** Ids the fixture owns, so a caller can tell example rows from hand-authored ones. */
export const EXAMPLE_IDS = ID;
