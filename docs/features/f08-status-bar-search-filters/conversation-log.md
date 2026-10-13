# F08 — Conversation log

## 2026-10-13 — Initial run (interrupted)
Agent implemented a worker-side draft (filter engine, search index, map-index filtering, worker API) and stopped without committing, testing or logging. Uncommitted work backed up and verified on 2026-10-14 in `fms-ui/.recovery/2026-10-14/` (see `MANIFEST.txt`).

## 2026-10-14 — Recovery, milestone 1: FleetState listeners (D-065, Option C)
**User:** approved Option C on the F08 branch only (multi-listener `FleetState`; `main` and F09 untouched), then option (b): baseline commit of the interrupted work, then Option C as its own milestone.

**Baseline:** current worktree diffed against `ff356b6` + backup — only Option C differences. Backup staged into the index only (`git apply --cached` + backup blob), all 5 staged blobs = manifest SHA-256 → committed `26a9dd9`.

**Done (D-065 added to decision log as Proposed):**
- `fleet-state.ts`: single mutable `hooks` slot → private `listeners` list + `addHooks()`; `opts.hooks` kept; the 3 call sites loop over listeners in registration order.
- `status-deriver.ts`: `state.hooks = this` → `state.addHooks(this)`.
- `filter-engine.ts`, `search-index.ts`: prev-wrapping removed, use `addHooks`. `SearchIndex` now also listens to `rowChanged` and invalidates when a row's regno/VIN/device id differs from the indexed value, or a new row appears (fixes stale identifiers).
- New `fleet-state-hooks.test.ts`: listener order; status/filter/search correct with subscribers built before `StatusTracker`; search re-index on identifier change, no rebuild on non-identifier rows, add/remove.

**Results:** worker tests 124/124 at commit time; earlier full `vitest run` 340/340; `eslint` on `worker/` clean. `tsc -b` fails on 3 pre-existing WIP test fixtures missing the new `LivePush` fields (not touched in this milestone).

**Found (not fixed, pending approval):** `FilterEngine.compile()` captures `codes[field]` / `cols.soc` arrays; `FleetState.grow()` replaces them, so rows inserted after growth never match an active filter.

## 2026-10-14 — Recovery, milestone 2: filter after fleet growth
**Bug:** `FilterEngine.compile()` captured `codes[field]`, `dicts[field].values`, `cols.soc` and `str[field]`; `FleetState.grow()` replaces the typed columns, so with a filter active, rows past the old capacity never matched.

**Fix:** the compiled checks read the columns from `this.state` on every call.

**Test:** new `filter-engine.test.ts` (start of F08-T1): fleet + SOC + regno filter set before inserting 7 rows into a capacity-2 state (grows 2 → 4 → 8); expects `v0, v2, v4, v6`, then a post-growth SOC update drops `v6`. Before the fix: received `['v0']` only. After: passes; worker tests 125/125.

**Note:** the per-call lookups add a few property reads per row to the 1 lakh mask pass; measured in F08-T3 (perf), not yet run.

## 2026-10-14 — Recovery, milestone 3: LivePush test fixtures
The baseline made `filteredCounts`, `filteredTotal`, `selectedMatches` required on `LivePush` but left three test fixtures without them (`tsc -b` failed). Added unfiltered values (counts = status counts, total = total, `selectedMatches: true`) to `live-tracking-store.test.ts`, `use-selection-url-sync.test.tsx`, `vehicle-details-panel.test.tsx`. `tsc -b` clean; the three files 32/32.

## 2026-10-14 — Recovery complete; final verification
`pnpm check` after `163128e`: `tsc -b` pass, `eslint .` pass, `vitest run` 342/342 (32 files). Test report added. Next (needs approval): remaining F08-T1/T2 cases, F08-T3 perf (cold + warm search, filter apply at 1 lakh), F08-T4, then UI R7…R13.

## 2026-10-14 — Milestone 4: worker tests + performance (F08-T1…T4)
**User:** finish F08 and F09 end to end, prioritising speed; no routine approvals.

- F08-T1 `filter-engine.test.ts` (21): each field, OR within / AND across, fleet subtrees, counts without the status filter, live status, version bumps, random insert/update/remove vs a reference predicate, growth regression.
- F08-T2 `search-index.test.ts` (5): each field + "all", case, ordering, limit, payload, insert/remove.
- F08-T4 `map-index-filter.test.ts` (6): clusters/points, zoom-16 scan, bounds; engine: filter change rebuilds inside the 2 s throttle and pushes filtered counts; `selectedMatches`; filter options.
- F08-T3 `filter-search.perf.test.ts` first run: filters ≤ 10 ms but **cold suggestion 75.6 ms > 50 ms** (full index build). Native-sort build alone did not help (76.8 ms). Fix (D-066, proposed): build once after the snapshot, then update in place; bulk churn schedules a rebuild in its own task.
- F08-T3 after fix: apply ≤ 9.3 ms (statuses 0.0, fleet subtree 2.1, types+make+model 3.7, SOC 2.0, search-all 9.3, everything 4.9); counts 4.2 ms; full build 73.1 ms (off the query path); query after add 0.09 / remove 0.00 / id change 0.03 / 500 adds 0.05 ms; warm ≤ 0.03 ms; re-applying 1 lakh unchanged rows 61.3 ms with the index vs 41.3 ms without.
- Worker tests 157/157; typecheck + eslint clean.

