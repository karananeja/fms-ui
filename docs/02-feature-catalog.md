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
| F02 | Authentication (sign-in, forgot/reset, accept invite) | F01 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F03 | Access control (fleet tree, users, invites, permissions) | F02 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F04 | Live data pipeline (worker, WS, `live-tracking-store.ts`) | F01 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| F05 | Vehicle status derivation | F04 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| F06 | Live map (markers, clusters, zoom-to-fit, city jump, quick locate) | F04, F05 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| DS1 | Design refresh ("Dark ops console"; restyles F00 shell + F06 map) | F06 | Signed off | Signed off | Done | Passed | Accepted 2026-10-13 |
| DS2 | Auth screens "live ops" backdrop (animated vehicles, radar sweep, entrance) | F02, DS1 | Direction chosen by user | — (small design item) | Done | Passed (targeted) | Accepted 2026-10-14 |
| F07 | Vehicle details panel & parameters | DS1 tokens | Signed off (amended) | Rev 3 signed off | Done | Passed | Accepted 2026-10-13 |
| F08 | Status bar: search, status counters, filters | F05, F06 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F09 | Table view (full / viewport) & CSV export | F08 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F10 | Share live location (create, manage, public page) | F03, F07 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F11 | Driver data & mock contract (drivers, assignments, requests, notifications, history) | F01, F03 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F12 | Drivers & assignment (admin page, assign/unassign, driver on card) | F11 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F13 | Driver web page (breakdown, replacement, RSA requests) | F11, F02 | Signed off | Signed off (F13: amended by D-109/D-110) | Done | Passed (targeted) | Accepted 2026-10-14 |
| F14 | Operator request desk & no-GPS insight (incl. replacement suggest/auto-assign) | F11, F13 | Signed off | Signed off | Done | Passed (targeted) | Accepted 2026-10-14 |
| F15 | In-app notifications (bell, centre, toasts, 24 h no-GPS alert) | F11 | Signed off | Signed off | Done | Passed | Accepted 2026-10-14 |
| F16 | Performance dashboard (vehicle & driver KPIs, charts) | F11 | Signed off | Signed off | Done | Passed (targeted) | Accepted 2026-10-14 |
| F17 | Fleet assistant chatbot (Claude, read-only tools, CSV/PDF reports) | F11, F16 | Signed off | Signed off | Done | Passed (targeted; real-key Anthropic smoke 2026-10-16 after D-157, D-159) | Accepted 2026-10-14 |
| DS3 | Themes (light/dark/system) & fonts (Inter body, Doto display) | DS1 | Signed off | Signed off | Done | Passed | Accepted 2026-10-15 |
| F18 | Dashboard store & contract (node:sqlite, CRUD, view-only sharing, widget catalogue) | F03, F16 | Signed off | Signed off | Done | Passed | Accepted 2026-10-15 |
| F19 | AI dashboard builder (dashboard tools, per-dashboard chat resume, undo; + voice input in both chats, D-110) | F17, F18 | Signed off | Signed off | Done | Passed (+ widget previews D-135) | Accepted 2026-10-15 |
| F20 | Dashboards route & UI (`/dashboards`, empty states, react-grid-layout, share dialog) | F18, F19, DS3 | Signed off | Signed off | Done (core; T5–T7, T13–T16 deferred) | Passed | Accepted 2026-10-15 |
| F21 | AI provider choice (xAI Grok / OpenAI via fetch adapter, Anthropic unchanged) | F17, F19 | Approved in chat | Approved in chat | Done | Passed (targeted; Anthropic real-key smoke 2026-10-16; Grok smoke dropped: no xAI credits, xAI covered only by the fake OpenAI-compatible tests) | Accepted 2026-10-15 |
| F22 | Persist accounts & admin data in SQLite (users, roles, invites, sessions, fleets, drivers, requests, notifications, share links) | F18 | Signed off | Signed off | Done | Passed (full check + e2e 2026-10-16) | Accepted 2026-10-16 |
| F23 | Chat & dashboard UX (richer cards, chat progress, build skeletons, empty-dashboard starter + dock transition, type-ahead suggestions, back button, list search/sort, Interrupted + Retry) + auto-title of new dashboards | F19, F20 | Signed off | Draft (written with the intent) | Done (+ D-155 Retry after return, v12 backfill; D-158 status-aware empty canvas + prompt copy button) | Passed (full check + e2e 2026-10-16) | Accepted 2026-10-16 |
| F24 | Prompt caching across providers (stable prefix, Anthropic breakpoints, OpenAI cache key, xAI conv id, stats; SSE heartbeat) | F21 | Signed off | Draft (written with the intent) | Done | Passed (full check + e2e; Grok smoke dropped: no xAI credits) | Accepted 2026-10-16 |
| F25 | User-provided AI keys (per user, encrypted, Settings → AI assistant, default-assistant switch) | F22, F21 | Signed off | Draft (written with the intent) | Done (wired) | Passed (full check + e2e 2026-10-16) | Accepted 2026-10-16 |
| F26 | Dynamic widgets (widget grammar: 7 datasets, charts, tables, live map with follow/trail) | F23, F20 | Signed off | Draft (written with the intent) | Done | Passed (full check + e2e 2026-10-16) | Accepted 2026-10-16 |
| F27 | Dashboard sharing with edit / view access (private chats per editor, live updates, activity) | F20, D-142 | Signed off | Draft (written with the intent) | Done | Passed (full check + e2e 2026-10-16) | Accepted 2026-10-16 |
| D-142 | Dashboard snapshots on list cards (per viewer, theme-aware) | F23 | Approved in chat | Addendum to F20 | Done | Passed (full check + e2e 2026-10-16) | Accepted 2026-10-16 |
| Fix | Vehicle details sheet scrolls to its end at the top snap point (F07) | F07 | User bug report | — | Done | Passed | Accepted 2026-10-16 |

Suggested order: F00 → F01 → F04 → F05 → F06 → (DS1 ∥ F07)  → F08 → F09 → F02 → F03 → F10.
Part 2 (`requirement-part-2.md`): F11 → (F12 ∥ F15) → (F13 ∥ F14) → F16 → F17.
This puts the live-tracking core, the main risk, first. Until F02 lands, auth uses a mock dev session.
Part 3 (`requirement-part-3.md`): (DS3 ∥ F18) → (F19 ∥ F20) → F21 → (F22 ∥ F23 ∥ F24) → (F25 ∥ snapshots ∥ F26) → F27 → Retry fix → full check + e2e → UAT accepted 2026-10-16.
