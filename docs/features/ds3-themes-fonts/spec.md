# DS3 — Themes & Fonts · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-15 (user)** |
| Intent | `intent.md` (signed off 2026-10-15) |
| Decisions | Implements **D-114** (fonts) and **D-115** (themes). Supersedes **D-054** and DS1 "dark only". Keeps **D-090** (share page light look) and **D-108** (auth backdrop). New rows to propose: **D-117…D-118** (§9). |
| Visual source of truth | DS1 dark stays as is. Light = the palette in §2, confirmed by UAT screenshots in both themes. |
| Delivery | One agent in the main checkout, shared branch `feature/part3-ds3-f18` (runs alongside F18 with disjoint files), ports 5273/4101. DS3 owns `playwright.config.ts` and also adds F18's `MOCK_DB: ':memory:'` to the webServer env. No new npm dependencies (Inter via Google Fonts `<link>`). |

## 1. Theme mechanism
| ID | Requirement |
|---|---|
| DS3-R1 | **Preference:** `'light' \| 'dark' \| 'system'`, default `system`, stored in `localStorage['fms.theme']` (per browser, never on the server). An unknown or unreadable value counts as `system`. |
| DS3-R2 | **Resolved theme** is always `light` or `dark`, written to `<html data-theme="…">`. `:root` keeps the dark tokens (the fallback). `:root[data-theme='light']` overrides them, on the same element, so the shadcn aliases (`--primary`, `--ring`…) that are defined with `var()` at `:root` follow automatically. `color-scheme` is set per theme (scrollbars, form controls). |
| DS3-R3 | **No flash:** an inline, non-module `<script>` in `index.html` `<head>`, placed before any stylesheet or module script, reads the preference, resolves `system` via `matchMedia('(prefers-color-scheme: dark)')`, and sets `data-theme` plus `<meta name="theme-color">` (dark `#0a0d11`, light `#ffffff`, = `--surface-solid`). About 10 lines, wrapped in `try/catch`, falls back to `dark`. The hard-coded `class="dark"` on `<html>` is removed. |
| DS3-R4 | **Store:** `src/shared/theme/theme-store.ts`, class-based and React-free like `map-view.ts`: `get()` (preference), `resolved()`, `set(pref)`, `subscribe()`. It applies `data-theme` + `theme-color`, listens to the `matchMedia` `change` event only while the preference is `system`, and to the `storage` event (other tabs). `useTheme()` (`use-theme.ts`) wraps it with `useSyncExternalStore`. |
| DS3-R5 | **Toggle:** `src/shared/ui/theme-toggle.tsx`, a 3-option radio group (sun = Light, moon = Dark, monitor = System; `lucide-react` icons, already a dependency), labelled "Theme", with tooltips. Placed in the app header (`src/app/app-layout.tsx`) before `AskFmsButton`, and in the driver page header (`driver-home-page.tsx`). Below `sm` (640 px) it collapses to one icon button that cycles Light → Dark → System and announces the new value. Auth screens have no toggle; they follow the stored or OS theme. |
| DS3-R6 | **Public share page:** keeps `data-theme="share-light"` on its root (D-090) whatever the app theme, and does **not** import the theme store (the inline script still sets `<html data-theme>`, harmless). It picks up the new fonts (§4). |
| DS3-R7 | **Sonner** (`src/shared/ui/sonner.tsx`): `theme` comes from `useTheme().resolved` instead of the fixed `"dark"`. |

## 2. Tokens (`src/shared/styles/theme.css`)
The dark block is unchanged except for the new tokens marked **new**. The light block lists every token; a unit test enforces parity (DS3-T1).

