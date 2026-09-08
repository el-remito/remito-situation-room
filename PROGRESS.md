# Remito Situation Room — Build Progress

Run `node progress.mjs` for a rendered view. Checkboxes below are the source of truth.

**Gate:** each milestone stops for the user to verify in Foundry. On an explicit pass it is
committed as one commit, and only then does the next milestone start. Nothing is committed
before its milestone has passed.

| Milestone | Verified | Committed |
|---|---|---|
| M1 | passed | `1d9bd86` |
| M2 | passed | `334d7b9` |
| M3 | passed | `157d998` |
| M4 | passed | `0d9f955` |
| M5 | passed | `5ab911d` |
| M5.5 | passed | `fbf8a2d` |
| M6 | passed | `228b0df` |
| M6.5 | passed | `824ab99` |
| M7 | passed | `ca52a66` |

## M1 — Scaffold and data spine
- [x] `module.json` (socket: true from the first commit)
- [x] `scripts/constants.mjs` — MODULE_ID, PREFIX, SETTINGS, TEMPLATES, enums
- [x] `scripts/settings.mjs` — the ONLY place `game.settings` is touched
- [x] `scripts/data/normalize.mjs` — read-time shape repair
- [x] `scripts/data/state.mjs` — the ONLY writer; all CRUD
- [x] `scripts/data/relay.mjs` — GM-executes-on-behalf socket relay
- [x] `scripts/ui/refresh.mjs` — onChange fan-out to open instances
- [x] `scripts/ui/sidebar-button.mjs` — Journal tab injection
- [x] `scripts/apps/situation-room.mjs` — window shell, 3-segment header toggle
- [x] `templates/situation-room.hbs` — shell
- [x] `styles/situation-room.css` — token block
- [x] `lang/en.json` — RSR.* namespace (the only place "Thread" appears)
- [x] `situation-room.mjs` — entry point
- [x] `tools/check.mjs` — static passes (imports, i18n, data-action, naming)
- [x] `tools/check-normalize.mjs` — 21 shape-repair assertions
- [x] Junctioned into the live Foundry install

## M2 — Plots and Threads
- [x] Plot CRUD editor
- [x] Thread CRUD editor
- [x] Player View: Plot list
- [x] Player View: drill into one Plot's Thread board
- [x] State bar — plain fill + single current-Phase chip (no ladder)
- [x] Thread rows with progress bars
- [x] Helper shell + first example fixture (Generate / Remove)
- [x] `logic/state-track.mjs` — 28 assertions
- [x] `logic/visibility.mjs` — 26 assertions (pulled forward from M5)
- [x] `tools/all.mjs` runner + single-funnel static pass

## M3 — Advancement and conclusion
- [x] `logic/progress.mjs` — thresholds, pools, contest standings
- [x] Mode: fiat
- [x] Mode: invest
- [x] Mode: clock
- [x] Mode: contested
- [x] Plot default + per-Thread override
- [x] Per-Force outcomes
- [x] Conclude flow (`DialogV2.prompt`, a radio row per Force)
- [x] Reopen, reversing the delta actually applied
- [x] Asset modifiers feed the effective threshold
- [x] `tools/check-progress.mjs` — 40 assertions
- [x] Syntax-parse static pass
- [x] Scroll/focus preserved across a push (PARTS `scrollable`)

## M4 — Forces, Resources, Assets
- [x] `logic/economy.mjs` — spending, income, commitment
- [x] Cockpit: Force panels, purse, roster, strengths/weaknesses
- [x] Force CRUD editor
- [x] GM fiat resource adjust (±1 on the panel, dialog for the rest)
- [x] Pushing a Thread in a Force's name spends that Force's Resources
- [x] Advance Turn pays Active Plots only, with the bill shown first
- [x] Assets CRUD + optional UUID link
- [x] Asset drag-to-commit onto a Thread, drag-back to release
- [x] Document drop: onto an Asset links it, onto a Force creates one
- [x] Asset modifiers applied
- [x] Help section: Forces, Resources and Assets
- [x] `tools/check-economy.mjs` — 51 assertions
- [x] Static pass: no i18n key is a prefix of another

