# Remito Situation Room — Foundry VTT Module

A campaign-layer situation board for Foundry VTT **v14**.

Players see the **Plots** shaping their world, how far each has swung, and the **Threads** driving
them. The GM gets a cockpit for the **Forces** behind those Plots — spending Resources, committing
Assets, and pushing Threads to conclusion — plus fine control over exactly how much of any of it
the table is shown.

It is a layer above the scene, not inside it: nothing here touches an Actor, a token or a system
sheet. The whole board lives in world settings.

## Nomenclature

Five nouns carry the module. They are worth reading once before anything else.

| Word | What it is |
|---|---|
| **Plot** | One running situation — an invasion, an investigation, a treaty that may not hold. Carries a single number, its **State**. |
| **Phase** | A band along a Plot's State. Names what the situation is called while State sits inside it, and may open or shut Threads. |
| **Thread** | A moving part of a Plot: the thing being attempted. Fills toward a threshold; concluding one moves the Plot's State. |
| **Force** | A side with an agenda — an army, a guild, a hunger in the deep. Holds **Resources** and spends them to push Threads. |
| **Asset** | Something a Force can commit to a Thread: a battalion, a bought magistrate, a dragon who owes nobody anything. |

A **Cycle** is one turn of the campaign clock. **Segments** group Cycles into named runs, so the
board can read *The Siege · Cycle 2* rather than *Cycle 10*.

*(In the source, a Thread is a `node`, a Cycle is a `turn`, a Segment is a `chapter`, and Depleting
is `countdown`. `tools/check.mjs` enforces the split in both directions: the code words never reach
a reader, and the reader's words live only in `lang/en.json`.)*

## What it does

- **Four ways a Thread advances.** *Narrative* tracks nothing and concludes when the fiction says
  so. *Investment* is one shared pool any Force can pay into. *Clock* ticks discrete segments.
  *Contested* gives every Force its own separate pile.
- **Depleting.** Any Thread that keeps a number can be read downwards — eight weeks of rations
  falling to nothing rather than nothing climbing to eight. It is a reading, not a fifth mode:
  underneath, the pool still climbs. On a *Contested* Thread each side runs its own reserve down,
  which is how a war of attrition gets drawn.
- **Three independent gates.** A Thread can be shut by the GM's own switch, by a prerequisite that
  has not concluded, or by a Phase that names it under Locks. Any one is enough, none of it is
  stored, and a gate can reopen when State falls back.
- **Requirements.** A diagram beside the Thread list, laid out so no arrow doubles back, with the
  Threads waiting on nothing drawn underneath. Every card is a way back into the list.
- **Visibility that is actually enforced.** Every Plot, Thread, Force and Asset is *visible*,
  *masked* or *hidden*, with a separate switch for whether its numbers show. Withheld data never
  reaches a player's render context — it is gated at the funnel, not hidden in the markup. A masked
  Thread surrenders its mode chip too, because *contested* or *depleting* says most of what the
  mask exists to withhold.
- **As the table sees it.** One press redraws the whole board the way a player gets it, Help
  included. It is the same code path a player runs, not a second rendering of it.
- **Show Players.** The counterpart: opens the Situation Room on every connected player's screen,
  showing what you are showing. It reveals nothing — an open Plot travels only to the players who
  could already see it, judged on their own machines.
- **Forces and an economy.** Resources, per-Cycle income, a pause switch, Assets that discount or
  boost pushes, and a condition table you can rewrite.
- **Asset conditions.** Ready, Damaged, Suppressed, Inactive, Recovering, Destroyed — six defaults,
  not a vocabulary. Rename them, change what each does, delete the ones your campaign has no use
  for, add *Besieged* with whatever switches suit it.
- **A chronicle that writes itself.** Every push, conclusion, commitment and Cycle leaves a line,
  stamped with the Cycle it happened on. You decide per push how much of it the table reads.
- **Cycles, per Plot.** A Plot can ride the world's clock, keep one of its own — for the journey
  counted in months that should not move three days every time a siege counted in weeks does — or
  keep none at all. Every Cycle can be reverted while it is still the last thing that happened.
- **Phase notes that fire.** A note you write on a Phase is put in front of you the moment State
  crosses into it, from either direction, and never rendered on anyone else's screen.
- **Deletes that say what they cost.** Every delete confirmation lists what else moves — which
  Assets come loose and whose, which Threads it lets open, which Phases lose a line, and, for a
  Force, exactly which of its Assets are being destroyed outright with no refund.
- **An example campaign.** *Generate Example* builds a two-Plot fixture exercising all four modes,
  a prerequisite chain, a Phase crossing in both directions, and every visibility state.
  *Remove Example* takes back exactly what it made and nothing else.

## Installation

1. Copy (or symlink) this folder into `{Foundry Data}/Data/modules/remito-situation-room`.
   The folder name **must** match the `id` in `module.json`.
   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\remito-situation-room" `
     -Target "<path to this repo>"
   ```
2. In Foundry → **Add-on Modules**, enable **Remito Situation Room**.
3. Reload the world.

Or install from the manifest URL:
`https://raw.githubusercontent.com/el-remito/remito-situation-room/main/module.json`

## Usage

Open the board from the **Situation Room** button at the top of the **Journal** tab. Players land
on the Situation view; a GM chooses between that and the Cockpit.

New to it: open **Help → Generate Example**, look around, then **Remove Example**. It leaves the
world exactly as it found it.

The Help tab is the real documentation. It has nine sections, and every one is written twice —
once for the GM and once for the table — so what a player reads about masking is what a player
would actually want to know about it.

## Requirements

- Foundry VTT **v14** (verified 14.365)
- No system requirement. Nothing here reads a system's data model.

## For developers

No build step, no bundler, no dependencies. Plain ES modules loaded straight from `module.json`;
the repo root *is* the module folder.

```
situation-room.mjs        entry point — hooks, template preload, the module API
scripts/
  constants.mjs           MODULE_ID, SETTINGS, TEMPLATES, every enum
  settings.mjs            the ONLY place game.settings is touched
  data/
    state.mjs             the ONLY writer; every operation lives here
    relay.mjs             the ONLY place game.socket is touched
    normalize.mjs         read-time shape repair
    example-plot.mjs      the Help tab's fixture
  logic/                  pure, node-importable, Foundry-free
  ui/                     the Foundry-shaped edges of the logic layer
  apps/                   ApplicationV2 windows
templates/                Handlebars — every partial preloaded in the entry point
tools/                    the checks, run with node
```

Three rules hold the shape:

1. **Single funnels.** `game.settings` only in `settings.mjs`; `game.socket` only in `relay.mjs`;
   `state.mjs` is the only writer. `tools/check.mjs` enforces all three.
2. **`logic/` is pure.** No Foundry globals, no DOM, importable by `node` — which is what makes it
   testable at all, since there is no test runner and no headless Foundry.
3. **Code word ≠ UI word.** See Nomenclature above.

```bash
node tools/all.mjs      # every logic suite
node tools/check.mjs    # nine static passes over the whole repo
```

Everything else is verified by hand, in a world. There is no HMR: reload Foundry.

## Licence

See [LICENSE](LICENSE).