| Token | Dark (DS1) | **Light** | Notes (contrast vs `#ffffff` / `--bg` light) |
|---|---|---|---|
| `--bg` | `#07090c` | `#f4f6f9` | app background |
| `--map-bg` | `#0c1015` | `#e9edf2` | before tiles load, auth street grid |
| `--glass` / `--glass-strong` | `rgba(14,18,24,.74/.9)` | `rgba(255,255,255,0.78)` / `rgba(255,255,255,0.94)` | same blur |
| `--glass-border` | `rgba(255,255,255,.08)` | `rgba(15,23,42,0.10)` | |
| `--surface-solid` | `#0a0d11` | `#ffffff` | rail, header, dialogs |
| `--tile` / `--tile-border` | `rgba(255,255,255,.035/.07)` | `rgba(15,23,42,0.035)` / `rgba(15,23,42,0.09)` | |
| `--text` | `#e8edf3` | `#0f172a` | 17.9 / 16.5 |
| `--text-muted` | `#8b96a8` | `#475569` | 7.6 / 7.0 |
| `--text-faint` | `#556072` | `#5b6678` | 5.8 / 5.4 (DS1 dark faint is decorative; light faint is kept AA because it carries hints and attribution) |
| `--accent` | `#2dd4bf` | `#0f766e` | 5.5 / 5.1: text, focus ring, active nav, selection. The DS1 fill teal `#2dd4bf` is only 1.8:1 on white |
| `--accent-2` | `#38bdf8` | `#0369a1` | 5.9 / 5.5, gradient stop |
| `--accent-soft` | `rgba(45,212,191,.13)` | `rgba(15,118,110,0.10)` | |
| `--accent-ink` | `#032a25` | `#ffffff` | white on `--accent` 5.5:1 (primary buttons) |
| `--accent-glow` / `--accent-halo` | teal .4 / .16 | `rgba(15,118,110,0.30)` / `rgba(15,118,110,0.12)` | |
| `--ok` / `--warn` / `--danger` | `#34d399` / `#fbbf24` / `#f87171` | `#047857` / `#b45309` / `#b91c1c` | 5.5 / 5.0 / 6.5 on white; all ≥ 4.6 on `--bg` |
| `--shadow` | `rgba(0,0,0,.45)` | `rgba(15,23,42,0.12)` | |
| `--vignette` | `rgba(5,7,10,.7)` | `rgba(233,237,242,0.65)` | map edges, auth |
| `--building` | `#18202a` | `#d5dbe3` | 3D extrusions |
| `--marker-ring` **new in dark** | `var(--bg)` | `#ffffff` | used by the request mini-map pin, today undefined in dark (bug) |
| `--scrim` **new** | `rgba(0,0,0,0.5)` | `rgba(15,23,42,0.32)` | modal/sheet overlays |
| `--elev-panel` **new** | `0 30px 80px rgb(0 0 0/.35)` | `0 12px 40px rgba(15,23,42,0.10)` | floating cards |
| `--elev-float` **new** | `0 30px 80px rgb(0 0 0/.55)` | `0 20px 60px rgba(15,23,42,0.18)` | dialogs, popovers, details panel |
| `--on-danger` **new** | `#ffffff` | `#ffffff` | badge/destructive text |
| `--font-sans` | `'Doto', …` | — | **`'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`** (both themes) |
| `--font-display` | `= --font-sans` | — | **`'Doto', 'Inter', system-ui, sans-serif`** (both themes) |

**Status colours (light).** Markers keep their DS1 hues, one step darker so they read on the pale basemap and as text in pills/callouts:

| Status | Dark | Light | vs white / `--bg` |
|---|---|---|---|
| running | `#4ade80` | `#15803d` | 5.0 / 4.6 |
| stopped | `#f87171` | `#dc2626` | 4.8 / 4.5 |
| immobilized | `#c084fc` | `#9333ea` | 5.4 / 5.0 |
| non-comm | `#64748b` | `#64748b` | 4.8 / 4.4 (dashed-ring shape also distinguishes it) |
| charging | `#60a5fa` | `#2563eb` | 5.2 / 4.8 |
| pullout | `#fb923c` | `#c2410c` | 5.2 / 4.8 |
| no-gps | `#facc15` | `#a16207` | 4.9 / 4.6 |
| gps-never | `#475569` | `#7f8ca0` | 3.4 / 3.2: graphics only (≥ 3:1 non-text); its pill label uses `--text-muted` |

`[data-theme='share-light']` stays as it is (D-090); it now inherits `--font-*` and the new tokens from `:root`.

`src/index.css` `@theme inline` gains `--color-scrim`, `--color-on-danger`, `--shadow-panel: var(--elev-panel)`, `--shadow-float: var(--elev-float)` and `--font-display`, so components use `bg-scrim`, `text-on-danger`, `shadow-panel`, `shadow-float`, `font-display`.

## 3. Hard-coded colours → tokens
Audit of `src/` today (excluding tests, `theme.css`, `color-alpha.ts`):