### M4 round 2 — from verification
- [x] Income belongs to the Force: paid unless the GM pauses that Force
- [x] Pause/resume switch on the Force panel, and in its editor
- [x] Cycle roster footnote — every Force, including the ones paid nothing, with why
- [x] Help rewritten with paragraphs, lists, bold terms and callouts
- [x] Per-Force resource icon, with a campaign default
- [x] Native `<file-picker>` for Force and Asset images
- [x] Asset effect gains "Does nothing", and it is the default
- [x] Turn renamed to Cycle in the UI (`turn` in code, per the naming rule)
- [x] Settings segment — campaign defaults, including the cost to develop an Asset
- [x] Asset tray in the Plot view, so drag source and drop target share a screen
- [x] Naming static pass extended to the Cycle/turn split

### M4 round 3 — from verification
- [x] Plot detail header rebuilt: title, description, State line, Phase text, roster
- [x] The State reading sits beside the Phase chip, in the Phase's own colour
- [x] Phases gain a player-facing description alongside the GM's notes
- [x] Cosmetic groupings on a Plot's roster, edited beside each Force
- [x] Thread count on the Threads section header
- [x] The tray's drag handle is a grip, not something that reads as a pause glyph
- [x] One default visibility per KIND of row (Plot, Thread, Force, Asset)
- [x] One push dialog per Thread: how far, in whose name, at what cost, and why
- [x] Thread rows lose the button strips and the inline purses
- [x] `logic/log.mjs` + the chronicle column beside a two-column Plot grid
- [x] Every development records itself; masked rows stay masked in the record
- [x] Help section: Developments
- [x] `tools/check-log.mjs` — 31 assertions

### M4 round 4 — from verification
- [x] Editing moved out of DialogV2 and onto the board, for all four entities
- [x] `logic/editing.mjs` — the draft, its mutations, and what Save hands over
- [x] `apps/board-editor.mjs` — form harvest by convention, one context per kind
- [x] Draft plus an explicit Save / Revert bar with a count of what changed
- [x] Phases are cards; the pipe-delimited textarea is gone
- [x] The roster is columns of Force chips, dragged between headings
- [x] Tags and prerequisites are chips with a picker — only members render
- [x] The four `prompt*` dialogs deleted (~400 lines out of editors.mjs)
- [x] Push dialog compact: one screenful, quick chips, hints on a ⓘ
- [x] Help audit: stale copy fixed, plus Editing and Campaign defaults
- [x] Help audit added to the standing milestone gate
- [x] `tools/check-editing.mjs` — 83 assertions

### M4 round 5 — from verification
- [x] ⓘ badges are hoverable again: `inert` was stopping the tooltip from firing
- [x] Quick chips render: a restyled button has to claim its own text colour
- [x] Two quick chips, −1 and +1
- [x] The push note is a full-width text area with room for its own example
- [x] A development carries its own visibility, chosen per push
- [x] The seal: revealing a row no longer hands the table that row's past
- [x] Example fixture demonstrates both a sealed line and a masked one
- [x] Asset chips in the Force editor open that Asset, guarded by the dirty check
- [x] Help audit: the Developments callout said the opposite of the new rule
- [x] `tools/check-log.mjs` — 45 assertions

### M4 round 6 — from verification
- [x] ⓘ on Lifecycle and on Visibility (the shell, so all four editors get it)
- [x] Default Thread mode's hint now names the four modes
- [x] Developments renamed **Latest Developments**, everywhere it is referred to
- [x] Asset **conditions**: Ready, Damaged, Inactive, Recovering, Destroyed
- [x] `logic/condition.mjs` — two switches, read at one place each
- [x] A suppressed modifier is struck through, not removed
- [x] An out-of-play condition releases the commitment in the same write
- [x] The tray cannot offer an Asset that is out of play; state.mjs refuses one too
- [x] A condition change is a development, sealed like any other line
- [x] Help: Assets had no coverage of any of this, gm and player
- [x] Example fixture: a Damaged committed Asset and a Recovering one
- [x] `tools/check-condition.mjs` — 31 assertions

