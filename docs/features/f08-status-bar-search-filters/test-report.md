# F08 — Test report (in progress)

Branch `feature/f08-search-filters` (worktree `../fms-ui-f08`). Feature is **not complete**: worker side only; no UI (F08-R7…R13) yet. Not submitted for UAT.

## Recovery milestones (2026-10-14)
| Commit | Milestone | Verification |
|---|---|---|
| `26a9dd9` | Baseline: interrupted worker work, restored from `fms-ui/.recovery/2026-10-14` | 5 committed blobs = manifest SHA-256 |
| `55c4a5f` | D-065 FleetState listeners + search-index identifier invalidation | worker tests 124/124 |
| `9dfa05b` | Filter reads columns live (rows added after growth matched) | regression test red before (`['v0']`), green after; worker tests 125/125 |
| `163128e` | Three `LivePush` test fixtures | `tsc -b` clean; 32/32 in the three files |

## Final run (after `163128e`)
| Command | Result |
|---|---|
| `pnpm typecheck` (`tsc -b`) | pass |
| `pnpm lint` (`eslint .`) | pass |
| `pnpm test` (`vitest run`) | **342/342**, 32 files |

## Acceptance tests
| ID | Status | Notes |
|---|---|---|
| F08-T1 filter-engine | partial | growth regression + filter/order test in `fleet-state-hooks.test.ts`; field types, AND/OR, subtrees, random insert/update/remove, counts not yet |
| F08-T2 search-index | partial | identifier change, no rebuild on non-identifier rows, add/remove; field/"all"/ordering/limit not yet |
| F08-T3 perf | not run | cold (rebuild) and warm suggestion times + filter apply at 1 lakh still to measure |
| F08-T4 map-index mask | not started | |
| F08-T5…T10 | not started | store, components, e2e, screenshots |
| F08-T11 | partial | `pnpm check` passes; build + e2e not run |
