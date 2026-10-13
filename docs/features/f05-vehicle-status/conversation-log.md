# F05 — Vehicle Status Derivation · Implementation Log

Implementation sub-agent, 2026-10-13, branch `feature/f05-vehicle-status` (base: F00 + F01 + F04 on `main`).

1. **Read inputs**: F05 spec + intent, decision log (D-015, D-025, D-030, D-031…D-035), architecture, F04 code and test report, and `mock-server/generator/vehicle-sim.test.ts` (reference status function).
2. **Domain + config**:
   - `shared/domain/vehicle-status.ts`: `VEHICLE_STATUSES` (display order), the `VehicleStatus` type, `isVehicleStatus`.
   - `config/status-rules-config.ts`: `statusRulesConfig`, exactly as in spec §2, plus `statusLafPids(cfg)`. It returns the unique charging PIDs, plus `immobilized.field` when that field is not a combinfo live field.
   - `config/status-rules-schema.ts`: a zod/mini strict schema. It rejects unknown, duplicate and missing statuses, a priority that doesn't end in `stopped`, non-positive or infinite thresholds, an empty `anyOf`, a condition without `equals`/`notEquals`, and unknown keys. `parseStatusRulesConfig` throws `Invalid status rules config:` followed by `z.prettifyError`. Uses the English locale (D-036).
   - `live-tracking-config.ts`: `fleetLafPids = statusLafPids(statusRulesConfig)`. No PIDs are hard-coded any more.
3. **Deriver** (`worker/status-deriver.ts`):
   - `compileStatusRules(cfg, resolve)` resolves columns once and walks `cfg.priority`. First match wins, and a valid server `displayStatus` code takes precedence.
   - `deriveStatus(v, now, cfg)` is the same evaluator over one-element columns built from a plain record.
   - `StatusTracker` adds the `status` and `displayStatus` (encoded) columns to `FleetState` and installs itself as the hooks: `rowChanged` re-evaluates at `tracker.now`, and `beforeRemove` decrements. It owns `counts`, and `sweep(now)` does a full pass. It recompiles when the state grows, because the columns are reallocated (D-037).
4. **FleetState**: `hooks` is now public and mutable. `addColumn(name, Ctor, encode?)` stores a same-named combinfo field as `encode(value)`, used for `displayStatus`. `summary()` returns the record without `status`.
5. **Engine**:
   - Validates the rules in the constructor. `fleetLafPids` is derived from injected rules.
   - Sets `status.now = engine.now()` (server-corrected) before applying rows.
   - Runs a 1 Hz `tickSweep` that records `stats.sweepMs` and marks the push dirty only when a status changed.
   - Every push carries `statusCounts` + `total`. `selected` carries `status` and is re-sent when the selected vehicle's status changes.
   - `getVehicleSummary` includes `status`.
6. **Store**: `statusCounts` + `total` in the snapshot. `statusCounts` keeps its identity while the values don't change, so a counts selector does not re-render on every push.
7. **UI**:
   - `config/status-meta.ts`: label, `var(--st-*)`, lucide component + `iconName`, exactly per F05-R5.
   - `components/status-pill.tsx`.
   - Diagnostics: a "Status" list (dot, label, count, Total), a "Status sweep" stat, a `data-ms` attribute on the server offset, and a status pill for the selected vehicle.
8. **Tests**: `status-deriver.test.ts` (T1: 44-case table + coverage check, T2, T3, T4, T5, T7), F05 engine tests in `live-tracking-engine.test.ts` (T3 via timers, heartbeat server time, R4 selection/summary, config-derived PIDs and invalid rules at start), store test (R4), `status-deriver.node.test.ts` (T6), and an agreement check in F01-T4: `deriveStatus` equals the reference function on all 100 000 generated rows, with 0 mismatches.
   - Problem: F04-T5 failed intermittently, and also on `main` (4 of 6 runs). After a reconnect, `snapshotComplete` stayed `true` from the old snapshot, so the "new snapshot" wait passed at once. Fix: reset it when the fleet subscriptions are re-sent (D-039). 6/6 runs passed afterwards.
   - Problem: my engine T3 test asserted right at a sweep tick, but the coalesced push lands ≤ 250 ms later. Fix: advance one extra tick.
   - Problem: T6 failed at some times of day for `stopped` (35.8 % vs the 30 % used by F01-T4 at a fixed instant). D-030 itself says stopped lands near 34 %. Fix: T6 uses the D-030 mix (stopped 34). A simulation over a week at 15-min steps (seed 42, 2000 vehicles) gives a worst deviation of 4.05 points (D-040). This is not a loosened tolerance; it is still ±5.
9. **Perf**: the first evaluator (one closure per rule, called in a loop) swept 1 lakh in 4.2 ms in Node and 5–14 ms in the dev browser. I replaced it with one switch over status codes, which keeps the hot loop monomorphic: **1.6–1.7 ms** in Node and ~2–9 ms (mostly 3–6 ms) in headless Chromium against the dev server while streaming ~18 k rows/s.
10. **e2e**: `e2e/vehicle-status.clock.spec.ts` (T8) runs in a new Playwright project `clock` after `perf` (D-038). It reads all counts in one DOM pass and resets the mock clock to 0 in `afterEach`.
    - The user's `pnpm dev` already held ports 5173/4000. Playwright reused it (`reuseExistingServer`); nothing was killed. The mock-server code is unchanged by F05, so the reused mock is current.
11. **Build**: the worker chunk grew from 17.3 kB to 46.3 kB (zod/mini + en locale, D-036). The main bundle is unchanged apart from status meta/icons (391 kB, gzip 126 kB).

## Commands

| Command | Exit | Notes |
|---|---|---|
| `pnpm check` | 0 | `tsc -b` clean, `eslint .` 0 problems, `vitest run` 20 files / 170 tests |
| `pnpm build` | 0 | `live-tracking-worker-*.js 46.29 kB`, `index-*.js 391.15 kB (gzip 126.19 kB)` |
| `pnpm e2e` | 0 | `8 passed (24.2s)`: 5 chromium, 2 perf (F04-T9/T10), 1 clock (F05-T8); reused the user's dev server |