| Kind | Count / where | Strategy |
|---|---|---|
| Arbitrary shadows `shadow-[0_30px_80px_rgb(0_0_0/0.35\|0.55)]` | **17** in 14 files: access 7 (`admin-ui` 4, `fleets-page`, `fleet-dialog`, `admin-overview-page`), live-tracking 3 (`vehicle-details-panel`, `filter-panel`, `table-view`), analytics 3 (`kpi-tiles`, `analytics-charts`, `analytics-page`), `drivers-page`, `my-vehicle-card`, `request-table`, `share-dialog` | `.35` → `shadow-panel`, `.55` → `shadow-float` |
| Overlays `bg-black/40…/55` | **7**: `admin-ui` 3, `fleet-dialog`, `share-dialog`, `shared/ui/sheet`, `shared/ui/drawer` | `bg-scrim` (one value per theme) |
| `text-white` | **2**: `requests-nav-badge`, `shared/ui/button` (destructive) | `text-on-danger` |
| `dark:` variants | **2** in `shared/ui/button` (shadcn leftovers; Tailwind v4 `dark:` follows the OS, not our theme) | Remove them |
| Fixed dark config | `index.html` (`class="dark"`, `theme-color #0e0e0f`), `theme.css` `color-scheme: dark`, `sonner.tsx` `theme="dark"`, dark `STYLE_URL` defaults in `live-map.tsx` and `request-mini-map.tsx` | §1, §5 |
| Tokens resolved **once** to hex at runtime | `map-controller.ts` (`colors` field + layer paints + `--building`), `trail-layer.ts` (accent gradient), `cluster-marker.ts` (SVG `stroke="#…"`), `auth-backdrop.tsx` (dot colours) | §5 and below |

**Canvas / WebGL / generated SVG** (cannot use CSS variables, or bake them in):
- **MapLibre paints, SDF icon colours, trail gradient, buildings:** re-resolved with `getComputedStyle` after each theme change, as part of the style swap (§5).
- **Cluster donuts** (DOM markers): emit `style="stroke:var(--st-…)"` instead of resolved hex, so they follow the theme with no re-render. `.fms-cluster-core` already uses tokens.
- **DS2 auth backdrop canvas:** subscribes to the theme store; on change it re-reads `--accent`/`--accent-2` and recolours the live dots in place (no respawn). Grid, radar and vignette are CSS and follow automatically.
- **F16 / F07 SVG charts** (`day-chart`, `session-chart`, `ring-gauge`…) already use `style={{ fill: 'var(--…)' }}`: nothing to do beyond the screenshot check.
- **Share map** (`share-map-controller.ts`) only runs under `share-light`: unchanged.

**Guard:** the DS1-T1 scan regex has a loophole (`\brgb\(` does not match `80px_rgb(` because `_` is a word char). It becomes `/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|hwb)\(/i` and also rejects Tailwind palette colour classes (`(bg|text|border|ring|fill|stroke|from|to|via|shadow|outline)-(white|black|slate|gray|…)`) and `dark:`.

## 4. Fonts
| ID | Requirement |
|---|---|
| DS3-R8 | **Inter** from Google Fonts in `index.html`: `<link rel="preconnect" href="https://fonts.googleapis.com">`, `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`, and `css2?family=Inter:wght@400..700&display=swap` (one variable woff2 per subset). Offline it falls back to `system-ui` (D-114). |
| DS3-R9 | **Doto** keeps `@fontsource/doto`, trimmed to weights **800 and 900** (the 600/700 imports go). Used only through the `font-display` utility. |
| DS3-R10 | **Body:** Inter 400, `letter-spacing: 0` (the DS1 `font-weight: 600` and `0.01em` go). Weight map for the sweep outside display elements: `font-black` → `font-semibold` (600), `font-extrabold` → `font-semibold`, uppercase label tracking `0.12–0.16em` → `0.06em`. Numbers in tables, tiles' units, chat and forms use Inter with `tabular-nums`. Min size 11 px stays. MapLibre chrome and popups use `--font-sans` (Inter). |
| DS3-R11 | **Doto (`font-display`) stays only on:** |

| Role | Element(s) |
|---|---|
| Brand | `shared/ui/brand-mark.tsx` ("F"), the "FMS" word in the drawer `SheetTitle` (`app-layout.tsx`), driver header brand (`driver-home-page.tsx`) |
| Page titles | Header title `<span>` in `app-layout.tsx`; `admin-layout.tsx` h1; `auth-layout.tsx` h1; `placeholder-page`, `not-found-page` (h1 + "404"), `no-access-page`, `driver-app` h1; `share-unavailable` h1 and the share header regno; vehicle regno in `details-hero.tsx` and `my-vehicle-card.tsx` (`my-regno`) |
| Big KPI numbers | `analytics/kpi-tiles.tsx` (`tile-value`), `entity-drilldown.tsx` tile values, `access/admin-overview-page.tsx` counts (`text-4xl`), `fleet-pulse-card.tsx` 40 px total, `ring-gauge.tsx` centre value, `my-vehicle-card.tsx` SoC/DTE |
| Status counter numbers | `<b>` counts in `live-tracking/status-pills.tsx` (the pill label is Inter) |

