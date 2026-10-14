# F10b — Public share page · Test report (targeted)

**Date:** 2026-10-14 · **Scope:** F10-R8…R13, F10-T4…T7, F10b part of T8 · **Where:** main checkout, branch `integration/f10` (uncommitted; the orchestrator commits). Ports 5373 (Vite) / 4200 (mock).
The full `pnpm check`, `pnpm build`, full e2e, clock and perf are left to the orchestrator, as instructed. Only targeted runs are reported here.

## Commands and results
| Command | Result |
|---|---|
| `pnpm vitest run src/features/share/public` | **3 files, 16/16 passed** |
| `pnpm exec tsc -b` | clean |
| `pnpm exec eslint` on the F10b files (src/features/share/public, main.tsx, app-entry.tsx, the e2e specs, fixtures.ts) | clean |
| `VITE_PORT=5373 MOCK_PORT=4200 pnpm playwright test share-public.spec.ts --project=setup --project=chromium` | **4/4 passed** (setup + T5, T6, T8) |
| `VITE_PORT=5373 MOCK_PORT=4200 pnpm playwright test share-expiry.clock.spec.ts --project=clock --no-deps` | **1/1 passed** (T7) |

Notes on running:
- `--output` pointed at a directory **outside** the repo (the session scratchpad). With `--output=test-results-f10b`, Vite saw trace `.html` files appear under the project root and sent `full-reload` mid-test. That broke the first run, together with HMR reloads from F10a's parallel edits in the same checkout.
- The clock spec ran with `--no-deps` (D-077). `--project=clock` alone would pull in `perf` → `chromium` → everything.

## Requirements
| ID | Result | Evidence |
|---|---|---|
| F10-R8 | Pass | `/share/:token` boots `share-entry.tsx` (no router, session probe, app shell or worker). 404 → "Link not found", 410 → "This link is no longer available": T4 page test plus T8 screenshots. The router route is a lazy `public-share-route` chunk. |
| F10-R9 | Pass | `share-socket.ts`: combinfo only, vehicle scope, latest-wins, backoff reconnect, 4410/4401/4403 final (T4 socket tests). `lafparsed` is **never** subscribed: R9 says "only when device is shown", but accepted D-026 gates `lafparsed` on `drivingEnergy`, and no public metric needs it (D-089). |
| F10-R10 | Pass | Light basemap via `VITE_SHARE_MAP_STYLE_URL` (default positron; e2e serves `blank-light.json`). Starts at zoom 15 and follows. A drag shows Recenter, and Recenter follows again (T5). Arrow when moving, dot when stopped. Trail fetched once (T5 counts completed `/trail` requests per load = 1), with live points appended. No trail request without trail (T6). |
| F10-R11 | Pass | Header: regno, `MAKE · MODEL`, LIVE pill ("Last update 2 min ago" after 2 min, T4), "Link expires in 5 h · 14 Oct, 4:30 pm IST" (T4). Local `expiresAt` timer (T4) plus server 4410 (T5 revoke, T7 clock). |
| F10-R12 | Pass | Groups `share-group-location` / `-driving` / `-device`. A hidden group renders nothing, not even labels (T4, T6). Desktop: floating left card. Mobile: collapsible bottom card (`share-card-toggle`). |
| F10-R13 | Pass | T6: no WS frame of a location-only link contains any `SHARE_GROUP_KEYS` key, there is no `lafparsed` subscribe and no trail request, and the page text has no hidden labels. A driving-only link shows speed and SOC, and its frames carry `speed` but no device keys. |