## 2026-10-14 — Milestones 5–7: store, UI, e2e (session resumed after an interruption)
- Store (R7, R13; T5) committed `e4be91a`: filter state, `/api/fleets` → worker subtree, filtered counts, `selectedHidden` (hides ring/callout, "Hidden by filters" hint), pulse buffer (D-067).
- UI (R8–R12; T6) committed `5e42c8f`: search box (combobox, `/`, field menu, 120 ms debounce), status pills (`+N` via measured fit, compact on mobile), fleet pulse card, filter panel (popover / sheet: fleet tree with search + inherited children, types, make → model, SOC dual slider), active chips. Pure helpers in `lib/status-bar-model.ts` (no fast-refresh warnings).
- e2e (T7–T10) + screenshots; fixes found by e2e/screenshots: stale search highlight (bug), translucent overlays, mobile top row overflow, shadowed `compact` formatter in `live-pill.tsx` (caught by e2e before commit).
- Dev probe gains `framed` (vehicles in the current frame) for T7/T8; absent from `dist/`.
- Final: `pnpm check` 401/401, 0 warnings; build OK; e2e chromium+clock 24/24.

## Open: frame budget (needs approval)
`e2e/status-bar.perf.spec.ts`: next frame after a filter change is 25–83 ms when narrowing, but 254–314 ms when widening back towards 1 lakh (STOPPED added, ALL, Clear all) — over the 200 ms budget. Each change forces a full Supercluster rebuild (R4 "like D-063").
Proposed fix (not implemented; changes approved R4 and the shared F06 `MapIndex`):
1. Build clusters over the filter **without statuses**; apply the status selection when a frame is cut, from each cluster's per-status breakdown (count = sum of the selected statuses; empty clusters dropped). Status pill clicks then need no rebuild (a frame in a few ms). Trade-off: a cluster's centroid stays that of all its vehicles, not only the selected statuses.
2. Keep the last index built with no non-status filter; when the filter returns to that, serve frames from it at once and force a fresh rebuild right after. Trade-off: for ~0.3 s cluster counts can be those of when the cached index was built.

## 2026-10-14 — Frame budget: D-072 implemented (user approved both fixes)
**User:** approved fixes 1 and 2 above (changes F08-R4 and the shared F06 `MapIndex`).

- `FilterEngine`: `matchesBase`, `statusMask`, `baseActive`, `baseVersion` (bumps only when the non-status part changes or a row's base match flips); a status-only `set` skips the mask pass.
- `MapIndex` takes the filter object (`MapFilter`), builds over `matchesBase`, applies `statusMask` per frame (count = selected statuses, breakdown zeroed elsewhere, empty clusters dropped; points/scan/bounds use `matches`). Keeps the last unfiltered index; a forced update that returns to no non-status filter swaps it in (`cacheHits`, `generation`) and leaves the rebuild due.
- Engine: map data version uses `baseVersion`; `setFilter` forces only on a base change; frame identity = data + `generation` + `filters.version`; a status-only change defers a due throttled rebuild to the next push; fixed a same-flush double `updateIndex` that rebuilt straight after the swap (found by instrumentation).
- Tests: `map-index-filter.test.ts` +4 (10). `pnpm check` 405/405; build OK; e2e chromium+clock 24/24 (`VITE_PORT=5273 MOCK_PORT=4100` — without them Playwright reused main's server on 5173 and 5 F08 specs failed).
- Perf (×2): running 68/168, + stopped 172/251, all 253/250, search 31/257, clear 254/248 ms; long tasks none / 57 ms. Load average ~11 (F09 in parallel).
- Instrumented timeline: frame compute ≤ 1 ms; the remaining latency is the 4 Hz push slot (0–250 ms). The spec clicks right after a push, so it waits ~250 ms. **Open:** proposed fix 3 — `setFilter` flushes at once (changes F04-R17); needs approval.
- Also fixed `e2e/status-bar.perf.spec.ts` `longtask` observer typing (`tsc -b` failed).

## 2026-10-14 — D-073: filter change pushes at once (user approved fix 3)
**User:** approved fix 3 (amends F04-R17).

- Engine `pushNow()`: `setFilter` cancels the pending push timer and flushes synchronously; that push sets `lastPushAt`, so the 250 ms window restarts and data-driven pushes stay ≤ 4 Hz. F04-R17 amended; D-073 Accepted.
- Test (`map-index-filter.test.ts`): immediate push with frame + filtered counts, cancelled slot doesn't fire, data waits a full 250 ms after the filter push, 100 deltas/s → ≤ 4 pushes/s. F04-T8 (data-only rate) still passes.
- `pnpm check` 406/406; build OK; e2e chromium+clock 24/24; screenshots rewritten by e2e restored.
- Perf (load average 8.7 / 8.6): running 81/57, + stopped 71/48, all 97/73, search 25/25, clear 50/47 ms; long tasks none/none. **All F08 budgets pass.**
