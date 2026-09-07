#!/usr/bin/env node
/**
 * logic/editing.mjs — the in-board editors' draft. `node tools/check-editing.mjs`
 *
 * The editors are a lot of markup wrapped around a little logic, and this is the
 * little logic: what a draft starts as, what Save hands to the world, and what the
 * structural buttons do. Two properties matter more than the rest and are checked
 * hardest — a mutation never touches the draft it was given, and a patch never
 * carries a field its editor does not own.
 */

import * as E from '../scripts/logic/editing.mjs';
import {
    EDIT_KIND, POLARITY, ASSET_MODIFIER, VISIBILITY, NODE_STATUS, DEFAULT_CONDITIONS
} from '../scripts/constants.mjs';
import { normalizePlot, normalizeNode, normalizeForce, normalizeAsset } from '../scripts/data/normalize.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\nediting.mjs\n');

const K = {
    forceResources: 5, forceIncome: 3, forceIcon: 'fa-solid fa-coins', assetCost: 2,
    threadThreshold: 9, clockSegments: 6, stateMin: 0, stateMax: 100,
    defaultVisibility: { plot: 'hidden', node: 'masked', force: 'visible', asset: 'hidden' }
};

const LEGION = 'f-legion';
const GUARD = 'f-guard';
const ENVOY = 'f-envoy';

const plot = normalizePlot({
    id: 'p1', name: 'Northwall', description: 'A siege.',
    state: 58, stateMin: 0, stateMax: 100,
    phases: [{ id: 'ph1', label: 'Quiet', tone: 'calm', threshold: 0, description: 'seen', gmNotes: 'mine' }],
    forceIds: [LEGION, GUARD, ENVOY],
    forceGroups: { [LEGION]: 'The Besiegers', [GUARD]: 'The Defenders' }
});

// ── a draft is a working copy of the fields one editor owns ──────────────────
const d = E.draftFrom(EDIT_KIND.PLOT, plot, K);
eq('a draft carries the entity', [d.name, d.state, d.lifecycle], ['Northwall', 58, 'active']);
eq('a draft carries the Phases', d.phases.length, 1);
eq('a Phase keeps both texts', [d.phases[0].description, d.phases[0].gmNotes], ['seen', 'mine']);
eq('a Phase keeps its M6 lists', [d.phases[0].revealNodeIds, d.phases[0].lockNodeIds], [[], []]);
eq('headings come in roster order', d.groups, ['The Besiegers', 'The Defenders']);
eq('a draft owns no id', 'id' in d, false);
eq('a draft owns no progress', 'sort' in d, false);

const blank = E.draftFrom(EDIT_KIND.PLOT, null, K);
eq('a blank Plot takes the world State range', [blank.stateMin, blank.stateMax], [0, 100]);
eq('a blank Plot takes its visibility default', blank.visibility, 'hidden');
eq('a blank Plot has no Forces', [blank.forceIds, blank.groups], [[], []]);

const blankNode = E.draftFrom(EDIT_KIND.NODE, null, K, { plotId: 'p1' });
eq('a blank Thread knows its Plot', blankNode.plotId, 'p1');
eq('a blank Thread takes the world threshold', blankNode.threshold, 9);
eq('a blank Thread inherits its mode', blankNode.mode, null);
eq('a blank Thread takes its own visibility default', blankNode.visibility, 'masked');

const blankForce = E.draftFrom(EDIT_KIND.FORCE, null, K);
eq('a blank Force takes the world purse', [blankForce.resources, blankForce.income], [5, 3]);
eq('a blank Force takes the world icon', blankForce.icon, 'fa-solid fa-coins');
eq('a new Force draws income', blankForce.isActive, true);
eq('a paused Force stays paused', E.draftFrom(EDIT_KIND.FORCE,
    normalizeForce({ name: 'x', isActive: false }), K).isActive, false);

const asset = normalizeAsset({
    id: 'a1', forceId: LEGION, name: 'Battalion',
    modifier: { kind: ASSET_MODIFIER.COST_REDUCTION, value: 2 },
    tags: [{ text: 'Veterans', polarity: POLARITY.STRENGTH }]
});
const dAsset = E.draftFrom(EDIT_KIND.ASSET, asset, K);
eq('an Asset draft flattens its modifier',
    [dAsset.modifierKind, dAsset.modifierValue], ['costReduction', 2]);
eq('a blank Asset does nothing by default',
    E.draftFrom(EDIT_KIND.ASSET, null, K, { forceId: LEGION }).modifierKind, ASSET_MODIFIER.NONE);

