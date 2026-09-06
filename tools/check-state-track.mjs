import * as T from '../scripts/logic/state-track.mjs';
import { normalizePlot } from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nstate-track.mjs\n');

// Built through normalizePlot so the sort guarantee this module relies on is real,
// not something the fixture happens to satisfy.
const plot = (state, extra = {}) => normalizePlot({
    name: 'Invasion of Northwall', state,
    phases: [
        { id: 'p3', label: 'Rain of Fire', tone: 'danger', threshold: 75, gmNotes: 'secret' },
        { id: 'p0', label: 'Quiet', tone: 'calm', threshold: 0 },
        { id: 'p2', label: 'Critical', tone: 'warn', threshold: 50 },
        { id: 'p1', label: 'Tense', tone: 'neutral', threshold: 25 }
    ],
    ...extra
});

// ── which phase ──────────────────────────────────────────────────────────────
eq('at a threshold, that phase owns it', T.resolvePhase(plot(50)).label, 'Critical');
eq('mid-band resolves down', T.resolvePhase(plot(63)).label, 'Critical');
eq('one below a threshold stays in the lower band', T.resolvePhase(plot(49)).label, 'Tense');
eq('top band', T.resolvePhase(plot(999)).label, 'Rain of Fire');
eq('floor', T.resolvePhase(plot(0)).label, 'Quiet');
eq('below every threshold still names the floor', T.resolvePhase(plot(-40)).label, 'Quiet');
eq('no phases -> null', T.resolvePhase(normalizePlot({ state: 10 })), null);
eq('missing plot -> null', T.resolvePhase(undefined), null);

// ── the leak rule ────────────────────────────────────────────────────────────
eq('player projection carries only id/label/tone',
    Object.keys(T.resolvePhase(plot(80))).sort(), ['id', 'label', 'tone']);
eq('player projection never carries gmNotes',
    'gmNotes' in T.resolvePhase(plot(80)), false);
eq('GM projection does carry gmNotes', T.resolvePhaseForGM(plot(80)).gmNotes, 'secret');

// ── transitions ──────────────────────────────────────────────────────────────
eq('crossing up is detected', T.phaseTransition(plot(50), 30).changed, true);
eq('crossing up names both sides',
    [T.phaseTransition(plot(50), 30).from.label, T.phaseTransition(plot(50), 30).to.label],
    ['Tense', 'Critical']);
eq('crossing up has direction +1', T.phaseTransition(plot(50), 30).direction, 1);
eq('crossing down is detected', T.phaseTransition(plot(10), 60).changed, true);
eq('crossing down has direction -1', T.phaseTransition(plot(10), 60).direction, -1);
eq('moving within a band is not a crossing', T.phaseTransition(plot(60), 55).changed, false);
eq('standing still is not a crossing', T.phaseTransition(plot(60), 60).changed, false);
eq('a move within a band still has direction', T.phaseTransition(plot(60), 55).direction, 1);

// ── the bar ──────────────────────────────────────────────────────────────────
eq('default domain 0..100', T.statePercent(plot(47)), 47);
eq('clamped above max', T.statePercent(plot(140)), 100);
eq('clamped below min', T.statePercent(plot(-20)), 0);
eq('custom domain', T.statePercent(plot(5, { stateMin: 0, stateMax: 10 })), 50);
eq('signed domain', T.statePercent(plot(0, { stateMin: -50, stateMax: 50 })), 50);
eq('degenerate domain reads empty', T.statePercent(plot(5, { stateMin: 10, stateMax: 10 })), 0);
eq('inverted domain reads empty', T.statePercent(plot(5, { stateMin: 10, stateMax: 0 })), 0);
eq('out of range flagged', T.stateOutOfRange(plot(140)), true);
eq('in range not flagged', T.stateOutOfRange(plot(47)), false);

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