### M4 round 7 — conditions become the GM's own table
- [x] Six defaults, not an enum: **Suppressed** joins the five
- [x] The effect is a scale — Damaged **halves** rather than nulls
- [x] A condition can count down in Cycles and name what it becomes
- [x] `conditions` world setting; the table is resolved onto Assets at the read funnel
- [x] The conditions editor: a fifth in-board edit screen, opened from Settings
- [x] Deleting a condition asks where each stranded Asset goes, per Asset
- [x] Restore the defaults, keeping anything the GM invented
- [x] A Set condition dialog on the badge, with a note and an audience
- [x] Destroyed is final: it confirms, and files under **Set aside**
- [x] Next Cycle moves every running timer and records what arrived
- [x] Help: the six are documented **as defaults**, and where to change them
- [x] `tools/check-condition.mjs` — 53 assertions, exercising an invented condition
- [x] The condition pill centres inside an Asset chip instead of sitting on its baseline

## M5 — Visibility

Most of this shipped early: `logic/visibility.mjs` landed in M2 and every surface
built since has projected through it. What M5 owes is the part that cannot be
written into the code — proof that it holds — plus whatever the sweep turns up.

- [x] `logic/visibility.mjs`
- [x] Three-state toggle (visible / masked / hidden)
- [x] `hideValues` switch
- [x] Phase ladder never reaches a player context
- [x] Sweep: every player-facing builder read field by field
- [x] Leak found and fixed — a masked Plot kept its Phase's **tone**
- [x] Leak found and fixed — a clock with withheld values still **counted in pips**
- [x] The percentage no longer leaks through an `aria-label` either
- [x] **As the table sees it**: the GM previews the board as a player gets it
- [x] One `#viewer()` flag, so the preview is the player code path and not a copy
- [x] `whileLooking()` — every action but navigation is dead while previewing
- [x] `tools/check-visibility.mjs` — 42 assertions
- [x] A mask has a **name**: “Unknown activity — ???” by kind, overridable per row
- [x] A mask can carry a **line instead of the bar**, for what was heard not watched
- [x] Both fields live in the shared *What the table sees* section
- [x] `tools/check-editing.mjs`: what the form owns must survive `patchFrom`
- [x] Leak found and fixed — a masked Thread still wore its **mode chip**
- [x] The bar SHAPE goes with the chip: no pips, no contender column under a mask
- [x] The fixture carries a masked contest, so the collapse is one click from Generate
- [ ] Verified from a real player login

## M5.5 — Cycle behaviour

Unplanned, from verification: a GM had no way to take one Plot off the world's
clock. Numbered between M5 and M6 because it is neither of them.

- [x] `TURN_BEHAVIOUR` — Default / Isolated / None, on the Plot
- [x] Every Plot carries its own count, seeded from the world's when it is created
- [x] A cycle moves the count and the timers of the Assets committed there — never income
- [x] `assetsOnTheClock` — commitment is the join; an uncommitted Asset is on the world's clock
- [x] `plot.turn`, refused unless the Plot is actually isolated
- [x] The world's Cycle skips the Plots sitting out, and says which and why before it runs
- [x] The isolated dialog names its timers and says out loud that no purse moves
- [x] A Plot's own cycle writes its own chronicle line; the table reads it without the count
- [x] GM-only chip on the card and the header; the button only where it can be pressed
- [x] `tools/check-economy.mjs` — scope, both advances, a row written before the field existed
- [x] *The Long Road South* in the fixture, three cycles behind the world
- [x] Round 2 — from verification:
  - [x] The card header stops competing for width: name on one line, chips on the next
  - [x] The hourglass sits on the line beside the count it belongs to
  - [x] Two clocks, two names: **Global Cycle** and **Plot Cycle**, each renameable
  - [x] `clockName` — pure; the built-in word is joined on at the two sites that localize
  - [x] The world's timer bill names where each Asset is standing
  - [x] Every — hint is markup now, laid out by `data-tooltip-class="rsr-tip"`
  - [x] Two hints rewritten outright: they described the widgets M4 round 4 replaced
  - [x] `field()` stopped escaping the badge in its own label
  - [x] The save notice names the kind and the row
  - [x] *has no Cycle configured*, in the world's bill