// ── what Save hands over ─────────────────────────────────────────────────────
const patch = E.patchFrom(EDIT_KIND.PLOT, d);
eq('the patch carries the roster', patch.forceIds, [LEGION, GUARD, ENVOY]);
eq('the patch carries only real headings', patch.forceGroups,
    { [LEGION]: 'The Besiegers', [GUARD]: 'The Defenders' });
eq('the patch drops the draft-only heading list', 'groups' in patch, false);
eq('the patch owns no progress or sort', ['sort' in patch, 'id' in patch], [false, false]);

const halfWritten = E.addPhase(d);
eq('an unlabelled Phase is not saved', E.patchFrom(EDIT_KIND.PLOT, halfWritten).phases.length, 1);
eq('a labelled Phase is', E.patchFrom(EDIT_KIND.PLOT,
    { ...halfWritten, phases: halfWritten.phases.map((p) => ({ ...p, label: p.label || 'New' })) }
).phases.length, 2);
eq('a saved Phase keeps its id', E.patchFrom(EDIT_KIND.PLOT, d).phases[0].id, 'ph1');
eq('a new Phase has no id to keep', 'id' in E.patchFrom(EDIT_KIND.PLOT,
    { ...halfWritten, phases: [{ ...halfWritten.phases[1], label: 'New' }] }).phases[0], false);

const node = E.draftFrom(EDIT_KIND.NODE, normalizeNode({
    id: 'n1', plotId: 'p1', name: 'Siege', status: NODE_STATUS.ACTIVE,
    outcomes: [
        { forceId: LEGION, delta: 15, note: 'engines land' },
        { forceId: GUARD, delta: 0, note: '' }
    ]
}), K);
eq('an outcome that says nothing is not saved',
    E.patchFrom(EDIT_KIND.NODE, node).outcomes.map((o) => o.forceId), [LEGION]);
eq('a note alone is an outcome', E.patchFrom(EDIT_KIND.NODE,
    E.setOutcome(node, GUARD, { note: 'the breach holds' })).outcomes.length, 2);

const force = E.draftFrom(EDIT_KIND.FORCE, normalizeForce({ id: LEGION, name: 'Legion' }), K);
eq('an empty tag is not saved',
    E.patchFrom(EDIT_KIND.FORCE, { ...force, tags: [{ text: '  ', polarity: 'strength' }] }).tags, []);
eq('a name is trimmed on the way out',
    E.patchFrom(EDIT_KIND.FORCE, { ...force, name: '  Legion  ' }).name, 'Legion');
eq('an Asset patch rebuilds its modifier',
    E.patchFrom(EDIT_KIND.ASSET, dAsset).modifier, { kind: 'costReduction', value: 2 });

// ── the Save bar's count ─────────────────────────────────────────────────────
eq('an untouched draft is clean', E.dirtyKeys(d, d), []);
eq('one changed field counts once', E.dirtyKeys(d, { ...d, name: 'Other' }), ['name']);
eq('two count twice', E.dirtyKeys(d, { ...d, name: 'Other', state: 1 }).length, 2);
eq('an empty heading is not a change', E.dirtyKeys(d, E.addGroup(d, 'The Relief Column')), []);
eq('a Phase edit counts', E.dirtyKeys(d, E.addPhase(d)), ['phases']);

// ── what stops a Save ────────────────────────────────────────────────────────
eq('a Plot needs a name', E.problems(EDIT_KIND.PLOT, { ...d, name: '' }), ['name']);
eq('a named Plot is fine', E.problems(EDIT_KIND.PLOT, d), []);
eq('a State range must have room',
    E.problems(EDIT_KIND.PLOT, { ...d, stateMin: 50, stateMax: 50 }), ['stateRange']);
eq('an Asset needs an owner',
    E.problems(EDIT_KIND.ASSET, { ...dAsset, forceId: '' }), ['forceId']);

// ── Phases ───────────────────────────────────────────────────────────────────
const two = E.addPhase(d);
eq('adding a Phase appends one', two.phases.length, 2);
eq('a new Phase clears the highest threshold', two.phases[1].threshold, 10);
eq('the first Phase of all starts at zero', E.addPhase(blank).phases[0].threshold, 0);
eq('removing takes the one named', E.removePhase(two, 0).phases[0].threshold, 10);
eq('adding a Phase does not touch the draft it was given', d.phases.length, 1);

