# F20 — Dashboards Route & UI · Spec

**Status:** Signed off: 2026-10-15 (user)

| Field | Value |
|---|---|
| Intent | `intent.md` (signed off 2026-10-15) |
| Builds on | F18 contract + REST (`shared/contract/dashboards.ts`, `mock-server/routes/dashboard-routes.ts`; D-119…D-121), D-113 (react-grid-layout, lazy chunk only), D-116 (fixed catalogue, data as the viewer, view-only sharing), DS3 tokens/fonts (D-114, D-115, D-118), F16 SVG components (D-103), F08/F09 worker contract (D-005, D-064), F03 `can()` / `useCan` / `staticData.permission`. |
| Serves | F19: F20 owns the page layout and the chat dock; F19 provides `useDashboardChat`, chips and chat parts (§8). |
| New dependency | `react-grid-layout@2.2.4` (exact pin; D-113 accepted, version and import approach proposed as D-127). |
| Delivery | Shared branch `feature/part3-f19-f20` in the main checkout (no worktrees), alongside F19 on disjoint files. F20 agent ports `VITE_PORT=5373 MOCK_PORT=4201`. Decisions **D-127…D-133**. Agents don't commit. |

## 1. react-grid-layout (verified 2026-10-15)
- `pnpm view react-grid-layout`: latest **2.3.0** (published 2026-10-05, 10 days old); **2.2.4** published 2026-07-29. Peers `react`/`react-dom >= 16.3.0`; README compatibility table: "≥ 2.0.0 → React 18+, TypeScript". Ships its own types (`dist/*.d.mts`), ESM `exports` for `.`, `./core`, `./react`, `./extras`, `./legacy`, and `./css/styles.css`. Deps: `react-draggable ^4.4.6`, `react-resizable ^3.1.3`, `fast-equals`, `clsx`, `prop-types`, `resize-observer-polyfill`.
- **Pin `2.2.4` exactly** (a release older than two weeks; 2.3.0 can be taken in a later bump, Q1). Grid items pass `nodeRef` to `react-draggable`, so no `findDOMNode` (removed in React 19). The first implementation task is a 15-minute spike (F20-T1) that mounts `Responsive` under React 19.3 + StrictMode and drags/resizes one item in vitest/jsdom and in Playwright; if it fails, stop and report before building on it.
- **Import approach (v2 API, not `/legacy`):** `import { Responsive, useContainerWidth } from 'react-grid-layout'` and `import 'react-grid-layout/css/styles.css'`, only in `src/features/dashboards/components/dashboard-grid.tsx`, which is only reachable from the lazy `/dashboards/$id` chunk. `width` comes from `useContainerWidth()` (render the grid only when `mounted`). Props used: `layouts`, `breakpoints={{lg:1200, md:768, sm:0}}`, `cols={{lg:12, md:6, sm:1}}` (both derived from `DASHBOARD_BREAKPOINTS`), `gridConfig={{rowHeight: 72, margin: [12, 12]}}`, `dragConfig={{enabled, handle: '.widget-drag-handle', cancel: '.widget-no-drag'}}`, `resizeConfig={{enabled, handles: ['se']}}`, `onBreakpointChange`, `onLayoutChange(layout, allLayouts)`, `onDragStop`, `onResizeStop`. Default vertical compactor.
- **CSS:** the package stylesheet is imported in that module (Vite emits it as the chunk's CSS). `react-resizable/css/styles.css` is **not** imported (it is a transitive dep; pnpm would need a direct dep): `dashboard-grid.css` styles `.react-resizable-handle` itself, and overrides the placeholder (`.react-grid-placeholder`) with tokens only (`--accent` at low alpha, `--radius-panel`). Transitions are off under `prefers-reduced-motion`.
- A build check (F20-T17) asserts no `react-grid-layout`, `react-draggable` or `react-resizable` code in `app-entry` or the live-tracking worker chunk.

## 2. Routes and navigation
| Route | Chunk | `staticData` | Search params |
|---|---|---|---|
| `/dashboards` | `dashboards-page` (lazy, no RGL) | `{title: 'Dashboards', permission: ROUTE_PERMISSIONS['/dashboards']}` | `tab?: 'shared'` (default "My dashboards") |
| `/dashboards/$id` | `dashboard-page` (lazy, RGL + widgets + chat dock) | same permission, title from the dashboard | `ask?: string` (≤ 2000, one-shot prompt handoff, §8) |

- `ROUTE_PERMISSIONS` gains `'/dashboards': 'dashboards.use'` **after** `/analytics` and before `/admin`, so `firstAllowedPath` landing for existing roles is unchanged. Nav item "Dashboards" (`LayoutDashboard` icon) after Analytics. Users without `dashboards.use` see neither (F03 No access on a deep link).
- Both routes are children of the existing app layout route (session guard, Driver redirect unchanged). `/dashboards/$id` with a 404 shows an in-page state "This dashboard doesn't exist or is no longer shared with you" + "Back to dashboards"; 403/401 follow F02/F03.

## 3. `/dashboards` list
- **Header:** page title (Doto), "New dashboard" button (POST `{}` → navigate to `/dashboards/$id`; disabled with tooltip "You have 50 dashboards, the maximum" when `mine.length ≥ DASHBOARDS_PER_USER`; 409 `dashboard_limit` → toast).
- **Tabs** (Radix Tabs, URL `?tab`): "My dashboards (n)" and "Shared with me (n)". Data: `GET /api/dashboards` on mount and on window focus (stale > 30 s); `dashboardEvents` (F19, §8) trigger a refetch. Skeleton cards while loading; error → inline retry.
- **Card** (responsive grid: 1 col < 640 px, 2 cols < 1024, 3 cols ≥ 1024; whole card is a link to `/dashboards/$id`): title (2-line clamp), `widgetCount` ("3 widgets"), "Updated 14:32 IST" (`formatIst`; "Today/Yesterday" prefix rules as F15), badge: mine with `shareCount > 0` → "Shared · n"; shared-with-me → "Shared by {ownerName}". Kebab menu (Radix DropdownMenu, not part of the link):
  - Owner: **Open**, **Rename** (dialog, input prefilled, 1–80 chars, PATCH `{version, title}`; 409 → refetch list + toast "Changed elsewhere, try again"), **Duplicate** (POST `/duplicate` → toast "Duplicated" with "Open" action; list refetch), **Share** (share dialog §7), **Delete** (AlertDialog "Delete '{title}'? Its chat is deleted too. This can't be undone." → DELETE → card removed, toast).
  - Viewer: **Open**, **Duplicate** (copy becomes the caller's, lands in My dashboards).
- **Empty state** (shown in "My dashboards" when `mine` is empty; the full-page variant when both lists are empty): inline SVG illustration (token colours only), heading "Ask FMS to build your first dashboard", a prompt box (textarea, 1–2000 chars, Enter sends, Shift+Enter newline, "Build" button), 3 example prompt chips that **fill** the box (don't send): "Show today's running, idle and stopped vehicles by fleet", "Top 10 vehicles by idle time this week and open breakdown requests", "Daily distance and energy used over the last 30 days". **Start blank** button = "New dashboard". Submitting the prompt: POST `{}` → navigate `/dashboards/$id?ask=<prompt>` (§8). Without `chat.use` the prompt box and examples are hidden and the text reads "Create a dashboard to get started".
- A non-empty "Shared with me" tab with no items shows "Nothing shared with you yet".

## 4. `/dashboards/$id` page
### 4.1 Layout
- Desktop (viewport ≥ 1024 px): title bar on top; below it the grid area (scrolls) and, for owners with `chat.use`, the **chat dock** on the right (360 px, `--elev-panel`, collapsible to a 44 px rail with an "Ask FMS" button; collapsed state kept in `localStorage['fms.dashboards.chat']`, read/written in try/catch, default open). Viewers and users without `chat.use` get no dock.
- Below 1024 px the dock becomes a bottom sheet (existing `vaul` `drawer.tsx`) opened from an "Ask FMS" button in the title bar; the grid takes the full width.
- Data: `GET /api/dashboards/:id` (zod-parsed) into a per-page `DashboardSession` store (§5). Loading → title-bar skeleton + 3 widget skeletons.

### 4.2 Title bar
- **Title:** Doto; owner clicks (or presses Enter on) it to edit inline (input, 1–80, Enter/blur saves, Esc cancels), saved through the mutation queue (§5). Viewers see plain text plus a badge "View only · shared by {ownerName}".
- **Save status** (owner, `aria-live="polite"`): "Saving…", "Saved 14:32 IST" (from `updatedAt`), "Couldn't save · Retry" (button), "Offline, will retry". Viewers: "Updated 14:32 IST".
- **Actions:** Refresh (all widgets, analytics refetch + live requery; spinner while any widget loads), Share (owner), Duplicate (all; opens the copy), Delete (owner; same confirm; then navigate to `/dashboards` + toast), chat toggle (owner with `chat.use`). Below 640 px everything except Refresh moves into a "More" menu.

### 4.3 Grid
- `Responsive` with the F18 breakpoints. **The breakpoint follows the grid container width** (RGL default, D-128), not the viewport: with the dock open at 1440 px the grid is `md` (6 cols); collapsing the dock can switch it to `lg`. Rendering uses `dashboard.layout[bp]` for the active breakpoint.
- **Owner:** drag by the widget header's handle (`.widget-drag-handle`, grip icon + title area), resize from the bottom-right handle; `minW/minH` from the stored items (fallback `WIDGET_SIZES`, scaled for md, `sm` w = 1). Drag/resize are **disabled at `sm`** (1 column; touch scrolling wins) and for viewers (`static` grid, no handles rendered).
- A drag/resize changes only the active breakpoint's layout (RGL behaviour). `onLayoutChange` keeps local state in sync (including compaction), but a **save is scheduled only from `onDragStop`/`onResizeStop`** or keyboard moves (§10), never on mount or breakpoint change, so opening a dashboard never writes.
- **Empty dashboard** (0 widgets): the grid area shows "Ask FMS to add widgets" with a button that opens/focuses the chat (owner with `chat.use`); viewers see "This dashboard has no widgets yet".
- Max 24 widgets (contract); F20 has no "add widget" UI — widgets are added and their settings changed via the chat (F19). F20 edits only widget titles, removal and layout.

## 5. Saving: `DashboardSession` store (`store/dashboard-session.ts`)
- Holds `{dashboard, saveState, lastError, noticeVersion}`; React reads it with `useSyncExternalStore`.
- **One serial mutation queue** per open dashboard. Every PATCH (title, widget title, widget removal, layout) goes through it with the latest known `version`; the response replaces `dashboard` (new `version`, server-normalised layout). Edits are optimistic (local state first).
- **Layout autosave:** `scheduleLayout(allLayouts)` debounces **800 ms**; repeated drags coalesce into one PATCH `{version, layout}` containing all three breakpoints, sanitised to `{i,x,y,w,h,minW?,minH?}` (RGL's `moved`/`static`/`isDraggable`… dropped; `x+w ≤ cols` clamped). While a PATCH is in flight, newer changes wait and go out with the returned version. `flush()` sends a pending debounce at once (used on route leave and `visibilitychange: hidden`).
- **409 `version_conflict`:** the queue is cleared, `GET /dashboards/:id` replaces the state (soft reload, not `location.reload()`), and a toast says "This dashboard was changed elsewhere. Showing the latest version." Local unsaved changes are discarded (no merge). 403 (share revoked mid-session) → reload → 404 state. Network/5xx → `saveState: 'error'`, retry with backoff 2/4/8 s, then manual Retry; leaving the page with unsaved changes shows the browser `beforeunload` prompt only in that error state.
- **Widget removal:** optimistic, PATCH `{version, widgets}` (layout normalised server-side), toast "Widget removed · Undo" (5 s) re-PATCHes the previous `widgets` + `layout`.

## 6. Widgets
### 6.1 Frame (`widget-frame.tsx`)
- `<section role="region" aria-labelledby>` on `glass`/`--elev-panel` surface. Header: drag handle (owner, ≥ md), title (Inter 13 px semibold, truncated, full title in `title` attr), a small "live" dot for worker widgets, last-updated tooltip, menu button (Radix DropdownMenu): **Refresh** (all); owner only: **Edit title** (inline, 1–60, saved via §5) and **Remove**.
- Body states (shared `widget-states.tsx`, same copy in every renderer): **loading** (skeleton shaped per type; kept for the previous data during refresh, with a thin progress bar instead), **empty** ("No data for this period" / "No vehicles match" / type-specific), **error** ("Couldn't load this widget" + Retry; 404 "Vehicle/driver/fleet not found"), **no access** ("You don't have access to this data", when `!can(me, widgetPermission(w))`; nothing is fetched), **outside your fleets** (API 403, or a live widget whose `fleetId`/`fleetIds` are not in the viewer's permitted fleets).
- Each widget body is wrapped in an error boundary (a renderer bug shows the error state for that widget only). Unknown widget types can't occur (zod-parsed), but the renderer `switch` has an exhaustive `never` check.

### 6.2 Data hooks
- **Time ranges** (`data/time-range.ts`, IST via `istDayStart`): `today` = IST midnight → now; `yesterday` = previous IST day [00:00, 24:00); `7d`/`30d`/`90d` = the last N IST days including today (`from = istDayStart(now) − (N−1) days`, `to = now`), same as F16 `windowOf`.
- **Analytics/REST widgets** (`use-widget-data.ts`): a widget maps to one request URL (`data/widget-queries.ts`); a per-dashboard query cache dedupes identical URLs across widgets, aborts on unmount, refreshes every **60 s** (a single page timer; paused while `document.hidden`, immediate refresh on return if stale), on widget Refresh and on title-bar Refresh. Data is always fetched with the viewer's session (D-116).
- **Live widgets** (`live/use-live-widget.ts`): registered with one page-level `LiveWidgetSource` that calls the new worker query (§9) at most once per second while the page is visible and the store is running; results update only when the worker data version changed. If the viewer lacks `live.view` the worker isn't running → no-access state; before the first complete snapshot → loading.

### 6.3 Renderers (`widgets/*.tsx`)
| Type | Data | Renders |
|---|---|---|
| `kpi` analytics | `GET /api/analytics/summary?from&to&fleetId&vehicleId&driverId` | Single `KpiTile` (extracted from F16 `kpi-tiles.tsx`; `KpiTiles` maps over it, no visual change to F16): Doto value, unit, range label ("Last 7 days"). Metric labels/units/extractors from F16 `TileDef`s plus `uptimePct`, `eventsPer100Km`, `score`, `vehicleCount`. No delta in v1. |
| `kpi` live | worker `counts` | Same tile; value = `counts[status]` or `total`; status colour dot from `STATUS_META`. |
| `daily-chart` | `GET /api/analytics/series?from&to&…` | F16 `DayChart`: `bar→bars`, `line→lines`, `area→stacked`; series colours as F16; its hidden table + keyboard tooltip unchanged. |
| `status-breakdown` | worker `counts` (optionally `fleetId`) | New in-house SVG: `bars` = horizontal bars per status (label, count, %), `donut` = SVG donut + legend; statuses limited to `statuses` if set; colours `var(--st-…)`; a visually hidden list for screen readers. |
| `ranking` | `GET /api/analytics/vehicles|drivers?from&to&fleetId&sort=<metric>[:asc]&limit` | F16 `RankingTable` with a new optional `compact` prop (rank, name, ranked metric only); row click → `/analytics?tab=…&vehicle|driver=<id>&range=…` when the viewer can open Analytics. |
| `vehicle-list` | worker `list` | Small table of the chosen `columns` (formatters/labels from F09 `TABLE_COLUMNS`; fleet name from the live store's `fleets`), sorted, ≤ `limit` rows, footer "12 of 340 vehicles"; row click → `/live-tracking?vehicle=<id>`. |
| `driver-list` | `GET /api/drivers?status&fleetId&q&limit` | Table: name, status pill, fleet, current vehicle; row click → `/admin/drivers` drawer for that driver (F12 URL). |
| `requests-summary` | `GET /api/requests?type&fleetId&limit=500` | `counts`: bars per status or type (client grouping, `openOnly` filter, "500+" when `nextCursor`); `latest`: newest `limit` rows (type, vehicle, status, age); row click → `/requests/$id`. |
| `text` | none | F17 `markdown.tsx` subset (never HTML); scrolls inside the widget. |

All renderers fill the frame (SVG `viewBox` + `preserveAspectRatio`, tables scroll inside, `.widget-no-drag` on scrollable areas) and re-layout on resize without refetching.

## 7. Share dialog (owner)
- Radix Dialog "Share '{title}'". Top: search input (debounced 250 ms) → `GET /api/dashboards/share-candidates?q` (≤ 50), results as a checkbox list (name + email), already-shared users shown checked and disabled. "Share" → `POST /shares {userIds}` (≤ 20 per call); the response (full list) refreshes the "People with access" list. 422/409 `share_limit` → inline error "A dashboard can be shared with up to 50 people".
- "People with access" (`GET /shares` on open): owner row "You (owner)", then each share (name, email, "Shared 14:32 IST", **Revoke** button → `DELETE /shares/:userId`, row removed, toast with no undo). Copy: "People you share with can view this dashboard with their own data access. They can't edit it."
- Closing updates `shareCount` on the card/title bar.

## 8. F19 integration seam (F19 owns chat logic; F20 owns the dock and page)
Aligned with the F19 draft spec §7 (`src/features/assistant/`, F19-owned). F20 consumes, never edits:
```ts
useDashboardChat(dashboardId, {
  onDashboardChanged(dashboard: Dashboard, event?): void,   // per mutating tool call and after Undo
  onDashboardCreated(summary: DashboardSummary, url: string): void,
}) => { state, send(text), stop(), retry(), undo(changeId, version) }
// components: MessageList, Composer (F17, extended by F19), ChangeChip, DashboardLinkCard
// dashboard-events.ts: dashboardEvents.emit/subscribe({kind: 'created'|'changed', dashboardId})
```
- F20's `chat-dock.tsx` composes them: dock frame (header "Ask FMS", collapse, 360 px, mobile sheet), `MessageList` with `ChangeChip`s, `Composer`, a "not configured" state from `state.notConfigured`. Mounted only for `access === 'owner'` and `can(me, 'chat.use')`; one `useDashboardChat` per page (disposed on leave).
- **`onDashboardChanged` → `session.adoptRemote(dashboard)`:** the session takes the new `version`, widgets and title at once ("straight away"). A pending (debounced or queued) layout save is **rebased**: the user's pending positions are re-applied for widgets that still exist, new widgets keep the server's positions, and the PATCH goes out with the new version. An in-flight PATCH that lands after a newer remote version is ignored if its version is lower. Widget data reloads only for added/changed widgets (id + settings hash).
- **Undo** from a chip passes `session.version`; its 200 comes back through `onDashboardChanged`.
- **Prompt handoff:** the empty-state prompt creates a blank dashboard and navigates to `/dashboards/$id?ask=<prompt>`; once the thread has loaded (`status: 'ready'`) the dock calls `send(prompt)` once and strips `?ask` (`navigate({replace: true})`). The F19 global panel's `DashboardLinkCard` covers the other entry path.
- **List refresh:** the list page subscribes to `dashboardEvents` and refetches on `created`/`changed`.
- Before F19's files land on the branch, F20 unit tests use a test double of `useDashboardChat`; F20-T9 runs after both agents' files are on the branch.

## 9. Worker: read-only widget query (D-129)
New method on `LiveTrackingWorkerApi` (and a passthrough `liveTrackingStore.queryWidgets`, the only change to the main-thread store):
```ts
export interface LiveListFilter {        // = vehicle-list `filter` (F18), no search/models
  statuses?: VehicleStatus[]; fleetIds?: string[]; assetTypes?: string[];
  fuelTypes?: string[]; makes?: string[]; socMin?: number; socMax?: number;
}
export type LiveWidgetQuery =
  | { kind: 'counts'; fleetId?: string }                                   // kpi live, status-breakdown
  | { kind: 'list'; filter: LiveListFilter; sort: TableSort; limit: number }; // vehicle-list (limit ≤ 50)
export type LiveWidgetResult =
  | { kind: 'counts'; counts: Record<VehicleStatus, number>; total: number }
  | { kind: 'list'; total: number; rows: TableRow[] };
export interface LiveWidgetBatch {
  version: number;            // fleet data version (rows + status sweep), not the filter version
  ready: boolean;             // snapshotComplete
  results: LiveWidgetResult[] | null;   // null when version === sinceVersion (unchanged)
}
queryWidgets(queries: LiveWidgetQuery[], sinceVersion?: number): LiveWidgetBatch;   // ≤ 24 queries
```
- Implemented in a new `worker/widget-query.ts`: its own predicate compiled from `LiveListFilter` (same semantics as F08: AND across fields, OR within, `fleetIds` expanded to subtrees with the fleet tree already given via `setFleets`, SoC bounds inclusive). It **never** calls `FilterEngine.setFilter`, reads or writes the global filter, viewport, selection, table order cache, map index or tray, and never triggers a push. `counts` without `fleetId` returns the engine's global `statusCounts` (O(1)); with `fleetId`, one scan. `list` = one scan + bounded top-k (k ≤ 50) by `sort`, rows via the existing `TableQueryEngine.row(i)` builder. Results are cached per (query key, data version), so many viewers of the same counts cost one scan per second.
- A unit test proves parity with `FilterEngine` for the same filter (randomised fleet state) and that `push.filteredCounts`, `getTray`, `queryTable` and the selection are unchanged after `queryWidgets` calls.

## 10. Mobile, themes, accessibility
- **Mobile (< 768 px container → `sm`):** one column in `layout.sm` order, no drag/resize, widget heights from `layout.sm.h` (min 2 rows), title-bar actions in "More", chat as bottom sheet. List cards one column. No horizontal page scroll at 360 px; 16 px gutters.
- **Themes:** only DS3 tokens (`--surface*`, `--text*`, `--st-*`, `--accent`, `--elev-*`); SVGs use `var(--…)` so a theme switch needs no re-render; Doto for page/dashboard titles and KPI numbers, Inter elsewhere (D-114). The DS3-T1 token scan covers the new files and `dashboard-grid.css`.
- **Accessibility:** tabs, menus and dialogs via Radix (focus trap, Esc, return focus). Each widget is a labelled region; charts keep F16's hidden tables. **Keyboard move/resize (D-133):** the drag handle is a button "Move {title}"; Space/Enter grabs, arrows move by one cell, Shift+arrows resize, Space/Enter drops (saves like a drag), Esc cancels; each step is announced in a polite live region ("Moved to column 4, row 2"). Delete confirm focuses Cancel. Save status and 409 notice are announced. Targets ≥ 32 px (24 px on dense table rows), visible focus rings (`--ring`).

## 11. Performance
- **Chunks (gzip):** `dashboards-page` ≤ 15 kB; `dashboard-page` ≤ 60 kB including RGL and its deps (excluding F19's chat code and the shared F16 component chunk); its CSS ≤ 4 kB. `app-entry` grows ≤ 1.0 kB gz (routes, nav item, store passthrough); live-tracking worker chunk grows ≤ 3 kB gz; **no RGL/draggable/resizable code outside `dashboard-page`** (F20-T17). Sizes and deltas vs `main` go in the test report.
- **Worker:** `queryWidgets` with 6 live queries over 1 lakh vehicles ≤ 10 ms p95 (worker perf unit test, like `filter-search.perf.test.ts`); unchanged-version calls ≤ 0.1 ms.
- **Main thread:** a 24-widget dashboard renders first content ≤ 1.5 s after navigation on the mock; live updates re-render only widgets whose result changed (memoised by result identity); no long task > 50 ms while dragging (checked once in Playwright with a `PerformanceObserver`, reported, not gated).
- Existing perf e2e (`perf` project) must stay green; run once at the end (relaxed-testing preference).

## 12. Files (kebab-case)
```
src/features/dashboards/api/dashboards-api.ts            zod-parsed REST wrappers (list/get/create/patch/duplicate/delete/shares/candidates)
src/features/dashboards/pages/dashboards-page.tsx        list route (tabs, cards, empty state)
src/features/dashboards/pages/dashboard-page.tsx         detail route (title bar, grid, dock, 404 state)
src/features/dashboards/components/dashboard-card.tsx | dashboards-empty-state.tsx | rename-dialog.tsx
src/features/dashboards/components/delete-dialog.tsx | share-dialog.tsx | dashboard-title-bar.tsx | chat-dock.tsx
src/features/dashboards/components/dashboard-grid.tsx + dashboard-grid.css   only RGL importer
src/features/dashboards/components/widget-frame.tsx | widget-states.tsx | keyboard-arrange.ts
src/features/dashboards/widgets/widget-renderer.tsx + kpi-widget.tsx, daily-chart-widget.tsx,
  status-breakdown-widget.tsx, ranking-widget.tsx, vehicle-list-widget.tsx, driver-list-widget.tsx,
  requests-summary-widget.tsx, text-widget.tsx
src/features/dashboards/data/time-range.ts | widget-queries.ts | query-cache.ts | use-widget-data.ts
src/features/dashboards/live/live-widget-source.ts | use-live-widget.ts
src/features/dashboards/store/dashboard-session.ts | dashboard-list-store.ts
src/features/dashboards/lib/layout.ts                    sanitise/clamp, keyboard move maths
src/features/dashboards/*.test.ts(x)                     F20-T2…T7
src/features/live-tracking/worker/widget-query.ts (+ .test.ts, .perf.test.ts)
src/features/live-tracking/worker/worker-api.ts, live-tracking-engine.ts, store/live-tracking-store.ts  (+ queryWidgets)
src/features/analytics/components/kpi-tiles.tsx (extract KpiTile), ranking-table.tsx (+ compact)
src/features/access/permissions/can.ts (ROUTE_PERMISSIONS), src/app/router.tsx, src/app/nav-items.ts
e2e/dashboards.spec.ts, e2e/dashboards-helpers.ts (API seeding via request context)
package.json, pnpm-lock.yaml (react-grid-layout 2.2.4)
docs: feature catalogue, decision rows D-127…D-133 (Proposed), conversation logs, test-report.md + screenshots/
```
F19 owns `src/features/assistant/**` (incl. `use-dashboard-chat.ts`, `dashboard-chat-store.ts`, `dashboard-events.ts`, chips), the chat route, fake-model scripts and the tools; no file is edited by both agents.

## 13. Acceptance tests
| ID | Type | Test |
|---|---|---|
| F20-T1 | spike (vitest + e2e) | RGL 2.2.4 `Responsive` mounts under React 19 StrictMode with no console errors; a mouse drag and a resize change the layout; no `findDOMNode` warning. |
| F20-T2 | unit | `time-range`: `today`/`yesterday`/`7d`/`30d`/`90d` in IST around midnight IST and UTC; `widget-queries`: each catalogue type → exact URL (sort `:asc`, `limit`, optional ids), dedupe of equal URLs, `widgetPermission` → no-access without a fetch. |
| F20-T3 | unit | `DashboardSession`: 800 ms debounce coalesces drags into one PATCH with all breakpoints, sanitised; serial queue carries the returned version; no save on mount/breakpoint change; 409 → GET + notice, queue cleared; 5xx → retry/backoff → manual Retry; `adoptRemote` rebases a pending layout save onto the new version and ignores a stale in-flight response; widget remove + Undo. |
| F20-T4 | unit (worker) | `queryWidgets`: counts/list parity with `FilterEngine` on random states; fleet subtree expansion; top-k sort both directions; `sinceVersion` short-circuit; global filter, `filteredCounts`, table cache, tray and selection untouched. Perf: ≤ 10 ms p95 at 1 lakh / 6 queries. |
| F20-T5 | component | Widget frame states (loading, empty, error + retry, no access, outside your fleets, error boundary); owner menu = Refresh/Edit title/Remove, viewer = Refresh; each renderer with fixture data (incl. donut, "500+"). |
| F20-T6 | component | Share dialog: search debounce, candidates, add, people list, revoke, `share_limit` message. |
| F20-T7 | component | List page: tabs + counts + `?tab`, card badges, owner vs viewer menus, rename/delete dialogs, empty state (examples fill the box, Start blank), prompt hidden without `chat.use`, limit-disabled New button. |
| F20-T8 | e2e | Empty state for a user with no dashboards; Start blank → `/dashboards/$id` with "Ask FMS to add widgets"; nav item visible for ops, hidden for viewer. |
| F20-T9 | e2e (F19 fake model) | Prompt from the empty state → new dashboard opens, the chat sends the prompt, ≥ 3 widgets render with data; `?ask` is removed; list shows the card. |
| F20-T10 | e2e | Seeded dashboard (API) at 1440 px with the dock collapsed (lg): drag one widget and resize another, wait for "Saved", reload → same positions/sizes; keyboard move of a third widget also persists. |
| F20-T11 | e2e | Rename (title bar and card), duplicate (card + title bar; "(copy)" opens), delete with confirm (Cancel keeps it; Delete removes and returns to the list). |
| F20-T12 | e2e | Share to superadmin → superadmin sees it under "Shared with me", opens it read-only (no handles, no dock, banner, menu has only Refresh), can Duplicate; owner revokes → superadmin's reload shows the 404 state. |
| F20-T13 | e2e | Conflict: two pages on one dashboard; rename in A, drag in B → B shows the notice and A's title; nothing lost on the server. |
| F20-T14 | e2e | Live: `status-breakdown` + live `kpi` totals equal the status-bar counts (±1 sweep) and change over time; set a status filter on live tracking, open the dashboard → widgets unfiltered; back on live tracking the filter chips and counts are unchanged. Analytics widget refreshes after 60 s (clock project, `page.clock`) and on Refresh. |
| F20-T15 | e2e | Mobile 390×844: one column, no drag handles, chat in a sheet, no horizontal scroll; light theme: list + detail screenshots (`FMS_SHOTS=1`), DS3-T1 token scan passes. |
| F20-T16 | e2e | Viewer with fewer fleets (F18-T7 custom role): a shared widget with a sibling `fleetId` shows "Outside your fleets"; a `requests-summary` widget for a user without `requests.manage` shows "no access" and makes no request. |
| F20-T17 | cmd | `pnpm check`, `pnpm build`; chunk sizes vs budgets (§11) and a dist grep proving RGL is only in `dashboard-page`; e2e setup + chromium + clock green; perf project once. |

## 14. Decisions to propose
- **D-127:** `react-grid-layout` pinned `2.2.4`, v2 API (`Responsive` + `useContainerWidth`, not `/legacy`), imported only from `dashboard-grid.tsx` in the lazy `/dashboards/$id` chunk with `react-grid-layout/css/styles.css`; resize-handle and placeholder styles in our own token CSS (no direct `react-resizable` dep).
- **D-128:** Grid breakpoint follows the grid container width; drag/resize edit only the active breakpoint; saves send all three layouts; drag/resize off at `sm` and for viewers; saves only on drag/resize stop or keyboard moves.
- **D-129:** Live widgets use a new read-only worker query `queryWidgets` (own predicate, per-version cache, `sinceVersion` short-circuit), polled ≤ 1 Hz by a page-level source; the global filter/viewport/selection/table state is never touched.
- **D-130:** One serial mutation queue per open dashboard; layout debounced 800 ms; 409 → soft reload (GET) + notice, no merge; widget removal is optimistic with a 5 s Undo toast.
- **D-131:** REST widgets: per-dashboard deduping query cache, 60 s refresh paused while hidden, manual refresh; relative ranges resolved in IST like F16; client permission check before fetching.
- **D-132:** F19 seam = F19's `useDashboardChat` + chat components composed in an F20-owned dock; remote changes adopted at once with pending layout saves rebased; empty-state prompts create a blank dashboard and hand off via one-shot `?ask=`; list refreshes on `dashboardEvents`.
- **D-133:** Keyboard alternative to drag/resize (grab with Space/Enter, arrows move, Shift+arrows resize, live-region announcements).

## 15. Risks
- RGL v2 is a rewrite (Dec 2025); prop names in §1 follow the 2.2.4 README and are confirmed by the T1 spike. Fallback: `react-grid-layout/legacy` (`WidthProvider(Responsive)`) with the same layouts; D-127 is updated if used.
- Container-width breakpoints mean an owner editing with the dock open mostly edits `md`; `lg` changes need the dock collapsed or a wide screen (Q2).
- `queryWidgets` scans add worker CPU at 1 Hz; capped by the per-version cache, `limit ≤ 50`, ≤ 24 queries, and only while a dashboard page is visible.
- Chat turns (F19) and manual layout edits race on `version`; mitigated by adopting `dashboard_changed` versions and rebasing pending saves (F19 rebases AI edits server-side), otherwise a 409 soft reload.
- **Decision-ID clash:** the F19 draft spec numbers its decisions D-122…D-127, so D-127 is used twice. Renumber one side before sign-off (Q8).
- `requests-summary` counts are exact only up to 500 requests (F18 risk, shown as "500+").
- F20-T9 depends on F19's fake model scripts on the same branch; schedule it after the F19 agent's files land.
- A user with `dashboards.use` but no `chat.use` can only create blank dashboards or duplicate shared ones (no add-widget UI in F20).

## 16. Out of scope
TV/kiosk mode, PDF export, folders/tags (intent); widget settings editing outside chat; an "add widget" picker; edit sharing; public links; deltas vs the previous period on KPI widgets.

## 17. Resolved questions (user, 2026-10-15)
1. `react-grid-layout` pinned to **2.2.4**.
2. The breakpoint follows the **grid container width**, with the `lg` threshold tuned so that a 1440 px window with the chat dock open still gets the 12-column `lg` layout.
3. Drag/resize is off on phones (`sm`).
4. Live widgets poll the worker at most once a second.
5. Removing a widget is optimistic, with a 5 s Undo toast (no confirm dialog).
6. F19 ships `useDashboardChat` + chat parts; F20 builds the dock.
7. Users without `chat.use` can create blank dashboards and edit them by hand, with a hint that the assistant needs chat access.
8. F20 decisions renumbered to D-127…D-133.