- [x] Round 3 — from verification:
  - [x] The chronicle stamps each line with the Global Cycle, by the GM's name for it
  - [x] The line that opens a cycle carries no stamp, being the stamp
  - [x] The timer bill names whose Asset it is and what it is committed to
  - [x] *In hand* is gone: an uncommitted Asset is named by its owner
  - [x] A Plot's own bill gains the column too, without the Plot it already named
  - [x] Twelve Settings fields carry a ⓘ; four paragraphs became badges
  - [x] Four Settings hints written from nothing, four rewritten as documentation
- [x] Round 4 — from verification:
  - [x] One grid for all three sections of the cycle bill; the reason has one left edge
  - [x] A timer's where-cell spans the number columns instead of sizing its own
  - [x] A cycle that moved says so: a toast naming the clock, the count and what moved
  - [x] A Plot's own cycle toasts too, naming the Plot and saying no Resources moved
  - [x] The global cycle button moves to the Situation tab, left of **New Plot**
  - [x] It is named for the clock it moves: **Next Global Cycle**, or the GM’s own word
  - [x] The Cockpit keeps the reading and loses the button
- [x] Round 5 — from verification:
  - [x] Every Help section starts closed, the first one included
  - [x] The chronicle's scrollbar gets a reserved lane instead of the text's right edge
- [x] Verified in a live world
- [x] Decision: withheld data at rest stays in settings — the JournalEntry
      route was checked against the client and does not withhold anything

## M6 — Gating and the graph
- [x] `logic/gating.mjs` — the three gates, derived and stored nowhere
- [x] `phaseGate` — the ladder below the current State, cumulative, last mention wins
- [x] `unmetPrereqs` — what a Thread is still owed; a requirement that is gone is not owed
- [x] `gateOf` — the three combined; a Phase reveal clears the GM's switch and nothing else
- [x] `dependentsOf` / `wouldCycle` / `cyclesIn` — the edge relation and its rings
- [x] `tools/check-gating.mjs` — 39 assertions, the combinations above all
- [x] `logic/graph-layout.mjs` — longest-path layering, rings set aside, orphans reported
- [x] `tools/check-graph-layout.mjs` — 26 assertions
- [x] `state.mjs` refuses a push or a conclusion through a shut gate
- [x] Phase reveal/lock lists are editable, and mutually exclusive at the mutation
- [x] The prerequisite picker cannot author a cycle, at any depth
- [x] The Thread row says the gate is shut and which gate did it (the why is GM-only)
- [x] The requires line names what is still OWED, not what was ever required
- [x] **Requirements** beside **Threads**: the graph, its cards and its SVG edges
- [x] Only Threads that are part of a requirement are drawn; the rest are counted
- [x] CSS section M6; `RSR.gate.*`, `RSR.editor.phase*`, `RSR.graph.*`
- [x] The fixture: a Phase that locks, a Phase that reveals, a three-column chain
- [x] `RSR.help.gating.*` — a section of its own, GM and player

### Round 2 — from verification
- [x] The pen is inside the open Plot too, not only on its card in the list
- [x] The push dialog's −1 / +1 chips step the amount instead of assigning it
- [x] `pushAmountHint` rewritten as documentation, and says the chips step
- [x] Recorded for M7: the editors get the pass the ⓘ badges got
- [x] Verified in a live world

## M6.5 — A Thread that runs out
- [x] `node.countdown` — a reading, not a fifth mode; nothing below the label moves
- [x] `canDeplete` / `depletes` — every mode but Narrative; fiat has no number
- [x] `projectProgress` and `projectClock` invert once, so no template branches
- [x] `projectCountdown` — a masked Thread never drains, beside `projectMode`
- [x] `hideValues` alone keeps the drain: it withholds arithmetic, not shape
- [x] The **Depleting** chip on the row and in the push dialog, and its reading
- [x] The checkbox in the Thread editor, with its scope in the label
- [x] `countdown` through normalize, FIELDS, draft, harvest and patch
- [x] The `countdown` / Depleting pair added to the naming rule
- [x] CSS section M6.5; `RSR.thread.depleting`, `RSR.editor.countdown*`
- [x] The fixture: **The Granary Stores**, a clock of eight reading 5 / 8
- [x] Help: the mode list and the mask rule, GM and player

### Round 2 — from verification
- [x] A contest can deplete too: each side runs its own reserve down from the
      shared threshold, which is how a war of attrition gets drawn
