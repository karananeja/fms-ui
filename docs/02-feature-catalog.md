# 02 — Feature Catalogue & Delivery Order

Each feature has its own folder, `docs/features/<id>-<name>/`, which holds:
- `intent.md`: the why and what. **The user signs this off first.**
- `spec.md`: requirements, contracts and acceptance tests. Written after the intent is signed off, then signed off too.
- `conversation-log.md`: the implementation chat log.
- `test-report.md`: the testing evidence.

A feature is **Done** only when all four are in place: Implemented → Tested → User-accepted → Signed off.

| ID | Feature | Depends on | Intent | Spec | Impl | Test | UAT |
|---|---|---|---|---|---|---|---|
| F00 | Project foundation | — | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| F01 | Mock server & API/WS contract | F00 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| F02 | Authentication (sign-in, forgot/reset, accept invite) | F01 | Signed off | — | — | — | — |
| F03 | Access control (fleet tree, users, invites, permissions) | F02 | Signed off | — | — | — | — |
| F04 | Live data pipeline (worker, WS, `live-tracking-store.ts`) | F01 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| F05 | Vehicle status derivation | F04 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| F06 | Live map (markers, clusters, zoom-to-fit, city jump, quick locate) | F04, F05 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| DS1 | Design refresh ("Dark ops console"; restyles F00 shell + F06 map) | F06 | Signed off | Signed off | Done | Passed | — |
| F07 | Vehicle details panel & parameters | DS1 tokens | Signed off (amended) | Rev 3 signed off | In progress (parallel with DS1) | — | — |
| F08 | Status bar: search, status counters, filters | F05, F06 | Signed off | — | — | — | — |
| F09 | Table view (full / viewport) & CSV export | F08 | Signed off | — | — | — | — |
| F10 | Share live location (create, manage, public page) | F03, F07 | Signed off | — | — | — | — |

Suggested order: F00 → F01 → F04 → F05 → F06 → (DS1 ∥ F07)  → F08 → F09 → F02 → F03 → F10.
This puts the live-tracking core, the main risk, first. Until F02 lands, auth uses a mock dev session.
