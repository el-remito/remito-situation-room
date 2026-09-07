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
 */

import { LIFECYCLE } from '../constants.mjs';
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

/**
 * Everything one cycle advance changes, in one value the caller applies atomically.
 *
 * @returns {{forces: object[], turn: {count: number}, payments: object[], roster: object[]}}
 */
export function advanceTurn({ forces, turn }) {
    const roster = incomeRoster(forces);
    const byId = new Map(roster.filter((r) => r.paid !== 0).map((r) => [r.forceId, r]));
    return {
        forces: (forces ?? []).map((f) => (byId.has(f.id)
            ? { ...f, resources: byId.get(f.id).to }
            : f)),
        turn: { count: Math.max(0, int(turn?.count) + 1) },
        payments: [...byId.values()],
        roster
    };
}

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
