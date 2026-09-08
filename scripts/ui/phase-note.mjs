/**
 * The GM's own note for a Phase, delivered at the moment the board enters it.
 *
 * A Phase note is the one piece of the board that is written to be READ LATER.
 * Everything else a GM authors is on screen the moment it matters — a threshold
 * is visible in the ladder, a lock is visible on the row it shuts. A note sits
 * in the Plot editor, three screens away from the push that makes it true, and a
 * note nobody is reminded of is a note nobody wrote.
 *
 * WHY THIS WATCHES THE VALUE INSTEAD OF THE WRITE. The obvious build hangs the
 * announcement off `node.conclude`, which is where the crossing usually happens.
 * But State also moves when a conclusion is reopened, when the GM types a number
 * into the Plot editor, and when an outcome is corrected — and an announcement
 * wired to one operation is silent for the other three. So this watches the
 * stored Plots the same way ui/refresh.mjs watches them: through the setting's
 * own onChange, which every write passes through by construction. The data layer
 * stays free of UI, and a second GM at the table is told at the same moment as
 * the first.
 *
 * WHY IT FIRES IN BOTH DIRECTIONS. A note is not a report of an event; it is a
 * description of the situation the board is in. *"Siege lines visible from the
 * wall"* is true whenever State sits in that band, however it got there. Firing
 * only on the way up would go quiet exactly when a GM corrects a mistake and
 * most needs to know where the board actually stands.
 *
 * WHY IT WRITES NOTHING. No chronicle line, for the reason M6 derived the gates
 * rather than storing them: a Phase is resolved on every read, so a line naming
 * one goes stale the first time a threshold is edited, and the board would be
 * left explaining itself by a Phase it is no longer in. The conclusion that
 * moved State has already written its own line.
 *
 * The opt-out is the note itself: a Phase with nothing written under GM notes
 * announces nothing, so a GM who does not want to be interrupted simply leaves
 * it empty.
 */

import { phaseTransition } from '../logic/state-track.mjs';

/** plotId → the State this client last saw it on. Per client, never stored. */
const seen = new Map();

const L = (key) => game.i18n.localize(key);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

/**
 * Remember where every Plot stands without saying anything about it.
 *
 * Called once at `ready`, and again for any Plot this client has never seen — a
 * Plot that has just been created, or the whole board arriving from Generate
 * Example. Without the seed the FIRST crossing after a reload would be swallowed
 * as a first sighting, which is the one crossing a GM is most likely to be
 * waiting for.
 */
export function seedPhaseWatch(plots) {
    for (const plot of plots ?? []) seen.set(plot.id, plot.state ?? 0);
}

/**
 * Say what the GM wrote, for every Plot that has just entered a new Phase.
 *
 * One dialog for the whole change rather than one per Plot: a single edit can
 * move more than one Plot, and a stack of modals is a thing to dismiss rather
 * than a thing to read.
 */
export async function announcePhaseCrossings(plots) {
    if (!game.user?.isGM) return;

    const crossed = [];
    for (const plot of plots ?? []) {
        const before = seen.get(plot.id);
        seen.set(plot.id, plot.state ?? 0);
        if (before === undefined) continue;                 // first sighting seeds only

        const move = phaseTransition(plot, before);
        if (!move.changed) continue;
        if (!move.to?.gmNotes?.trim()) continue;            // nothing written, nothing to say
        crossed.push({ plot, move });
    }
    if (crossed.length === 0) return;

    // Plots that no longer exist have nothing to announce and nothing to remember.
    for (const id of [...seen.keys()]) {
        if (!(plots ?? []).some((p) => p.id === id)) seen.delete(id);
    }

    const { DialogV2 } = foundry.applications.api;
    await DialogV2.prompt({
        window: { title: L('RSR.phase.noteTitle') },
        classes: ['daggerheart', 'dh-style', 'rsr', 'rsr-phase-note'],
        content: crossed.map(card).join(''),
        ok: { label: L('RSR.phase.noted'), icon: 'fa-solid fa-check' },
        rejectClose: false
    });
}

/**
 * One crossing, as markup.
 *
 * The Phase being left is named as well as the one being entered, because the
 * note answers "what now" and the GM needs the "from" to know whether the board
 * climbed or fell — a Plot can arrive in *Refugees on the road* from either side
 * and the two mean opposite things.
 */
function card({ plot, move }) {
    const heading = move.from
        ? game.i18n.format('RSR.phase.crossedFrom', {
            plot: `<strong>${esc(plot.name)}</strong>`,
            from: esc(move.from.label),
            to: `<strong>${esc(move.to.label)}</strong>`
        })
        : game.i18n.format('RSR.phase.crossedInto', {
            plot: `<strong>${esc(plot.name)}</strong>`,
            to: `<strong>${esc(move.to.label)}</strong>`
        });

    // The tone rides as an attribute rather than the .rsr-tone-* chip classes,
    // which set `color` — on a chip that paints one word that is right, on a
    // card it would paint the GM's whole note red.
    return `<section class="rsr-note-card" data-tone="${esc(move.to.tone)}">
        <p class="rsr-note-crossed">${heading}</p>
        <p class="rsr-note-body">${esc(move.to.gmNotes).replace(/\n+/g, '<br>')}</p>
        <p class="rsr-note-aside">${L('RSR.phase.yoursAlone')}</p>
    </section>`;
}