- [x] `canDeplete` opens to every mode but Narrative; contested contenders take
      `countdown` through the same funnel, so no template changed
- [x] The sign flips: the typed number moves the reading, not the pool.
      `pushSign` names the inversion once and `node.advance` applies it at the
      write — storage in, storage out, display everywhere a human looks
- [x] The charge is billed on the storage pair, so a −1 that depletes still
      spends; the chronicle records the move the way it was typed
- [x] The push dialog starts at −1 on a depleting Thread and reads a contest down
- [x] The fixture: **Men Still Fit to Fight**, a contest of twelve apiece
- [x] Keys and Help restated — the scope, and the direction you type

### Round 3 — nine Threads is a different board
- [x] The Thread bin moves off the row and into the Thread's own editor, at the
      foot of the Save bar; the editor dismisses itself when the row goes
- [x] **Find**, under the Threads header and under the Plots header. Filters in
      the DOM against a haystack per row, so typing never re-renders and the
      caret never jumps
- [x] A Plot card is found by its own name, by any Thread on it, and by any
      committed Asset — all of them PROJECTED, so a mask cannot be searched
      through
- [x] The Plot's name, chips and State line stay pinned while its Threads scroll
- [x] A depleting Thread's push arrow points left, on the row, on each contender
      and on the dialog's confirm
- [x] `color` on every row, from a palette of nine ids resolved in CSS; an Asset
      inherits its Force's, a masked row always wears the default
- [x] The chronicle colours the names in each line by kind, so a Plot, a Thread,
      a Force and an Asset in one sentence are told apart
- [x] Player copy: a conclusion you can see is not every conclusion
- [x] A new partial is preloaded, and a static pass now says so before Foundry does

### Round 4 — the shelf, the fallout and a colour of one's own
- [x] The pinned Plot head is built as a shelf: its own ground, run out to both
      edges of the scroller, with a rule and a shadow saying what is above it
- [x] `logic/removal.mjs` — what deleting a Thread takes with it, as rows
- [x] `tools/check-removal.mjs` pins each consequence against a fixture
- [x] The delete confirmation lists them by name: which Assets come loose and
      whose, which Threads stop requiring it, which of those it OPENS, which
      Phases lose it, and how many chronicle lines stay as written
- [x] `logic/palette.mjs` — a colour is a palette id, a canonicalised hex, or
      nothing; nothing typed is passed through, it is parsed and re-emitted
- [x] `tools/check-palette.mjs`, including every near-colour that must come out empty
- [x] Custom beside the nine: a native picker and a text box, either accepted,
      both saved back canonicalised
- [x] The chronicle carries a custom colour inline; a palette id stays a class

### Round 5 — the way out, the loose Threads, and the clock governed
- [x] "All Plots" moves onto the header line inside the shelf, as a breadcrumb
      badge: outside it, it scrolled under the shelf and was cut in half
- [x] `graph-layout.mjs` gives every row the CHAIN it belongs to — the weakly
      connected component — and hands the loose Threads back as ids
- [x] Requirements draws the loose Threads as cards under the diagram, under
      *Waiting on nothing*, instead of counting them in a sentence
- [x] Every card is a button: pressing one returns to the Thread list with that
      Thread's name in the search box
- [x] One search box across both readings of a Plot. On the diagram it hides
      whole chains rather than single cards, collapses the emptied columns and
      redraws the arrows against what is left
- [x] `logic/cycle.mjs` — the count read as a run of Cycles, and the record one
      advance writes so that it can be taken back
- [x] `tools/check-cycle.mjs`: both Segment boundaries, count zero, and every
      reason a revert is refused
- [x] Two campaign constants (`chapterLabel`, `chapterLength`) and an undo
      record beside the count, all three repaired on read
- [x] Both cycles write an undo; `turn.revert` puts back purses, counts, timers
      and the lines it wrote — and refuses once anything has been recorded since
- [x] The badge, the Cockpit line, the chronicle stamp and both cycle dialogs
      all read the count the way the campaign counts it (`ui/clock.mjs`)
- [x] A Revert control beside each cycle button, drawn disabled with the reason
      rather than vanishing, and a confirmation naming everything it puts back
- [x] Settings gains *Segment name* and *Cycles per Segment*, with a live
      reading beside the field
