# F06 — Live Map · Test Report

| Field | Value |
|---|---|
| Date | 2026-10-13 |
| Branch | `feature/f06-live-map` |
| Env | macOS, Node 24, pnpm 10.33, Vitest 5.0.4, Playwright 1.64 (Chromium headless, WebGL on SwiftShader — D-041), MapLibre GL 6.14, supercluster 9.1. e2e ran against the user's running `pnpm dev` (5173/4000, reused — see below) |
| Result | **All passed** (no BLOCKED items) |

## Acceptance tests

| ID | Type | Result | Command | Evidence |
|---|---|---|---|---|
| F06-T1 | unit | PASS | `pnpm test` | `worker/map-index.test.ts › F06-T1` (5000 synthetic vehicles, every 50th at (0, 0)): zoom 4 over India → Σ cluster counts + points = 4900 (all with a fix); every cluster's 8-value breakdown sums to its count at zooms 3/6/9 and the gps-never slot is 0; zoom 15.4 bbox scan returns exactly the brute-force in-box set, all inside; `maxFramePoints: 50` at zoom 16 → ≤ 50 points + clusters. |
| F06-T2 | unit | PASS | `pnpm test` | `update()` builds at t=0, refuses at 1000/1999 ms, rebuilds at 2000 ms, then not again without a change (`builds = 2`, `rebuildWait` 1000 → null). A delta moving `v1` into an empty box shows up in the next zoom-15 frame with `builds` still 1. Engine (fake timers, 6 s of deltas every 100 ms): 2–3 rebuilds after the first, 20–25 pushed frames (≤ 4 Hz), no frames after `setViewport(null)`. |
| F06-T3 | unit | PASS | `pnpm test` | `getBounds` stays inside the city centres (gps-never at (0, 0) excluded), null for an empty state and for a state with only gps-never. Every cluster at zoom 5 has `expansionZoom > 5`; an unknown id → null. |
| F06-T4 | unit | PASS | `pnpm test` | `store/live-tracking-store.test.ts › F06-T4` (7 tests): `setViewport` stores the returned frame, newer push frames win, older ones are dropped, `setViewport(null)` clears it; `locateVehicle` → select + `fly {center, zoom 16, 1000 ms}`, (0, 0) → no command + notice "No location available"; `fitToVehicles` → `fit {padding 48, maxZoom 14}`, single point → `fly zoom 14`, none → nothing; auto-fit once (waits for the map's viewport, not repeated after reconnect + new snapshot); also fires when the snapshot completes after the map is up; cluster ease (stale id → zoom + 2); city jump fit; `selectedPosition` prefers the payload, then the frame. |
| F06-T5 | perf | PASS | `pnpm test` | `worker/map-index.perf.test.ts` (Node, 1 lakh vehicles around the 40 cities): **rebuild 67–91 ms** (budget 500). Frames: India z4 0.3 ms (13 clusters), Pune z10 0.1 ms, Pune z13 0.3 ms (193 clusters + 59 points), Pune z15 0.8 ms (1616 points), Pune z16 0.4 ms, west-India z15 capped **4.6 ms** (2445 clusters + 1594 points) — budget 100 ms. |
| F06-T6 | e2e | PASS | `pnpm e2e` | `e2e/live-map.spec.ts`: first camera within 150 km of India's centre at zoom < 6, then `autoFitDone`, clusters drawn, OSM attribution present; after a drag (> 50 km) and 5 s wait the camera is unchanged (no re-fit). |
| F06-T7 | e2e | PASS | `pnpm e2e` | City dropdown "pun" → Pune: centre inside the Pune box, label still "Jump to city…"; "Zoom to fit" returns to the auto-fit camera (Δzoom < 0.25, < 50 km). |
| F06-T8 | e2e | PASS | `pnpm e2e` | Clicking the first cluster raises the zoom. Debug "Locate vehicle ID" on a stationary vehicle (status read from the debug picker, so its ~10 s reports can't move it mid-check) reaches **zoom 16.0** with the centre **≤ 100 m** from its live position; selection + highlight set. After "Clear", clicking the vehicle's point re-selects it and the ring is drawn on it. Extra: unknown id → toast "No location available". |
| F06-T9 | e2e perf | PASS | `pnpm e2e` (project `perf`) | `e2e/live-map.perf.spec.ts`: 1 lakh vehicles, start over Mumbai (z 10.1), 10 s of drags + wheel zooms up to z 14.8. **0 long tasks** in 3 of 3 runs. rAF (informational, SwiftShader): 594–667 frames, mean 16.7 ms (60 fps), p95 16.7–16.8 ms, max 16.8–100 ms; 27–34 frames received per run. |
| F06-T10 | e2e | PASS | `pnpm e2e` | 390 × 844: map ≥ 380 px wide; attribution visible, in viewport and containing "OpenStreetMap"; zoom +/− in viewport; "Zoom to fit" and "Jump to city…" in viewport and working (Pune jump, then refit). |
| F06-T11 | cmd | PASS | see below | `pnpm check`, `pnpm build`, `pnpm e2e` exit 0 (e2e run twice in a row, 14/14 both times). F04/F05 e2e now open `/live-tracking?debug=1`; their assertions and budgets are unchanged. |

## Performance vs budgets

| Budget (spec §3) | Target | Measured |
|---|---|---|
| Cluster rebuild at 1 lakh (worker) | ≤ 500 ms | 67–91 ms (Node, T5); 70 ms in the browser worker (`stats.clusterBuildMs` in the debug overlay) |
| Frame for any viewport at 1 lakh | ≤ 100 ms | ≤ 4.6 ms (T5, worst = capped z15 over 4 cities) |
| Main-thread long tasks during scripted pan/zoom | none > 50 ms | 0 (T9, 3 runs) |
| ≥ 50 fps pan/zoom on real hardware | manual (UAT) | headless rAF shows 60 fps, but SwiftShader numbers are informational only |

## F04 / F05 re-run (with the map on the page)

| Metric | Budget | F05 report | F06 (3 perf runs) |
|---|---|---|---|
| F04-T9 first data | ≤ 2000 ms | 569 ms | 934–991 ms |
| F04-T9 snapshot complete | ≤ 5000 ms | 821 ms | 1187–1246 ms |
| F04-T10 long tasks while streaming (15 s) | 0 | 0 | 0 |
| F04-T10 pushes/s | ≤ 4 | 3.33 | 3.00–3.33 |
| F04-T10 longest task during page load (not budgeted) | — | 0 | 53–94 ms |
| Worker state | — | 35.5 MB | 35.5 MB |
| F05-T8 counts sum / sweep | 1 lakh | pass | pass, sweep 0.1–3.7 ms |

First data is ~400 ms later than before: the page now parses the MapLibre chunk and creates a WebGL (SwiftShader) context during load, on the same thread that receives the first push. It stays well inside the 2 s budget. The first perf run with two perf specs in parallel gave 2183 ms, which is why `perf`/`clock` now use one worker (D-042).

## Commands

| Command | Exit | Output |
|---|---|---|
| `pnpm check` | 0 | `tsc -b` clean · `eslint .` 0 problems · `Test Files 23 passed (23) · Tests 194 passed (194)` (~6 s) |
| `pnpm build` | 0 | `index-*.js 433.33 kB │ gzip 140.58 kB`, `map-controller-*.js 1,063 kB │ gzip 288.9 kB` (lazy), `maplibre-gl-worker-*.mjs 508 kB`, `live-tracking-worker-*.js 60.5 kB` (was 46.3; + supercluster). `grep __fmsMap\|__fmsLive\|exposeMapProbe dist/assets/*.js` → no match |
| `pnpm e2e` | 0 | `14 passed (~1.0m)`: 10 × chromium (3 app-shell, 5 live-map incl. the R19 toast, 2 mock-proxy), 3 × perf (F06-T9, F04-T9, F04-T10), 1 × clock (F05-T8); run twice |

Ports 5173/4000 were held by the user's `pnpm dev`, so Playwright reused it (with its default OpenFreeMap style URL). The `e2e/fixtures.ts` route stub served the blank style for that request and aborted all other external requests, so no tile server was contacted. Nothing was started or killed by these runs. F05-T8 resets the mock clock to 0 in `afterEach`.

## Deviations from the spec / clarifications

1. **`cluster-marker.ts`, not `.tsx`** (D-046): the donut is an SVG string on a reused DOM button; no React root per marker.
2. **Extra files**: `components/live-tracking-page.tsx` (page composition + toast), `components/map-dev-probe.ts` (dev-only `__fmsMap`, D-047), `worker/position.ts` (shared validity rule, keeps supercluster out of the main bundle), `e2e/fixtures.ts`, `config/india-cities.node.test.ts`.
3. **`__fmsMap`** has the R21 fields plus `moving`, `vehicleCount`, `selectedVehicleId`, `highlight()`, `points()` for the e2e tests.
4. **Below zoom 15** single points come from the index but carry live position/status (D-043); clusters keep rebuild-time positions and breakdowns until the next rebuild.
5. **Cluster click** eases to `max(expansionZoom, zoom + 1)`; a stale cluster id (index rebuilt after the frame) falls back to zoom + 2 (D-043).
6. **gps-never exclusion** uses the position rule (non-finite or (0, 0)), the same rule the status deriver uses for gps-never; a server-sent `displayStatus: 'gps-never'` with a real position would still be drawn.
7. **Zoom-to-fit disabled** while `total === 0` (no vehicles in the fleet state); with vehicles but none positioned it is enabled and does nothing.
8. **Auto-fit timing** (D-044): waits until both the snapshot is complete and the map has a viewport.
9. **Map rotation/pitch disabled** (D-046) so heading arrows stay correct north-up.
10. **Antimeridian**: the live bbox scan assumes `west ≤ east` (India only).
11. **T8 vehicle choice**: the locate check uses a stationary vehicle; with a moving one, a 10 s report landing during the check moved it 160 m once.
12. **T9 load**: viewport-limited frames over the mock's city loops stay light (≤ ~40 clusters on screen during the script); T5 covers heavier frames (2445 clusters) in the worker.

## Manual UAT checklist

Run `pnpm dev` (real OpenFreeMap dark style), open `http://localhost:5173/live-tracking` on a mid-range laptop with hardware acceleration on.

1. The map opens over India, then once the fleet has loaded it zooms to fit all vehicles **once**. Panning away does not snap back.
2. Clusters show a coloured ring (status mix) and a count (`999`, `4.9k`, `14k`); clicking one zooms in around it.
3. Zoomed in (≥ 15), vehicles are green arrows pointing in their heading when running and coloured dots otherwise; they move between reports without waiting for a re-cluster.
4. Hovering a vehicle shows its reg. no and status; clicking it draws a white ring that follows it.
5. **Frame rate**: open DevTools → Rendering → Frame rendering stats (or Performance panel), then pan and zoom continuously for ~10 s around Mumbai/Pune at zoom 10–15 and over all of India. It should stay at **≥ 50 fps** with 1 lakh vehicles.
6. "Zoom to fit" (top right) refits; "Jump to city…" → type a city → it pans there; the button label stays "Jump to city…" and nothing is filtered.
7. `?debug=1`: the diagnostics overlay appears (collapsible); "Locate vehicle ID" flies to the vehicle at zoom 16 in ~1 s and stops (no follow); an unknown id shows "No location available".
8. Phone width (~390 px, or DevTools device mode): map, the two toolbar buttons, +/− and the "© OpenStreetMap contributors" attribution are all visible.
9. With WebGL disabled (e.g. `chrome://settings` → turn off hardware acceleration and `--disable-webgl`), the page shows "The map can't be shown" and the rest of the app still works.
