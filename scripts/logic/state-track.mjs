/**
 * The State track: where a Plot's single State value sits, and which Phase that
 * puts it in.
 *
 * Pure. No Foundry globals, no DOM. `node`-importable, and exercised by
 * tools/check-state-track.mjs.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: only the CURRENT Phase is ever resolved
 * for display. Rendering the whole ladder would tell a player there is a "Rain of
 * Fire" Phase coming and roughly how far off it is — exactly the information the
 * GM's masking controls exist to withhold. So resolvePhase returns one
 * {label, tone} and nothing else, and a player's render context must carry that
 * rather than plot.phases. The GM sees the full ladder in the Plot editor, where
 * they authored it.
 */

/** A Phase owns the band from its own threshold up to the next one. */
export function phaseFor(phases, state) {
    if (!Array.isArray(phases) || phases.length === 0) return null;

    // normalize.mjs guarantees these arrive sorted ascending by threshold.
    let found = null;
    for (const phase of phases) {
        if (state >= phase.threshold) found = phase;
        else break;
    }

    // Below every threshold: the lowest Phase still names the floor of the track.
    return found ?? phases[0];
}

/**
 * The one Phase a view may show. Deliberately returns a flat projection rather
 * than the Phase object — gmNotes and the reveal/lock lists must not ride along
 * into a player's context by accident.
 */
export function resolvePhase(plot) {
    const phase = phaseFor(plot?.phases, plot?.state ?? 0);
    if (!phase) return null;
    return { id: phase.id, label: phase.label, tone: phase.tone };
}

/** The GM-only half: the same Phase, with the notes attached. */
export function resolvePhaseForGM(plot) {
    const phase = phaseFor(plot?.phases, plot?.state ?? 0);
    if (!phase) return null;
    return {
        id: phase.id, label: phase.label, tone: phase.tone,
        gmNotes: phase.gmNotes,
        revealNodeIds: phase.revealNodeIds,
        lockNodeIds: phase.lockNodeIds
    };
}

/**
 * What changed when State moved. M6 hangs reveal/lock on this and M7 hangs the
 * phase notes on it, so it reports both sides of the move rather than just the
 * arrival.
 *
 * @returns {{from: object|null, to: object|null, changed: boolean, direction: number}}
 */
export function phaseTransition(plot, previousState) {
    const phases = plot?.phases ?? [];
    const from = phaseFor(phases, previousState ?? 0);
    const to = phaseFor(phases, plot?.state ?? 0);
    return {
        from,
        to,
        changed: (from?.id ?? null) !== (to?.id ?? null),
        direction: Math.sign((plot?.state ?? 0) - (previousState ?? 0))
    };
}

/**
 * How full the bar is, 0..1.
 *
 * The track needs an explicit domain: State is a signed number the GM chooses the
 * meaning of, so there is nothing to infer a maximum from. stateMin/stateMax are
 * plot fields with sane defaults rather than something derived from the Phase
 * thresholds — deriving would make the bar jump every time a Phase is added.
 */
export function stateFraction(plot) {
    const min = plot?.stateMin ?? 0;
    const max = plot?.stateMax ?? 100;
    const span = max - min;
    if (span <= 0) return 0;                        // a degenerate range reads as empty
    const clamped = Math.min(max, Math.max(min, plot?.state ?? 0));
    return (clamped - min) / span;
}

/** Percentage for a style attribute, rounded so the DOM does not churn on tiny deltas. */
export const statePercent = (plot) => Math.round(stateFraction(plot) * 100);

/** True when State sits outside the declared range — the GM has some tidying to do. */
export const stateOutOfRange = (plot) => {
    const state = plot?.state ?? 0;
    return state < (plot?.stateMin ?? 0) || state > (plot?.stateMax ?? 100);
};
