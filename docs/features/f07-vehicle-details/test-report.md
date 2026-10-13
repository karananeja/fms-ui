# F07 — Vehicle Details Panel · Test report (spec rev 3)

Date 2026-10-13 · branch `feature/f07-vehicle-details` · worktree `fms-ui-f07`.

## Commands
| Command | Result |
|---|---|
| `pnpm check` (typecheck + lint + vitest) | exit 0 · Test Files 29 passed · Tests 249 passed · lint 0 problems |
| `pnpm build` | exit 0 (only the existing chunk-size warning) |
| `VITE_PORT=5373 MOCK_PORT=4200 pnpm e2e --project=chromium --project=clock --no-deps` | 15 passed (46 s). `--no-deps` because `clock` depends on `perf`, which the orchestrator runs once after merging |

## Acceptance tests
| ID | Where | Result |
|---|---|---|
| F07-T1 | `lib/humanize-pid.test.ts` | Pass (unchanged) |
| F07-T2 | `lib/vehicle-details-model.test.ts` | Pass. Regno, `08 Sep 26 \| 09:33:42` / `09:33:49`, `31 h ago`, danger dots; rings 49% warn / 56 / 100.0 ok; ODO `1,077 KM`; Aux `0.07 V` danger; Internal `3.60 V`; −70 → 3 bars; GPS NONE; location `28.70419, 80.56578`; 374 params, `time_to_charge` N/A; 20-cell strip, one lowest |
| F07-T3 | same file | Pass. Freshness, SOC, signal-bar and `format-relative` boundaries; chip counts equal the key patterns; search on label or key (`cell_voltage` → 23) |
| F07-T4 | `worker/selected-history.test.ts` | Pass. 2 h cap, repeated payloads ignored, transitions once, ignition de-duplicated, reset |
| F07-T5 | `components/vehicle-details-panel.test.tsx` | Pass. Hero from summary then fixtures, 4 tabs, search + chips + count, copy + toast, not-found, Parameters tab hidden without permission, "Collecting…", mobile sheet at 35 % without absolute time |
| F07-T6 | same file | Pass. One PID changed → only that row re-renders; identical payload → none |
| F07-T7 | `mock-server/tests/vehicle-trail.test.ts` | Pass. ~60 min of ordered points in scope, 403 out of scope, 401 without session |
| F07-T8 | `e2e/vehicle-details.spec.ts` | Pass. Point click → panel, `?vehicle=`, trail (store probe) + callout + compass; reload restores; Esc, close button and empty-map click deselect and remove trail + callout; back reopens |
| F07-T9 | e2e | Pass. GPS time or session chart changes within 20 s; locate → zoom 16 |
| F07-T10 | e2e (390 × 844) | Pass. Sheet at 35 % with rings visible, drags to 92 %; 374 rows; `cell_voltage` → 23; CELLS chip → only `cell_` keys |
| F07-T11 | e2e | Pass. Screenshots in `screenshots/`: `desktop-overview.png`, `desktop-parameters.png`, `desktop-device.png`, `desktop-events.png`, `map-trail-callout-compass.png`, `mobile-sheet-35.png`, `mobile-sheet-92.png` |
| F07-T12 | commands above | Pass for check/build/e2e. F04–F06 perf budgets **not measured here** (perf project deferred to the orchestrator's single run) |

Also added: store test `F07-R12: selected-vehicle trail` (fetch on select, live append once, cleared on deselect).

## Deviations
- `selected-callout` is `.ts` (MapLibre Marker, imperative DOM) instead of `.tsx` (D-057).
- Trail presence in e2e is asserted via the dev probe (`__fmsMap.trailLength`), not by reading pixels.
- Share CTA hidden (F10), as specified. Overview additionally lists the 3 newest events (mockup).
- Rev-1 `details-header.tsx` and `location-row.tsx` were also deleted (replaced by the hero); location appears in event details.
