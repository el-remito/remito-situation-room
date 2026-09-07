/**
 * Resources, income, and what a push costs.
 *
 * Pure. No Foundry globals, no writes — every function returns a new value and
 * data/state.mjs decides what to persist. `node`-importable, exercised by
 * tools/check-economy.mjs.
 *
 * THE ECONOMY IN ONE PARAGRAPH. A Force holds Resources, an abstract meta-currency
 * the GM defines the fiction of — coin, favours, sworn swords, all of it at once.
 * Advancing a Thread in a Force's name spends that Force's Resources one-for-one
 * with the progress gained. Advancing it in nobody's name is free, because that is
 * the GM moving the world rather than a Force spending to move it. Assets add
 * progress on top of what was paid for, which is the whole reason to commit one.
 *
 * Income is paid by the single global cycle advance, and every Force draws it
 * unless the GM has paused that Force. A Force's income is a property of the Force
 * — of what it holds and farms and taxes — not of which Plot it happens to be
 * standing on, so a side that is quietly gathering strength off-screen keeps
 * gathering it. Pausing is the deliberate act: a Force that has been broken,
 * bought off, or written out stops earning the moment the GM says so.
 *
 * A Plot may keep its own clock or none at all (TURN_BEHAVIOUR), which changes
 * two things and deliberately not a third: its own count, and the condition
 * timers of the Assets committed to it. Not income. See `assetsOnTheClock`.
 */

import { LIFECYCLE, TURN_BEHAVIOUR } from '../constants.mjs';
import { isInPlay, isFinal } from './condition.mjs';

/** Resources never go negative. A Force at zero is broke, not in debt. */
export const RESOURCE_FLOOR = 0;

const int = (v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : 0;
};

export const clampResources = (value) => Math.max(RESOURCE_FLOOR, int(value));

// ── spending ─────────────────────────────────────────────────────────────────

/**
 * What advancing by `amount` in a Force's name costs that Force.
 *
 * One Resource per point, and a refund on the way back so a misclicked +1 can be
 * undone with a −1 without quietly burning the Force's treasury. Bonus progress
 * from Assets is deliberately NOT charged for: it is the return on having
 * committed the Asset in the first place.
 */
export const pushCost = (amount) => int(amount);

/**
 * What a push actually charges, given what it actually moved.
 *
 * The two differ more often than they look. A +1 into a full clock moves nothing,
 * so it must cost nothing. A −1 against an empty bar refunds nothing, or a Force
 * could mint Resources by pushing a Thread backwards forever. And a +1 that landed
 * +3 thanks to a committed Asset still costs 1, because the other 2 are the Asset
 * paying out. So the charge is the intent, capped by the reality.
 */
export function chargeFor(amount, realized) {
    const want = int(amount);
    const got = int(realized);
    return want > 0 ? Math.min(want, got) : Math.max(want, got);
}

export const canAfford = (force, cost) => (force?.resources ?? 0) >= Math.max(0, int(cost));

/**
 * Resources after spending (or, with a negative cost, refunding).
 *
 * Clamped at the floor: a refund cannot be turned into free income by pushing a
 * Thread backwards past where it started, because the progress clamps at zero too.
 */
export const spend = (force, cost) => clampResources((force?.resources ?? 0) - int(cost));

/** GM fiat, the escape hatch for everything the model does not cover. */
export const adjust = (force, delta) => clampResources((force?.resources ?? 0) + int(delta));

// ── income ───────────────────────────────────────────────────────────────────

export const isPayablePlot = (plot) => plot?.lifecycle === LIFECYCLE.ACTIVE;

/** Whether this Force draws income at all. The GM's pause switch, and nothing else. */
export const isPayableForce = (force) => force?.isActive !== false;

/**
 * Every Force engaged in at least one Active Plot, as a Set of ids.
 *
 * Engagement is the Plot's roster, not a Force's own opinion of itself: a Force
 * nobody has put on a Plot is not in play, however many Assets it owns.
 *
 * This is DISPLAY only. It used to gate income, which was wrong — a Force gathers
 * strength whether or not it is currently on screen. Pausing a Force is what stops
 * its income now; this only tells the GM where a Force is standing.
 */
export function engagedForceIds(plots) {
    const ids = new Set();
    for (const plot of plots ?? []) {
        if (!isPayablePlot(plot)) continue;
        for (const id of plot.forceIds ?? []) ids.add(id);
    }
    return ids;
}

/**
 * What the next cycle does to EVERY Force, including the ones it does nothing to.
 *
 * The full roster is the point. A bill that lists only the Forces being paid
 * cannot answer the question a GM actually has — "why did the Guard not get
 * anything?" — because the Guard is exactly the row it left out. Each row carries
 * why it is what it is, so the reader never has to reconstruct it.
 *
 * @returns {{forceId: string, name: string, income: number, from: number,
 *            to: number, paid: number, isActive: boolean, willBePaid: boolean}[]}
 */
export function incomeRoster(forces) {
    return (forces ?? []).map((f) => {
        const income = int(f.income);
        const active = isPayableForce(f);
        const willBePaid = active && income !== 0;
        // The realised change, which is not the income when a negative upkeep
        // would have taken a Force below zero.
        const to = willBePaid ? clampResources(f.resources + income) : f.resources;
        return {
            forceId: f.id,
            name: f.name,
            income,
            isActive: active,
            willBePaid,
            from: f.resources,
            to,
            paid: to - f.resources
        };
    });
}

/** Just the rows that move. The roster above is what gets shown. */
export const incomePayments = (forces) => incomeRoster(forces).filter((r) => r.paid !== 0);