Everything else (nav, tables, forms, buttons, chips, toasts, chat, tooltips, card section labels) is Inter.

## 5. Map
| ID | Requirement |
|---|---|
| DS3-R12 | **Light basemap: OpenFreeMap `positron`.** It is a quiet grey, so the status colours dominate, it has the `building` layer for 3D, and it matches the share page (D-090). `liberty` is rejected: its coloured landuse and road fills compete with the status hues. New env `VITE_MAP_STYLE_URL_LIGHT` (default `https://tiles.openfreemap.org/styles/positron`); `VITE_MAP_STYLE_URL` stays the dark one. Both URLs move to `map-config.ts` and are shared by `live-map.tsx` and `request-mini-map.tsx`. |
| DS3-R13 | **Swap:** `MapController` gets both URLs and the resolved theme, plus `setTheme(t)`, called from a theme-store subscription. It (1) remembers the camera (centre, zoom, bearing, pitch); (2) calls `map.setStyle(url, { diff: false })`; (3) on `style.load` runs the same idempotent `installOverlay()` that `onLoad()` uses today: SDF images, the `vehicles`/`selected`/`selected-trail` sources, the layers with **freshly resolved** token colours (status `match`, `icon-halo-color` = `--bg`, selection ring, trail gradient, 3D buildings via `apply3d`); (4) re-renders the last store snapshot, so markers and the selection come back from memory (no worker round trip); (5) `jumpTo` the remembered camera if it moved. Layer-scoped listeners (`mousemove`/`mouseleave` on `vehicles`) are registered once and survive. A swap while the first style is still loading only changes the URL used. |
| DS3-R14 | No `moveend` is triggered, so no new viewport goes to the worker. DOM markers (clusters, selected callout) stay mounted. The DS1 debug overlay gets a `theme swaps` counter (dev only). |
| DS3-R15 | **Request mini-map:** the same swap (`setStyle` + its DOM pin survives). The share page map is untouched. |
| DS3-R16 | **Tests:** `playwright.config.ts` adds `VITE_MAP_STYLE_URL_LIGHT=/map-styles/blank-light.json`; `blank-light.json` already exists. |

## 6. Files (kebab-case)
```
index.html                                          pre-paint script, Inter links, theme-color, drop class="dark"
src/index.css                                       Doto 800/900 only, @theme additions, body weight/tracking
src/shared/styles/theme.css                         :root[data-theme='light'] block + new tokens
src/shared/styles/theme-tokens.node.test.ts         DS3-T1/T2 (replaces DS1-T1/T2)
src/shared/theme/theme-store.ts (+ .test.ts)        DS3-R4
src/shared/theme/use-theme.ts
src/shared/theme/theme-boot.test.ts                 runs the index.html inline script in jsdom
src/shared/ui/theme-toggle.tsx (+ .test.tsx)        DS3-R5
src/shared/ui/sonner.tsx, button.tsx, sheet.tsx, drawer.tsx
src/app/app-layout.tsx, src/features/driver/pages/driver-home-page.tsx   toggle + display font
src/features/live-tracking/config/map-config.ts     style URLs
src/features/live-tracking/components/{live-map,map-controller,trail-layer,cluster-marker}.ts(x)
src/features/requests/components/{request-mini-map.tsx,mini-map-controller.ts}
src/features/auth/components/auth-backdrop.tsx
~45 component files                                 shadow/scrim/text-on-danger + font sweep (§3, §4)
src/vite-env.d.ts, .env.example, README.md          VITE_MAP_STYLE_URL_LIGHT
playwright.config.ts                                colorScheme: 'dark' default, light style env
e2e/fixtures.ts                                     stub fonts.googleapis/gstatic unless FMS_E2E_FONTS=1
e2e/themes.spec.ts, e2e/design-refresh.spec.ts      DS3-T4…T8; DS1-T2 font test updated
```

