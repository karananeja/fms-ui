# F10 — Share Live Location (create, manage, public page) · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-14 (user)** |
| Intent | `intent.md` (signed off 2026-10-13) |
| Visual source of truth | In-app parts: DS1 tokens + Doto (the F07 card's "Share live location" gradient CTA, F07-R8). Public page: a **light** variant of DS1 proposed in §4 and confirmed by UAT screenshots. |
| Server contract | Built in F01, **no mock changes**: `POST/GET /api/share-links`, `DELETE /api/share-links/:id`, `GET /api/public/share/:token` (+ `/trail`), WS `/ws/live?share=<token>` (`shared/contract/share-links.ts`, `payloads.ts` `SHARE_GROUP_KEYS`, D-026/D-027). Unknown token → 404 / WS close 4401; expired or revoked → 410 / WS close 4410. |
| Delivery | **Two agents in parallel, no contract commit.** Each owns its own API file:<br>• **F10a** In-app: create + manage. Branch `feature/f10a-share-manage`, D-086…D-088.<br>• **F10b** Public page. Branch `feature/f10b-share-public`, D-089…D-091.<br>Both merge on `integration/f10`, where the orchestrator adds the cross-feature e2e (T9). |

## 1. Files (kebab-case)
```
src/features/share/
  api/share-api.ts                (F10a) createShareLink, listShareLinks({vehicleId?}), revokeShareLink
  manage/share-dialog.tsx         (F10a) dialog/sheet with two tabs: Create · Links (n)
  manage/share-form.tsx           (F10a) expiry, visible data, trail options → create → copy URL
  manage/share-link-list.tsx      (F10a) list rows (status, expiry, options, copy, revoke); used by the dialog and the admin page
  manage/share-links-page.tsx     (F10a) /admin/share-links: every link in your scope
  lib/share-expiry.ts             (F10a) presets, custom IST date/time ↔ epoch, validation
  public/public-share-api.ts      (F10b) getPublicShare(token), getPublicTrail(token)
  public/share-socket.ts          (F10b) one-vehicle WS client (main thread, no worker), reconnect, close codes
  public/public-share-page.tsx    (F10b) /share/$token: header, map, metrics, states
  public/public-share-map.tsx     (F10b) MapLibre map with marker, trail, follow/recenter
  public/public-metrics.tsx       (F10b) metric cards per allowed group
  public/share-unavailable.tsx    (F10b) "This link is no longer available" / "Link not found"
src/features/live-tracking/components/overview-tab.tsx   (F10a) show the CTA when can('share.create'); opens the dialog
src/app/router.tsx, nav-items.ts, permissions/can.ts      (F10a) /admin/share-links route + nav item; (F10b) /share/$token component only
public/map-styles/blank-light.json                         (F10b) light blank style for e2e (like blank-dark.json)
```
No new dependencies. The public page's chunk must not import the live-tracking store, worker or admin code.

## 2. Requirements

### Create and manage (F10a)
| ID | Requirement |
|---|---|
| F10-R1 | **Entry point:** the F07 Overview tab's "Share live location" CTA shows only with `share.create` (hidden otherwise) and opens the **Share dialog** for the selected vehicle. Desktop: centred dialog (F07 card style, 480 px). Mobile: bottom sheet. Tabs: **Create** · **Links (n)**, where n is the number of active links for this vehicle. |
| F10-R2 | **Expiry:** presets 1 h · 6 h · **24 h** (default) · 7 days · Custom. Custom = date + time inputs read and shown in **IST**. It must be at least 5 min in the future and at most 30 days ahead, with an inline error. The resolved expiry is shown under the field ("Expires 15 Oct, 6:30 pm IST"). |
| F10-R3 | **Visible data:** Location is always on (shown checked and disabled). Optional groups: **Driving · energy** (speed, SOC, range, odometer…) and **Device** (signal, device/car battery, device ID). The labels list what each group contains, taken from `SHARE_GROUP_KEYS`. Both are off by default. |
| F10-R4 | **Trail:** off by default. When on, choose a window: 15 min · **1 h** (default) · 6 h · 24 h (contract max 1440 min). |
| F10-R5 | **Create:** `POST /api/share-links` → a result view with the full URL (`location.origin + url`), a **Copy** button ("Copied" for 2 s, plus a toast), **Open** (new tab) and **Create another**. Errors show inline (422 from the server, 403 if out of scope). |
| F10-R6 | **Links tab:** `GET /api/share-links?vehicleId=`, newest first. Each row shows:<br>• a status pill: Active / Expired / Revoked;<br>• expiry as relative time + IST;<br>• chips for the options (Location · Driving · Device · Trail 1 h);<br>• the creator (with `share.revoke`).<br>Row actions: **Copy**, plus **Revoke** (confirm: "Anyone with this link loses access now") on active links you created or, with `share.revoke`, any link. Without `share.revoke` the server returns only your own links. Expired/revoked rows are dimmed and collapsed under "Show N inactive". |
| F10-R7 | **Admin list** (`/admin/share-links`, `share.revoke`): every link in your scope. Columns: vehicle regno (links to `/live-tracking?vehicle=`), created by, created, expires, options, status. Filter by status (default Active), search by regno, Revoke. `share.revoke` joins `ADMIN_PERMISSIONS`, so the Admin group shows for it; add a "Share links" nav item and an overview card (active count). |

### Public page (F10b)
| ID | Requirement |
|---|---|
| F10-R8 | **Route `/share/$token`:** no sign-in, no app shell, no session probe, no fleet worker (already outside the app layout). It loads as its own lazy chunk. `GET /api/public/share/:token`: 200 → page; 410 → **"This link is no longer available"** (expired or revoked); 404 → **"Link not found"**. Both screens are calm and centred, with no app links. |
| F10-R9 | **Live position:** `share-socket.ts` opens `/ws/live?share=<token>` and subscribes to `combinfo` for the vehicle (and `lafparsed` only when `device` is shown, D-026). It keeps one vehicle's latest payload, ignores older `gpstime`, reconnects with backoff on network drops, and on close **4410/4401** switches to the unavailable screen without reconnecting. |
| F10-R10 | **Map:** light basemap (`VITE_SHARE_MAP_STYLE_URL`, default OpenFreeMap `positron`; e2e uses `/map-styles/blank-light.json`).<br>• Starts at the vehicle (zoom 15) and **follows** it as it moves; a user pan stops following and shows **Recenter**.<br>• Marker: heading arrow when moving, dot when stopped, DS1 accent.<br>• Trail when enabled: `GET …/trail` once, then live points appended, trimmed to the window. No trail request when it's disabled. |
| F10-R11 | **Header and info:**<br>• regno, `MAKE · MODEL`;<br>• a LIVE pill (stale after 2 min without data → "Last update 5 min ago");<br>• "**Link expires** in 5 h · 15 Oct, 6:30 pm IST".<br>At `expiresAt` the page shows the unavailable screen (local timer + the server's 4410 close, whichever comes first). |
| F10-R12 | **Metrics** (only the allowed groups; nothing is rendered for a hidden group, not even labels):<br>• Location (always): last GPS update (relative + IST), ignition on/off, moving/stopped.<br>• Driving · energy: speed, SOC ring, range (DTE), odometer.<br>• Device: signal bars, device battery, car battery.<br>Desktop: a floating card on the left. Mobile: a bottom card that can be collapsed. |
| F10-R13 | **Enforcement shown end to end:** the client never asks for data the link hides (no `lafparsed` subscribe without `device`, no trail fetch without trail). The server already strips hidden keys (D-026); T6 proves no hidden key reaches the page. |

## 3. Budgets
- Public page: first marker within 2 s of navigation on the mock (dev server). The JS for `/share/*` excludes the live-tracking store, worker and admin chunks (checked in the build output).
- Create dialog opens with no long task > 50 ms.

## 4. Look (proposal)
- **In-app (F10a):** F07 card style. Options are segmented controls (expiry, trail window) and checkbox rows with muted descriptions. The URL sits in a mono field with a gradient Copy button. Status pills reuse `TintPill` (active = ok, expired = muted, revoked = danger).
- **Public page (F10b):** light, map-first.
  - Light tokens are scoped to the page (`[data-theme="share-light"]`): `--bg #f6f8fa`, `--surface #ffffffe6` glass with a soft shadow, `--text #0f172a`, `--muted #64748b`, the same teal accent / teal→sky gradient as DS1, and status colours darkened for contrast on light. Doto stays the only font (D-054).
  - Header: a 56 px translucent bar over the map.
  - A small "Shared via FMS" footer mark, with no links into the app.

## 5. Parallel delivery
No shared contract commit is needed: F10a and F10b share only `shared/contract` (unchanged) and touch different routes.
- F10b tests on links created through the API in `beforeAll` (super admin `request` context, D-077 storageState), so it doesn't depend on F10a's UI.
- Expected merge conflicts are limited to `router.tsx` (two different routes) and the docs; the orchestrator resolves them on `integration/f10`.

## 6. Tests
| ID | Agent | Type | Test |
|---|---|---|---|
| F10-T1 | F10a | unit | `share-expiry`: presets, custom IST ↔ epoch round trip, < 5 min and > 30 days rejected. |
| F10-T2 | F10a | component | Dialog: CTA hidden without `share.create`; defaults (24 h, location only, trail off); create sends the exact body; copy; Links tab statuses, revoke confirm; revoke shown only where allowed. |
| F10-T3 | F10a | e2e | Super admin: create a link from the details card → the URL is copied → `GET /api/public/share/:token` 200 → revoke from the Links tab → 410. The admin page lists the link, filters by status, and revokes. A role without `share.revoke` sees only its own links and no admin page. |
| F10-T4 | F10b | component | `share-socket`: latest-wins, close 4410/4401 → unavailable with no reconnect, network close → reconnect. Page: hidden groups render nothing; 404/410 screens. |
| F10-T5 | F10b | e2e | Fresh signed-out context opens an API-created link (location + trail 1 h): marker visible, position updates within 20 s, trail drawn; pan → Recenter → follows again. Revoke via API → unavailable screen within 5 s, without a reload. |
| F10-T6 | F10b | e2e | **Enforcement:** location-only link → no WS frame contains any `SHARE_GROUP_KEYS` key, no `lafparsed` subscribe, no trail request, no metric labels for hidden groups. A driving-only link shows speed/SOC but no device keys in frames. |
| F10-T7 | F10b | e2e (clock) | `share-expiry.clock.spec.ts`: shift the mock clock past `expiresAt` → the open page shows the unavailable screen; a reload shows it too (D-038 clock project). |
| F10-T8 | both | e2e | UAT screenshots → `docs/features/f10-share-live-location/screenshots/`: share dialog (create, result, links), admin share links (F10a, `share-` prefix); public page desktop + mobile, location-only vs all data, unavailable, not found (F10b, `public-` prefix). |
| F10-T9 | orchestrator | e2e | On `integration/f10`: create in the UI → open the copied URL in a fresh context → live updates → revoke in the UI → the open page shows unavailable (the intent's "done when" flow). |
| F10-T10 | both | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock). Perf by the orchestrator after merge. |

## 7. Out of scope
Multiple vehicles per link, passwords, editing a link after creation (revoke and create a new one), custom branding of the public page, address lookup (reverse geocoding), and analytics of who viewed a link.
