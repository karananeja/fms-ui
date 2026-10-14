# F03a Fleets — Test report

Branch `feature/f03a-fleets` (worktree `../fms-ui-f03a`, ports 5273 / **4101** — 4100 was held by a stale `../fms-ui-f09h` mock). Not merged; to be combined with F03b's report on `integration/f03`.

## Final runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (tsc -b, eslint ., vitest run) | pass — **596/596** tests, 49 files, 0 lint warnings |
| `pnpm build` | pass; main chunk 687.1 kB (213.8 kB gzip); `fleets-page` lazy chunk 40.7 kB (13.0 kB gzip) |
| `playwright test --project=setup --project=chromium --no-deps` (fresh mock) | **39/40**; the one failure was `live-map.spec.ts` F06-T6 (initial centre 188 km from India centre vs < 150 km under parallel load) — not F03a code; passes on re-run (1/1) |
| `playwright test e2e/fleets.perf.spec.ts --project=perf --no-deps` | pass — see Budgets |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F03-T2 store | pass | `fleets/fleet-tree-store.test.ts` (21): build tree from flat list (heights, direct counts, scoped forest), expanded rows + ARIA positions, search keeps ancestors, depth-5 rule + move height limit, move excludes own subtree and too-deep parents, delete reasons + root fixed, `withMove` depths/counts; store load / expand / search, optimistic create (temp id → server id), depth-5 refused locally, rename revert on 409, move revert on 422 (counts restored), a failed move keeps a later rename, delete revert on 409; vehicles: cursor pages of 100 to the end, stale page dropped, checkbox + shift-range + select page, move → "Moved 3 vehicles" + list drops them + counts refresh, failed move keeps selection + toasts server message |
| F03-T2 picker | pass | `fleets/fleet-picker.test.tsx` (4): multi subtree implication (checked + disabled + `aria-disabled`), ancestor replaces chosen descendants, search keeps ancestors, single excludes subtree/too-deep + keyboard pick |
| F03-T2 page | pass | `fleets/fleets-page.test.tsx` (2): tree keyboard pattern (← collapse, → expand / first child, `aria-activedescendant`, Enter selects), F2 inline rename → PATCH; row menu reasons ("Still has vehicles", depth 5) |
| F03-T3 e2e | pass | `e2e/fleets.spec.ts`: create child under Pune (201) → rename (Esc cancels, Enter saves) → move under Mumbai via the picker (own subtree not offered; tree shows Acme › West › Mumbai › fleet) → delete leaf (204). Depth-5 "Add child fleet" disabled with "at most 5 levels"; parent with a child: "Still has child fleets"; Pune: "Still has vehicles"; root: can't be moved / deleted. Move 3 vehicles (checkbox + shift-click) to a new fleet → "Moved 3 vehicles", target count 0 → 3, source −3; the F09 table filtered to the new fleet shows exactly those 3 vehicle IDs with the new fleet name |
| F03-T9 screenshots (fleets) | done | `screenshots/fleets-tree-vehicles.png` (search "Pune Hub", 3 selected), `fleets-move-dialog.png` (picker with search + selection), `fleets-mobile.png` (390 px tree), `fleets-mobile-sheet.png` (vehicles bottom sheet) |
| F03-T10 (fleets) | pass | rows above |

## Budgets (spec §3)
| Budget | Measured (`fleets.perf.spec.ts`, dev server) | Verdict |
|---|---|---|
| Full seeded tree renders and expands with no long task > 50 ms | Expand all (207 fleets), scroll the tree 0→100 %, collapse/expand all, search + clear: **no long tasks**; page boot + first tree render: none | pass |
| Vehicle pages load ≤ 300 ms from the mock | Delhi, 5 cursor pages of 100: 5–8 ms each; the root's (empty) direct list on first load 258 ms (full mock scan, cold proxy) | pass (headroom small only for the empty-fleet worst case) |

## Notes / open
- `FleetPickerProps` unchanged. Multi rows still use native checkboxes named by the fleet, so F03b tests written against the placeholder (`getByRole('checkbox', { name })`) keep working; single mode is no longer a `<select>` (use `getByRole('treeitem', { name })`).
- The mock's `GET /api/vehicles?fleetId=` scans every vehicle, so a fleet with few direct vehicles is the slowest page (still < 300 ms).
- e2e mutations stay inside one city (new fleets under Pune / Pune Hub 2), so region totals used by other specs are unchanged.