- [x] `check.mjs` polices a third naming pair: chapter/Segment

### Round 6 — Segments as long as they actually were
Round 5 divided the count by a fixed length, which made every Segment the same
size and gave none of them a name. Asked in verification why that limit existed,
and it did not survive the question: a list of marks is no less a derivation than
a modulo, and it is the one that matches how a campaign actually turns a page.

- [x] `reading` reads the count against a LIST OF MARKS — where each run began,
      one row per run — rather than dividing it by a length
- [x] Runs are as long as they actually were, and each carries a name of its own
      which REPLACES the ordinal: *The Siege · Global Cycle 3*
- [x] The first run is implicit. Cycles before the earliest mark are Segment 1,
      and a mark on Cycle 1 exists only to NAME that stretch
- [x] `marks()` sorts, dedupes and drops anything that is not a Cycle, so the
      order the Settings rows were typed in never reaches a reader
- [x] The marks live on the CLOCK beside the count, not among the campaign
      defaults: they are history rather than a seed. `chapterLength` is gone
- [x] *Begin a Segment* beside the Cycle button, asking for the name while the
      GM has one in mind — and writing no chronicle line, so it never costs the
      Revert standing next to it
- [x] A revert takes back a Segment opened on the Cycle it unmakes, and the
      confirmation names it: a run cannot begin on a Cycle that did not happen
- [x] Settings holds the list, added and removed in the DOM and harvested on
      Save, so adding a second row cannot lose what was half-typed in the first
- [x] `check-cycle.mjs` rewritten around irregular runs, named runs and the
      implicit first one; `check-normalize.mjs` follows the marks onto the clock
- [x] Verified in a live world

## M7 — Polish

The last milestone, and almost none of it is new mechanics. What it owes is the
part that cannot be written into the code: that the screens explain themselves,
that the documentation matches the build, and that the three deletes nobody had
finished say what they cost.

- [x] A Phase note fires the moment State crosses into it — `ui/phase-note.mjs`,
      hung off the Plots setting rather than off one operation, because four
      different writes move State and this is the one place all four pass through
- [x] It fires in both directions and writes nothing: a note describes the
      situation the board is in, and a chronicle line naming a Phase would go
      stale the first time a threshold moved
- [x] An empty note is the opt-out, and the ⓘ on the field says so
- [x] `removal.mjs` gains `plotRemoval`, `forceRemoval` and `assetRemoval`; all
      four reports now share one shape so one reader can print any of them
- [x] `plot.delete` sweeps the references its own Threads leave behind — it never
      did, and a cross-plot prerequisite was left pointing at nothing
- [x] The Plot, Force and Asset confirmations drop their one-line warnings for the
      fallout list. The Force delete says the word *deleted* about its Assets, and
      that nothing is refunded
- [x] `check-removal.mjs` covers all four reports and asserts the shared shape
- [x] Every editor section gains a heading and one sentence saying what it
      decides; four "two questions in one row" rows are split; Lifecycle moves up
      into the Plot's first section and the seeds get a section that says so
      (asked for in M6 round 2)
- [x] CSS section M7: headings with a rule, a reading measure for the leads,
      room under the sticky Save bar, and column heads over the outcome rows
- [x] **Show Players** — a GM-only header button that opens the board on every
      connected player's screen, showing what the GM is showing
- [x] `relay.mjs` gains the other direction: a GM broadcast, sender-checked,
      unacknowledged, still the only place `game.socket` is touched
- [x] Help: a full read through as GM and as player. It found a whole section —
      **gating**, written in M6 — that was never added to `HELP_SECTIONS` and so
      never rendered
- [x] `check.mjs` pass 2 names each Help section instead of treating the whole
      namespace as one dynamic prefix, which is what hid it
- [x] The fixture already exercised all four modes, a prereq chain, every
      visibility state and a Phase crossing in both directions from one Thread
- [x] **Generate Example** no longer pushes the GM's own chronicle lines off the
      end of a full log, and **Remove Example** sweeps the references it leaves
- [x] README — there was none
- [x] Whitepaper rewrite (`Remito Situation Room.md`) — it cut off mid-sentence
      and predated the Node → Thread rename
- [x] i18n sweep, static passes and the suites
- [x] Verified in a live world
