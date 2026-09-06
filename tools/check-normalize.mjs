import * as N from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nnormalize.mjs — fed deliberately malformed data\n');

const p = N.normalizePlot({
    name: 'Invasion of Northwall', state: '47', lifecycle: 'bogus',
    phases: [{ label: 'Rain of Fire', threshold: 80 }, { label: 'Quiet', threshold: 0 }],
    forceIds: ['f1', 'f1', '', null, 'f2']
});
eq('numeric string state coerced', p.state, 47);
eq('bad lifecycle falls back to active', p.lifecycle, 'active');
eq('phases sorted by threshold', p.phases.map((x) => x.label), ['Quiet', 'Rain of Fire']);
eq('forceIds deduped and cleaned', p.forceIds, ['f1', 'f2']);
eq('entity base applied', [p.visibility, p.hideValues, p.isExample], ['visible', false, false]);

const n = N.normalizeNode({
    threshold: -5, segments: 0, mode: 'nonsense',
    progress: { pool: 'x', byForce: { f1: '6', '': 9 } },
    outcomes: [{ forceId: 'f1', delta: '15' }, { delta: 3 }],
    status: 'concluded', concludedBy: ''
});
eq('threshold clamped to >= 1', n.threshold, 1);
eq('segments clamped to >= 1', n.segments, 1);
eq('unknown mode becomes null (inherit)', n.mode, null);
eq('non-numeric pool -> 0', n.progress.pool, 0);
eq('byForce coerced, empty key dropped', n.progress.byForce, { f1: 6 });
eq('outcome without forceId dropped', n.outcomes, [{ forceId: 'f1', delta: 15, note: '' }]);
eq('empty concludedBy -> null', n.concludedBy, null);

const a = N.normalizeAsset({ name: '437th Infantry', modifier: { kind: 'wrong', value: '2' } });
eq('bad modifier kind falls back', a.modifier, { kind: 'costReduction', value: 2 });
eq('absent uuid is null not undefined', a.uuid, null);

const f = N.normalizeForce({ tags: [{ text: 'Siegecraft' }, { text: '' }, { polarity: 'weakness' }, 'junk'] });
eq('empty and non-object tags dropped', f.tags, [{ text: 'Siegecraft', polarity: 'strength' }]);

eq('undefined collection -> []', N.normalizePlots(undefined), []);
eq('junk entries filtered', N.normalizeAssets([{ name: 'x' }, 'junk', null]).length, 1);
eq('null turn -> count 0', N.normalizeTurn(null), { count: 0 });
eq('negative turn clamped', N.normalizeTurn({ count: -3 }), { count: 0 });

const withId = N.normalizePlot({ id: 'keep-me' });
eq('existing id preserved', withId.id, 'keep-me');
eq('missing id generated', N.normalizePlot({}).id.length > 0, true);

console.log(`\n${fail === 0 ? '  all passed' : `  ${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