// ── which clock a Plot keeps ─────────────────────────────────────────────────
// A Plot either rides the world's cycle, keeps its own, or keeps none. See
// TURN_BEHAVIOUR for why. These three are the only readers of the field, so a
// row written before it existed reads as DEFAULT and behaves as it always did.

export const behaviourOf = (plot) => plot?.turnBehaviour ?? TURN_BEHAVIOUR.DEFAULT;
export const followsTurn = (plot) => behaviourOf(plot) === TURN_BEHAVIOUR.DEFAULT;
export const hasOwnTurn = (plot) => behaviourOf(plot) === TURN_BEHAVIOUR.ISOLATED;

/**
 * The GM's own word for a clock, or '' when they have not chosen one.
 *
 * Pure, and deliberately incomplete: the FALLBACK is a localized string and this
 * layer has no i18n, so what comes back is the custom word or nothing, and the
 * caller supplies the built-in. That keeps the one Foundry-shaped part of this
 * at the two call sites that already localize, instead of dragging game.i18n
 * into a module that node imports.
 *
 * Reads the same field off a Plot and off the campaign constants, because a
 * clock is a clock: the world keeps one and so does an isolated Plot.
 */
export const clockName = (row) =>
    (typeof row?.turnLabel === 'string' ? row.turnLabel.trim() : '');

/**
 * The Plots the world's cycle will not move, and why.
 *
 * Named for the dialog that shows it. A GM pressing the world's cycle needs to
 * be told which Plots are sitting it out at the moment they press, not to
 * remember which ones they set loose in October.
 */
export const sittingOut = (plots) => (plots ?? [])
    .filter((p) => !followsTurn(p))
    .map((p) => ({ plotId: p.id, name: p.name, behaviour: behaviourOf(p) }));

/**
 * The Assets a given cycle moves the condition timers of.
 *
 * **Commitment is the join.** An Asset committed to a Plot keeps that Plot's
 * clock; an Asset committed to nothing keeps the world's, because it is sitting
 * in its owner's hand rather than in any one situation. Pass a plotId for a
 * Plot's own cycle, or null for the world's.
 *
 * Worth knowing while reading this: with the six conditions the module ships,
 * every timer runs on an Asset that is OUT of play — and setting an out-of-play
 * condition releases the Asset in the same write. So out of the box a running
 * timer belongs to no Plot and the world's cycle moves all of them. The scope
 * starts to bite the moment a GM invents an in-play condition with a timer
 * (*Rallying*, two Cycles, back to Ready), which the conditions table exists to
 * let them do.
 */
export function assetsOnTheClock(assets, plots, plotId = null) {
    if (plotId) return (assets ?? []).filter((a) => a.plotId === plotId);
    const off = new Set((plots ?? []).filter((p) => !followsTurn(p)).map((p) => p.id));
    return (assets ?? []).filter((a) => !a.plotId || !off.has(a.plotId));
}

/**
 * Everything one cycle advance changes, in one value the caller applies atomically.
 *
 * The Plots move too: every Plot on the world's clock takes the world's count, so
 * a Plot set loose later starts from the cycle it was last on rather than from
 * zero. The ones sitting out keep whatever count they had.
 *
 * @returns {{forces: object[], plots: object[], turn: {count: number},
 *            payments: object[], roster: object[], skipped: object[]}}
 */
export function advanceTurn({ forces, turn, plots = [] }) {
    const roster = incomeRoster(forces);
    const byId = new Map(roster.filter((r) => r.paid !== 0).map((r) => [r.forceId, r]));
    const count = Math.max(0, int(turn?.count) + 1);
    return {
        forces: (forces ?? []).map((f) => (byId.has(f.id)
            ? { ...f, resources: byId.get(f.id).to }
            : f)),
        plots: (plots ?? []).map((p) => (followsTurn(p) ? { ...p, turnCount: count } : p)),
        turn: { count },
        payments: [...byId.values()],
        roster,
        skipped: sittingOut(plots)
    };
}

/**
 * One Plot's own cycle. No purse moves: income is the world's business and stays
 * there, so this returns the Plot and nothing else.
 */
export const advancePlotTurn = (plot) => ({ ...plot, turnCount: Math.max(0, int(plot?.turnCount) + 1) });

// ── commitment ───────────────────────────────────────────────────────────────

/**
 * Where an Asset lands when it is committed.
 *
 * Committing to a Thread implies committing to that Thread's Plot — the two
 * fields are one act, and letting them drift apart would show an Asset on a
 * Thread belonging to a Plot it is not committed to. Passing null releases it.
 */
export function commitment(node = null, plot = null) {
    if (node) return { plotId: node.plotId ?? null, nodeId: node.id };
    if (plot) return { plotId: plot.id, nodeId: null };
    return { plotId: null, nodeId: null };
}

/**
 * Assets a Force owns that are not committed anywhere — what it has left to play.
 *
 * Out-of-play conditions are excluded, which is what keeps the tray honest: an
 * Asset that is Recovering or Destroyed is uncommitted for exactly the reason it
 * must not be offered as something to commit. It still appears in the Force panel,
 * because that is the GM's record of what they own rather than what they can spend.
 */
export const uncommittedAssets = (assets, forceId) => (assets ?? []).filter(
    (a) => a.forceId === forceId && !a.plotId && !a.nodeId && isInPlay(a)
);

/** What a Force has lost or set aside — drawn apart from what it still holds. */
export const setAsideAssets = (assets, forceId) =>
    (assets ?? []).filter((a) => a.forceId === forceId && isFinal(a));
