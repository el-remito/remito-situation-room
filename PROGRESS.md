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
| M4 | in progress | — |

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
- [ ] `logic/visibility.mjs`
- [ ] Three-state toggle (visible / masked / hidden)
- [ ] `hideValues` switch
- [ ] Phase ladder never reaches a player context
- [ ] Verified from a real player login

## M6 — Gating and the graph
- [ ] Phase reveal/lock lists
- [ ] `logic/gating.mjs` — prereq DAG + cycle detection
- [ ] `logic/graph-layout.mjs` — DAG layering
- [ ] Graph rendering (fallback: indented list)

## M7 — Polish
- [ ] Phase notes fire on entry
- [ ] Help copy: all sections, gm + player variants
- [ ] i18n sweep + static passes
- [ ] README
- [ ] Whitepaper rewrite (`Remito Situation Room.md`)
