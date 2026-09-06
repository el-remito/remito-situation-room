# Remito Situation Room — Build Progress

Run `node progress.mjs` for a rendered view. Checkboxes below are the source of truth.

**Gate:** each milestone stops for the user to verify in Foundry. On an explicit pass it is
committed as one commit, and only then does the next milestone start. Nothing is committed
before its milestone has passed.

| Milestone | Verified | Committed |
|---|---|---|
| M1 | awaiting | — |

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
- [ ] Plot CRUD editor
- [ ] Thread CRUD editor
- [ ] Player View: Plot list
- [ ] Player View: drill into one Plot's Thread board
- [ ] State bar — plain fill + single current-Phase chip (no ladder)
- [ ] Thread rows with progress bars
- [ ] Helper shell + first example fixture (Generate / Remove)

## M3 — Advancement and conclusion
- [ ] `logic/progress.mjs` — thresholds, pools, contest standings
- [ ] Mode: fiat
- [ ] Mode: invest
- [ ] Mode: clock
- [ ] Mode: contested
- [ ] Plot default + per-Thread override
- [ ] Per-Force outcomes
- [ ] Conclude flow (`DialogV2.wait`, one button per Force)

## M4 — Forces, Resources, Assets
- [ ] Force panels + Resource pools
- [ ] GM fiat resource adjust
- [ ] `logic/economy.mjs` — income, Advance Turn
- [ ] Advance Turn pays Active Plots only
- [ ] Assets CRUD + optional UUID link
- [ ] Asset drag-to-commit onto a Thread
- [ ] Asset modifiers applied

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