## 7. Acceptance tests
| ID | Type | Test |
|---|---|---|
| DS3-T1 | unit | Token scan with the tightened regex: no raw colours, palette classes or `dark:` outside `theme.css`. Every custom property in the dark `:root` block exists in the light block (and vice versa, except `--radius-*`/`--font-*`/aliases). `STATUS_META` resolves to the dark values; the light values match §2. |
| DS3-T2 | unit | Fonts: `--font-sans` starts with `'Inter'`, `--font-display` with `'Doto'`; `index.html` has both preconnects and the Inter `css2` link; no `@fontsource/doto/600|700` import; no npm package matching `inter`. |
| DS3-T3 | unit | Theme store: default `system`; `set()` persists and updates `data-theme`/`theme-color`; `system` follows a mocked `matchMedia` change and stops when set to `light`; a `storage` event syncs; throwing `localStorage` falls back to `system`. Boot script (`theme-boot.test.ts`): for each stored value × OS preference it sets the right `data-theme`; garbage → System; throwing storage → `dark`; meta colours equal `--surface-solid` of each block. Toggle: radio semantics, keyboard, mobile cycle. |
| DS3-T4 | e2e | Toggle → Light → reload: `<html data-theme="light">`, `body` background = `--bg` light. System + `emulateMedia({ colorScheme })` flips live. Persists across a new page in the same context. |
| DS3-T5 | e2e | **No flash:** with `localStorage['fms.theme']='light'` and the app entry script aborted (`page.route`), the HTML alone yields `data-theme="light"`; the same with `'dark'` under a light OS. |
| DS3-T6 | e2e | **Map swap:** at zoom 15, select a vehicle, pan; switch theme. Via `window.__fmsMap`: centre and zoom unchanged (≤ 1e-6), `highlight()` and the details panel unchanged, `vehicles` layer has rendered features, `selected-ring` exists, the style URL is the light one, no viewport message sent. Repeat back to dark, and with 3D on (buildings layer re-added). |
| DS3-T7 | e2e | Fonts: body, table cell, input, button, chat message use `Inter` first; brand mark, header title, KPI tile value and a status counter use `Doto` first. |
| DS3-T8 | e2e | Share page under app theme Light and Dark: root still `share-light`, body font `Inter`, regno `Doto`. The share chunk does not import `theme-store` (existing D-090 import check extended). |
| DS3-T9 | e2e | Screenshots → `screenshots/` in **both** themes (desktop 1440, plus 390 px for the starred ones): login★ (backdrop), live map with clusters★, zoom 15 + selection + details panel, table view, filter panel, admin overview, fleets, users, roles, invites/share links, drivers, driver page★, requests desk + drawer, analytics vehicles tab + drill-down, assistant panel, notifications panel, a dialog with scrim, a toast, the share page (fonts only). Run with `FMS_E2E_FONTS=1` so Inter renders. |
| DS3-T10 | perf | Not expected to move (fonts stubbed in perf, no worker change); run `live-map.perf` and `status-bar.perf` once since the map and pills change. |
| DS3-T11 | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock) once at the end. All existing tests pass with Playwright's default `colorScheme: 'dark'` (§8). |

## 8. Risks
- **Playwright defaults to a light OS.** With System as default, every existing e2e and screenshot would silently go light. The config sets `colorScheme: 'dark'` for all projects; theme tests override it per test.
- **Font sweep size:** about 190 weight classes across ~45 files. Mechanical but visible everywhere; the DS3-T9 screenshots are the review. Tables get a little narrower (Inter is narrower than Doto), so column widths in `table-view` may want a pass.
- **Google Fonts at runtime:** blocked networks get `system-ui` (accepted in D-114). e2e stubs the requests to stay offline and deterministic.
- **Style swap cost:** positron/dark tiles reload (about 0.5–1 s of basemap repaint); our layers come back in the same `style.load` frame. Rapid toggling is coalesced to the last value.
- **Status hues differ by theme**, so a screenshot shared between users on different themes shows different shades of the same status.

## 9. Decisions to propose
- **D-117:** light basemap `positron` via `VITE_MAP_STYLE_URL_LIGHT`; theme swap = `setStyle(diff:false)` + re-install overlay with re-resolved tokens on `style.load`, camera restored.
- **D-118:** theme tokens added (`--scrim`, `--elev-panel`, `--elev-float`, `--on-danger`, dark `--marker-ring`), light accent `#0f766e` (not the DS1 fill teal), darker light status colours; storage key `fms.theme`; Playwright default `colorScheme: 'dark'`.

## 10. Resolved questions (user, 2026-10-15)
1. **Light accent:** teal-700 `#0f766e` everywhere in light.
2. **Light status colours:** one step darker than dark (table in §2).
3. **Toggle placement:** app header **and** the user menu (plus the driver page header). None on auth screens; they follow the system setting.
4. **Regnos are data, not titles:** they use **Inter** (details hero, driver card, share header). Doto stays only on brand, page titles, big KPI numbers and status counter numbers.
5. **Doto weights:** trimmed to 800/900.

## 11. Out of scope
Per-user theme on the server, custom accents, high-contrast mode, a light variant of the share page's own design (it stays as D-090).