// ── tags ─────────────────────────────────────────────────────────────────────
let f = E.addTag(force, POLARITY.STRENGTH, 'Siegecraft');
f = E.addTag(f, POLARITY.WEAKNESS, 'Overextended');
eq('tags land under their polarity',
    f.tags.map((t) => [t.polarity, t.text]),
    [['strength', 'Siegecraft'], ['weakness', 'Overextended']]);
eq('a blank tag is ignored', E.addTag(f, POLARITY.STRENGTH, '   ').tags.length, 2);
eq('a duplicate tag is ignored', E.addTag(f, POLARITY.STRENGTH, 'Siegecraft').tags.length, 2);
eq('the same text under the other polarity is not a duplicate',
    E.addTag(f, POLARITY.WEAKNESS, 'Siegecraft').tags.length, 3);
eq('a tag is trimmed', E.addTag(force, POLARITY.STRENGTH, '  Siegecraft  ').tags[0].text, 'Siegecraft');
// The index is per column, because that is how the chips are rendered.
const three = E.addTag(f, POLARITY.STRENGTH, 'Discipline');
eq('removing uses the index within its own column',
    E.removeTag(three, POLARITY.STRENGTH, 0).tags.map((t) => t.text),
    ['Overextended', 'Discipline']);

// ── prerequisites ────────────────────────────────────────────────────────────
eq('a prerequisite is added once',
    E.addPrereq(E.addPrereq(node, 'n2'), 'n2').prereqNodeIds, ['n2']);
eq('a prerequisite is removed', E.removePrereq(E.addPrereq(node, 'n2'), 'n2').prereqNodeIds, []);
eq('adding a prerequisite does not touch the draft it was given', node.prereqNodeIds, []);

// ── the roster ───────────────────────────────────────────────────────────────
const added = E.addForceToPlot(blank, LEGION, 'The Besiegers');
eq('adding puts the Force on the Plot', added.forceIds, [LEGION]);
eq('adding with a heading creates the heading', added.groups, ['The Besiegers']);
eq('adding twice is once', E.addForceToPlot(added, LEGION, 'x').forceIds, [LEGION]);
eq('removing takes its heading with it',
    [E.removeForceFromPlot(added, LEGION).forceIds,
     E.removeForceFromPlot(added, LEGION).forceGroups], [[], {}]);

eq('a Force can be regrouped', E.setForceGroup(d, GUARD, 'The Besiegers').forceGroups[GUARD],
    'The Besiegers');
eq('regrouping to a new heading creates it',
    E.setForceGroup(d, GUARD, 'The Relief Column').groups.includes('The Relief Column'), true);
eq('regrouping to nothing un-groups', GUARD in E.setForceGroup(d, GUARD, '').forceGroups, false);
eq('a heading is trimmed', E.setForceGroup(d, ENVOY, '  Envoys ').forceGroups[ENVOY], 'Envoys');
eq('a Force not on the Plot cannot be grouped',
    E.setForceGroup(d, 'f-nobody', 'x').forceGroups['f-nobody'], undefined);

const emptied = E.removeGroup(d, 'The Besiegers');
eq('deleting a heading keeps its Forces on the Plot', emptied.forceIds.length, 3);
eq('deleting a heading un-groups them', LEGION in emptied.forceGroups, false);
eq('deleting a heading drops the column', emptied.groups, ['The Defenders']);

// ── the columns the editor renders ───────────────────────────────────────────
const cols = E.rosterColumns(d);
eq('one column per heading, then the unheaded bucket',
    cols.map((c) => c.label), ['The Besiegers', 'The Defenders', '']);
eq('members land in their column', cols[0].forceIds, [LEGION]);
eq('the unheaded bucket holds the rest', cols[2].forceIds, [ENVOY]);
eq('the unheaded bucket renders even when empty',
    E.rosterColumns(added).map((c) => c.label), ['The Besiegers', '']);
eq('an empty heading still renders, so it can be dropped into',
    E.rosterColumns(E.addGroup(blank, 'New Front')).map((c) => c.label), ['New Front', '']);

// ── coercion, as the form hands values back ──────────────────────────────────
eq('a number field truncates', E.coerce('int', '3.7'), 3);
eq('a junk number is zero', E.coerce('int', 'lots'), 0);
eq('an unchecked box is false', E.coerce('bool', undefined), false);
eq('a checked box is true', E.coerce('bool', true), true);
eq('an empty inherit-select is null', E.coerce('nullable', ''), null);
eq('a chosen inherit-select is its value', E.coerce('nullable', 'clock'), 'clock');
eq('a missing text field is empty', E.coerce('text', null), '');

