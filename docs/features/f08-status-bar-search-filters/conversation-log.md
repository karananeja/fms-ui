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
