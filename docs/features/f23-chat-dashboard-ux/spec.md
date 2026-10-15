# F23 — Chat & Dashboard UX Polish · Spec

**Status:** Draft — written with the signed-off intent (2026-10-15); R12–R15 added 2026-10-15/16 from user requests relayed during the build.
**Scope:** client only (`src/**`). No contract, server or dependency changes. DS3 tokens; Inter body, Doto display only.

## Requirements

| ID | Requirement |
|---|---|
| R1 | **Dashboard list cards:** layout thumbnail (12-col sketch of the `lg` layout, type-coloured), widget-type icons, widget count, last updated (IST), "You" / "Shared by …", share count. Exactly one link per card; kebab menu outside it. The summary has no layout, so a card reads `GET /api/dashboards/:id` once it scrolls into view (≤ 4 in parallel, cached per id + version); until then a neutral sketch. |
| R2 | **Preview cards** (chat): type icon, data source (Live / Analytics / Drivers / Requests / Note), time range, default size `w×h`. |
| R3 | **Grid widget frames:** source chip (+ range), last refreshed time of REST data, live dot (existing). Chips hide on narrow tiles (container queries). Widgets fade in (320 ms, none with reduced motion). |
| R4 | **Chat progress row** while a reply streams (global panel and dashboard dock): spinner, current step ("Thinking…", the running tool's label, "Writing the answer…"), elapsed time, Cancel. Composer shows a busy bar and "FMS is working…" placeholder; Stop stays in the composer. |
| R5 | **Build skeletons:** while a dashboard-chat turn changes the dashboard (a mutating tool runs or a change landed) or fills an empty dashboard: a "Building your dashboard…" banner and skeleton tiles where widgets will land. Each widget keeps its own skeleton until its first data (existing `DataBody`). |
| R6 | **One chat entry point:** the header "Ask FMS" is hidden on `/dashboards/$id` (`staticData.hideAskFms`), shown elsewhere. |
| R7 | **Back button:** "← Dashboards" above the title (breadcrumb "Dashboards / title" ≥ lg) returns to the list with its last tab, search, sort and view. |
| R8 | **List UI:** search (title, description, owner), sort (recent [default], name, widgets), tabs with counts (`n/total` while searching), grid/list toggle, loading skeletons, "Create with AI" hero with example prompts (users with `chat.use` who already have dashboards). State lives in the URL (`tab`, `q`, `sort`, `view`) and is remembered for R7. "Pinned" is out (no contract field): recent-first instead. |
| R9 | **Interrupted replies:** a stream that ends without `done`/`error`, or breaks mid-read (network drop), or can't reach the server, marks the reply `interrupted` (not an error): partial text kept, notice + **Retry** (re-sends the same message). Both stores. |
| R10 | **Dashboard chat after an interruption:** the thread is re-read; the stored reply of that turn is marked Interrupted and keeps its chips/Undo; if the server didn't store it, the local pair stays. Retry sends the same text as a new turn. |
| R11 | **Heartbeats:** SSE comment lines (`: ping`, F24) are ignored by the parser (verified by test). |
| R12 | **Empty-dashboard starter** (owners with chat, 0 widgets): "What do you want to see?" hero with a focused prompt box, example chips grouped (Live ops, Performance, Drivers, Requests & EV), 4 one-click templates (Fleet health, Driver performance, EV battery watch, Breakdowns this week), a how-it-works line (ask → preview → add/drag), ghost tiles behind. Chips/templates filtered by permission. Viewers see "This dashboard has no widgets yet". |
| R13 | **Type-ahead** in the dock, the global panel and the starter: ≤ 5 suggestions from a curated, permission-filtered template list (word-prefix + keyword match, match highlighted), plus completion of the last word with a vehicle (worker `suggest`, regno/VIN, needs a digit) or a fleet name (word start). Debounce 150 ms, no model call. ↑/↓ move, Tab/Enter accept (Enter with nothing highlighted sends), Esc closes (not the sheet), click accepts. ARIA 1.1 combobox wrapper + `listbox`/`option`, `aria-activedescendant`; the box stays a textbox. Hidden while dictating. |
| R14 | **No dock on a new dashboard** (0 widgets and an empty thread): the page is the full-width starter; the dock is mounted hidden (`inert`) to read the thread. The first prompt (typed, chip, template, or `?ask=` hand-off) slides the dock in (300 ms ease-out; instant with reduced motion), the starter goes, build skeletons show, focus moves to the dock composer, "Assistant panel opened" is announced. Any widget or message → the dock as before (collapsible); a reload keeps it. |
| R15 | **Scrolling:** the grid area is the only page scroller (no page/`main` scroll, no double bars) at 1440×900, 1280×720, 390×844, dock open or collapsed; the dock's list scrolls independently with the composer pinned; dragging/resizing a widget near the scroller's top/bottom edge auto-scrolls it. |

## Acceptance tests

| ID | Test | Where |
|---|---|---|
| F23-T1 | SSE: `: ping` skipped; mid-stream read failure → `ChatStreamCutError`; clean end delivers all events | vitest `chat-ux.test.tsx` |
| F23-T2 | Dashboard store: cut → stored turn marked interrupted with Undo; unsaved turn keeps local pair; Retry re-sends | vitest |
| F23-T3 | Progress label/elapsed helpers; `turnActivity` (changing) | vitest |
| F23-T4 | List `arrange` (search + 3 sorts) and URL parsing | vitest |
| F23-T5 | Global chat: progress row with "Thinking…" and ticking elapsed; composer busy; then done | e2e |
| F23-T6 | Global chat: forced cut (route fulfil, truncated SSE) → Interrupted + partial text; Retry completes | e2e |
| F23-T7 | Dashboard chat: forced cut → Interrupted; Retry re-sends and completes | e2e |
| F23-T8 | New dashboard: starter, no dock, box focused, 4 templates / 4 groups, no Ask FMS; template → dock slides in with the message + progress row, banner + skeletons, focus in dock; reload keeps the dock | e2e |
| F23-T9 | Type-ahead: dock (↓, Enter accepts) and global panel (Esc closes list, not the sheet) | e2e |
| F23-T10 | List search/sort/view/tab counts; "← Dashboards" restores them; Ask FMS hidden on the dashboard, back on the list | e2e |
| F23-T11 | Tall dashboard (18 widgets) at 3 viewports, dock open/collapsed: one scroller, last widget reachable by wheel; dock list scrolls on its own, composer in view | e2e |
| F23-T12 | List "Create with AI" → new dashboard, dock open with the prompt, reply done | e2e |
| F23-T13 | Type-ahead matching (word/keyword, highlight, ≤ 5), entity completion | vitest |
| F23-T14 | Composer keyboard: ↓/Enter accept, Enter sends when nothing highlighted, Tab accepts first, Esc, click, permission filtering | vitest |
| — | Existing: `assistant.spec`, `dashboards.spec`, `dashboard-builder.spec`, `dashboard-previews.spec` stay green | e2e |

## Proposed decisions (to add to `docs/decision-log.md`)

- **Card peek via `GET /api/dashboards/:id`** (R1) instead of a contract change; lazy, ≤ 4 parallel, cached. A summary field (`widgetTypes`, mini layout) can replace it later.
- **`interrupted` message status** (R9) distinct from `error`; network failures (pre-stream status 0 or mid-read) count as interruptions.
- **Starter phase keeps one hidden `ChatDock` instance** (R14) so the first turn's stream survives the slide-in.