// ── the field spec covers what the draft holds ───────────────────────────────
for (const [kind, spec] of Object.entries(E.FIELDS)) {
    const draft = E.draftFrom(kind, null, K, { plotId: 'p1', forceId: LEGION });
    const missing = spec.filter((f) => !(f.name in draft)).map((f) => f.name);
    eq(`every ${kind} field exists on its draft`, missing, []);
}
// The condition table is the one edit screen that is not a row, so it is the one
// with no audience to set: it has no fields at all, only repeating ones.
eq('visibility is editable on all four ENTITIES',
    Object.entries(E.FIELDS)
        .filter(([kind]) => kind !== EDIT_KIND.CONDITIONS)
        .every(([, spec]) => spec.some((f) => f.name === 'visibility')), true);
eq('the condition table owns no scalar fields', E.FIELDS[EDIT_KIND.CONDITIONS], []);

// ── the condition table draft ────────────────────────────────────
const table = E.draftFrom(EDIT_KIND.CONDITIONS, null, K, { rows: DEFAULT_CONDITIONS });
eq('the table drafts every row', table.rows.length, DEFAULT_CONDITIONS.length);
eq('ready is protected from deletion',
    table.rows.find((r) => r.id === 'ready').isProtected, true);
eq('nothing else is', table.rows.filter((r) => r.isProtected).length, 1);
eq('the module’s own rows are marked as built in',
    table.rows.every((r) => r.isBuiltIn), true);

const withInvented = E.addCondition(table, 'besieged');
eq('a new row lands at the end', withInvented.rows.at(-1).id, 'besieged');
eq('a new row is not a built-in', withInvented.rows.at(-1).isBuiltIn, false);
eq('deleting a row drops it', E.removeCondition(withInvented, 'besieged').rows.length, table.rows.length);
eq('deleting ready does nothing at all',
    E.removeCondition(table, 'ready').rows.length, table.rows.length);

const mangled = { ...table, rows: table.rows.filter((r) => r.id !== 'damaged') };
const restored = E.restoreConditionDefaults(E.addCondition(mangled, 'besieged'));
eq('restoring puts a deleted built-in back',
    restored.rows.some((r) => r.id === 'damaged'), true);
eq('restoring keeps what the GM invented',
    restored.rows.some((r) => r.id === 'besieged'), true);

eq('the saved rows carry their order', E.conditionRows(table).map((r) => r.sort),
    table.rows.map((_, i) => i));
eq('the saved rows drop the derived flags',
    Object.keys(E.conditionRows(table)[0]).includes('isBuiltIn'), false);
// Recovering becomes Ready. With Ready gone from the table, that successor is
// dropped on save rather than left to resolve to the fallback at read time.
eq('a successor pointing at a row that is no longer there is dropped on save',
    E.conditionRows({ ...table, rows: table.rows.filter((r) => r.id !== 'ready') })
        .find((r) => r.id === 'recovering').becomes,
    '');
eq('what the GM deleted is reported for rehoming',
    E.droppedConditions(table, mangled), ['damaged']);
eq('nothing deleted reports nothing', E.droppedConditions(table, table), []);

// ── what the table sees survives the Save ────────────────────────────────────
// The field-list checks above prove the editor OWNS these; they say nothing
// about whether patchFrom carries them, and a field that is edited and then
// dropped on the way to the world is the quieter half of that bug. It happened:
// maskLabel and maskNote were added to FIELDS and to the drafts, and Save threw
// them away until this ran.
for (const kind of [EDIT_KIND.PLOT, EDIT_KIND.NODE, EDIT_KIND.FORCE, EDIT_KIND.ASSET]) {
    const draft = E.draftFrom(kind, null, {}, { plotId: 'p', forceId: 'f' });
    const patch = E.patchFrom(kind, draft);
    const owned = E.FIELDS[kind].map((f) => f.name)
        // The modifier is the one field the form splits in two and the patch
        // puts back together, so it is named differently on each side.
        .filter((n) => !n.startsWith('modifier'));
    eq(`every ${kind} field the form owns survives patchFrom`,
        owned.filter((n) => !(n in patch)), []);
}

eq('a mask name of spaces saves as the default, not as spaces',
    E.patchFrom(EDIT_KIND.NODE,
        { ...E.draftFrom(EDIT_KIND.NODE, null, {}, { plotId: 'p' }), maskLabel: '   ' }
    ).maskLabel, '');
eq('a mask note keeps its sentence',
    E.patchFrom(EDIT_KIND.NODE,
        { ...E.draftFrom(EDIT_KIND.NODE, null, {}, { plotId: 'p' }), maskNote: ' heard it ' }
    ).maskNote, 'heard it');

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