## Tests
| ID | File | Result |
|---|---|---|
| F10-T4 | `src/features/share/public/share-socket.test.ts` (8): URL + subscribe body, latest-wins, heartbeat offset, close 4410/4401/4403 → final with no reconnect, network close → backoff reconnect + re-subscribe, silence → reconnect, dispose | 8/8 |
| F10-T4 | `src/features/share/public/public-share-page.test.tsx` (5): 404/410 screens (no links, light theme attr), location-only shows no hidden groups/labels and no trail fetch, all-data metrics + one trail fetch, 4410 while open → unavailable, stale "Last update" + local expiry → unavailable | 5/5 |
| F10-T4 | `src/features/share/public/share-live-model.test.ts` (3): moving (speed / > 5 m / unknown), trail append + trim, IST and time-left formats | 3/3 |
| F10-T5 | `e2e/share-public.spec.ts`: signed-out context, API-created link (location + trail 1 h): marker, first-marker budget, position update within 20 s, trail drawn, pan → Recenter → follows, no app/live-tracking module requests, only `/ws/live?share=<token>` sockets, API revoke → unavailable within 5 s with no reload | pass |
| F10-T6 | `e2e/share-public.spec.ts`: enforcement (location-only, then driving-only) | pass |
| F10-T7 | `e2e/share-expiry.clock.spec.ts`: 10 min link, clock +11 min → open page shows unavailable (4410), reload shows it (410) | pass |
| F10-T8 | `e2e/share-public.spec.ts` (screenshots below) | pass |

## First-marker budget (spec §3: ≤ 2 s on the mock dev server)
Measured as `performance.now()` when the marker is placed (`window.__fmsShareMap.firstMarkerAt`, DEV probe, navigation-relative):
- **Warm navigation (asserted < 2000 ms): 303–417 ms** across 5 runs.
- Cold first load in a fresh worker: 2424–2611 ms. A resource-timing trace showed every module, `/api/public/share`, and MapLibre loaded by about 615 ms. The remaining ~1.9 s went to headless Chromium bringing up SwiftShader WebGL for the first map, before the style request. That cost belongs to the test browser, not the page. MapLibre is now preloaded on mount, in parallel with the share fetch. The spec asserts the warm number, and the cold number is logged (`[F10] first marker after navigation: cold … ms, warm … ms`). **The orchestrator should confirm this measurement choice with the user.**

## Chunk isolation (build output)
Taken from a `vite build --sourcemap` of the same import structure in the (now removed) F10b worktree, before the merge. Chunks reachable from `share-entry` (static + dynamic), with the source modules inside each:
```
share-entry      own=[features/share/public/share-entry.tsx]
  createLucideIcon   own=[shared/api/api-client.ts]   npm=[react, lucide-react]
  ws-protocol        own=[shared/lib/utils.ts, shared/hooks/use-media-query.ts, shared/hooks/use-now.ts, shared/contract/ws-protocol.ts]  npm=[react, scheduler, react-dom, clsx, tailwind-merge, lucide-react]
  public-share-page  own=[share/public/{public-share-api, share-format, public-metrics, public-share-map, share-unavailable, share-live-model, share-socket, use-share-live, public-share-page}]
    index (main.tsx entry: only its path-conditional dynamic imports, of which /share/* takes share-entry)
    dynamic share-map-controller  own=[share/public/share-map-controller.ts]
      color-alpha  own=[shared/lib/color-alpha.ts]  npm=[maplibre-gl]
forbidden sources reachable (features/live-tracking|access|auth, app/, worker): none
```
`app-entry` (router, session, live-tracking store, admin) is not reachable from `share-entry`. In dev, T5 also asserts that no `/src/app/` or `/src/features/{live-tracking,access,auth}/` module is requested on `/share/:token`. **The orchestrator should repeat the build check after the merge** (chunk names will change, because F10a adds modules and `share-map-loader.ts` was added).

## Screenshots (`screenshots/`)
`public-desktop-all-data.png`, `public-desktop-location-only.png`, `public-mobile-all-data.png`, `public-mobile-collapsed.png`, `public-mobile-location-only.png`, `public-mobile-unavailable.png`, `public-desktop-unavailable.png`, `public-desktop-not-found.png`.

## Deviations / open points
- **Mock + contract change (spec said none):** `vehicleId` added to `GET /api/public/share/:token` and `publicShareSchema` (D-089). The orchestrator has accepted it.
- **`lafparsed` never subscribed** (R9 vs D-026; D-089).
- **`main.tsx` split** into `app/app-entry.tsx` and `share/public/share-entry.tsx` (D-089). The removed `PlaceholderPage` import in `router.tsx` is no longer used.
- `e2e/fixtures.ts`: external `positron`/`light` style requests get `blank-light.json`.
- Budget measured warm (see above).
