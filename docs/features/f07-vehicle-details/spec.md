# F07 — Vehicle Details Panel & Parameters · Spec

| Field | Value |
|---|---|
| Status | **Revision 3: awaiting sign-off.** Rev 1 was signed off 2026-10-13 and superseded by the design correction. Rev 2 was never signed off; it was replaced after "still appears simple". |
| Intent | `intent.md` (signed off 2026-10-13, layout wording amended; D-017 raw numbers, no units in Parameters) |
| Branch | `feature/f07-vehicle-details` (rebased onto the DS1 tokens commit; runs in parallel with DS1, see §5) |
| Visual source of truth | `docs/design/design-direction.html` **v2**. The current app's screenshots only show *which data exists*. |
| Already done (paused branch) | `details-config.ts`, `vehicle-details-model.ts`, `humanize-pid.ts`, `?vehicle=` URL sync, store permissions/`clickMap`/deselect (R16), with unit tests. D-048…D-050. |

## 1. Files (kebab-case)

```
src/features/live-tracking/
  config/details-config.ts          (done) + speedometer max, range ring max, parameter groups, highlight PIDs
  lib/vehicle-details-model.ts      (done) + rings, speedo, cells strip, events view model
  lib/humanize-pid.ts               (done)
  lib/format-relative.ts            '2 min ago' / '31 h ago'
  worker/selected-history.ts        per-selection ring buffer {t, soc, speed, lat, lng} + status/ignition event log
  components/vehicle-details-panel.tsx   glass card (desktop) / bottom sheet (mobile), tabs
  components/details-hero.tsx       header, vehicle illustration, signal + GPS badges, freshness row
  components/vehicle-illustration.tsx    SVG per assetType: e-scooter, e-3W, e-car, truck (fallback: e-scooter)
  components/ring-gauge.tsx         battery / range / health rings
  components/speedometer.tsx        SVG arc 0–speedoMax with ticks; red zone above 75%
  components/session-chart.tsx      SVG area chart (SOC over session)
  components/overview-tab.tsx  parameters-tab.tsx  device-tab.tsx  events-tab.tsx
  components/cell-strip.tsx         20-cell voltage bars
  components/selected-callout.tsx   map callout next to the selected vehicle
  components/heading-compass.tsx    compass showing the selected vehicle's heading
mock-server/routes/…              GET /api/vehicles/:id/trail?minutes=60 (reuses the share-trail generator)
```
- Rev-1 WIP components are deleted: `driving-energy-card`, `expanded-details`, `radial-gauge`, `parameters-grid`, `device-comms-card`, `details-ui`.
- Charts and gauges are hand-written SVG. No chart library is added.

## 2. Requirements

### Selection & routing (unchanged)
| ID | Requirement |
|---|---|
| F07-R1 | **Selection lives in the URL** as `?vehicle=<vehicleId>`, kept in sync both ways with the store. Reload, back/forward and deep links work. Closing the panel deselects. *(done)* |
| F07-R2 | **The header shows immediately** from `getVehicleSummary`. Full payloads fill in when they arrive; until then, skeletons. |
| F07-R3 | `found: false` → "Vehicle not available in your fleets", with a Close button. |

### Layout
| ID | Requirement |
|---|---|
| F07-R4 | **Desktop (≥ 1024 px):**<br>• A floating `.glass` card on the right: 420 px wide, top under the top bar, 14 px inset, deep shadow.<br>• Fixed **hero** at the top, then the **rings row**, then **tabs** (Overview · Parameters `n` · Device · Events), then a scrollable body. |
| F07-R5 | **Mobile (< 1024 px):** a glass bottom sheet (vaul) with snap points at 35% and 92%. At 35% it shows the hero and the rings. The absolute time is hidden. |

### Content (view model in `vehicle-details-model.ts`; all text in Doto)
| ID | Section | Rules |
|---|---|---|
| F07-R6 | **Hero** | • Regno, with copy, locate and close buttons.<br>• Status pill, `MAKE · MODEL · VARIANT` (uppercase), fuel tag.<br>• **Vehicle illustration** chosen by `assetType`, on a teal floor glow.<br>• **Badges:**<br>&nbsp;&nbsp;• Signal: `rxdbm`, shown as 4 bars. ≥ −70 = 3 bars, ≥ −85 = 2, ≥ −100 = 1, else 0.<br>&nbsp;&nbsp;• GPS fix: `fixquality` 0 = "NONE" in `--warn`, otherwise "FIX q".<br>• **Freshness row:** GPS and CAN as relative times, with dots (≤ 5 min `--ok`, ≤ 30 min `--warn`, else `--danger`). The absolute `formatIst` time shows on hover. The newer absolute time is right-aligned on desktop. |
| F07-R7 | **Rings row** | • **Battery:** SOC %, band-coloured (< 20 danger, < 60 warn, else ok).<br>• **Range:** DTE km, against `rangeRingMax` (150).<br>• **Health:** SOH %, ok if ≥ 80.<br>A missing value shows "—" with an empty ring. |
| F07-R8 | **Overview tab** | • **Speedometer:** 0–`speedoMax` (120) km/h, ticks every 5, labels every 20, red zone above 90. Next to it, key/value rows: Odometer (rounded down), Motor speed (`engine_speed` rpm), Motor temp (raw), Ignition (On/Off + time from `lastignon`/`lastignoff`).<br>• **Energy · this session:** a SOC area chart from `selected-history` (since selection, sampled per payload, ≤ 2 h buffer), with time ticks and the latest point marked. With fewer than 2 samples it says "Collecting…".<br>• **Share live location:** gradient CTA. Hidden until F10. |
| F07-R9 | **Parameters tab** | • Search box: case-insensitive, matches label **or** key.<br>• **Group chips** by key pattern (from config): ALL · BMS (`bms_`) · MCU (`mcu_`) · CELLS (`cell_`) · CHARGER (`charger_`) · FAULTS (`fault` anywhere in the key).<br>• **Highlight tiles:** a configurable list, default battery_voltage, bms_chargingcycles, afe_temperature, ah_throughput.<br>• **Then the dense list of all 374:** humanised label, raw value, no units (D-017). `65535` → "N/A" (faint). Each row's `title` = key + `formatIst(timestamp)`. Sorted A–Z.<br>• The tab label shows the filtered count.<br>• The tab is hidden without `vehicle.parameters.view`. |
| F07-R10 | **Device tab** | • Device ID tile, with copy.<br>• Tiles:<br>&nbsp;&nbsp;• Aux battery: 2 decimals V, `--danger` below the F05 pullout threshold.<br>&nbsp;&nbsp;• Internal battery: 2 decimals V.<br>&nbsp;&nbsp;• Signal: dBm.<br>&nbsp;&nbsp;• GPS fix.<br>• **Cell strip:** bars for `cell_voltage_01…20` (missing cells skipped). The lowest cell is in `--warn`, with its value on hover. |
| F07-R11 | **Events tab** | • A timeline, newest first, from `selected-history`:<br>&nbsp;&nbsp;• Status transitions observed since selection (F05 status changes).<br>&nbsp;&nbsp;• Ignition on/off from `lastignon`/`lastignoff`.<br>• Each event shows a time, a status-coloured icon, a title and a detail line (location or SOC).<br>• **Only observed or reported events.** Nothing is invented. Empty state: "No events since you opened this vehicle". |
| F07-R12 | **Map extras for the selected vehicle** | • **Trail:** on select, fetch `GET /api/vehicles/:id/trail?minutes=60` (new mock endpoint, scope- and permission-checked like the vehicle WS scope). Live positions are appended. The data feeds DS1's trail layer, and is cleared on deselect.<br>• **Callout:** a glass card next to the selected marker with regno, status and `speed · SOC`. It follows the vehicle.<br>• **Compass:** a glass compass near the card showing heading and an 8-point label (N, NE…NW). |
| F07-R13 | **Permissions** | `vehicle.details.view` is needed to open the panel. `vehicle.parameters.view` controls the Parameters tab. *(store part done)* |
| F07-R14 | **Live updates** | Values update in place at push cadence. Rings, speedometer and chart animate (≤ 300 ms, `prefers-reduced-motion` respected). Parameter rows are memoised per key. No main-thread long task > 50 ms. |
| F07-R15 | **Accessibility** | The panel is a labelled region. Esc closes it. Copy buttons have aria-labels and show a toast. Focus moves to the panel. The charts have text alternatives. |
| F07-R16 | **Deselect on map click** | Clicking empty map (not a drag) closes the panel. *(done)* |
| F07-R17 | **Not shown** | Reports and Analytics buttons (C16). |

`humanize-pid` (done): strip leading underscores, split on `_`, title-case, keep numbers, and apply the acronym map.

## 3. Acceptance tests
| ID | Type | Test |
|---|---|---|
| F07-T1 | unit | `humanize-pid` *(done)*. |
| F07-T2 | unit | From the sample payloads (status pullout, fixed now = GPS + 31 h):<br>• Regno, plus both absolute times `08 Sep 26 \| 09:33:42` / `09:33:49` and the relative `31 h ago`, with danger dots.<br>• Rings: 49 (warn), 56, 100.0 (ok).<br>• ODO 1,077; Aux 0.07 (danger); Internal 3.60.<br>• Signal −70 → 3 bars; GPS fix NONE.<br>• Location 28.70419, 80.56578.<br>• 374 params, `time_to_charge` N/A.<br>• 20-cell strip with the lowest cell flagged. |
| F07-T3 | unit | Freshness, SOC bands, signal bars and `format-relative` at their boundaries. Group-chip filters (BMS / MCU / CELLS / CHARGER / FAULTS counts match the key patterns). Search on label or key. |
| F07-T4 | unit | `selected-history`:<br>• The buffer is capped at 2 h.<br>• Status transitions are recorded once each.<br>• Ignition events are de-duplicated.<br>• It resets on a new selection. |
| F07-T5 | component | The panel renders from fixtures. All 4 tabs work. The parameters search, chips and count work. Copy works and shows a toast. The not-found state appears. The Parameters tab is hidden without the permission. "Collecting…" shows with fewer than 2 samples. |
| F07-T6 | component | Changing one PID re-renders only that parameter row (render counting). |
| F07-T7 | integration | The mock trail endpoint returns about 60 min of points for an in-scope vehicle, `403` out of scope, and `401` without a session. |
| F07-T8 | e2e | Click a point: the panel opens, `?vehicle=` is set, and the trail and callout appear. Reload restores everything. Esc, the close button and an empty-map click deselect, which removes the trail and callout. Back reopens the panel. |
| F07-T9 | e2e | Within 20 s the GPS relative time or the session chart updates. Locate flies to zoom 16. |
| F07-T10 | e2e | 390 px: the sheet opens at 35% (hero + rings visible) and drags to 92%. Parameters tab: 374 rows; "cell_voltage" → 23; the CELLS chip → `cell_` keys. |
| F07-T11 | e2e | Screenshots for UAT against the v2 mockup, saved to `docs/features/f07-vehicle-details/screenshots/`: Overview, Parameters, Device and Events tabs (desktop), the map with trail, callout and compass, and the mobile sheet. |
| F07-T12 | cmd | `pnpm check`, `pnpm build` and `pnpm e2e` all pass. F04–F06 budgets still hold, measured in one perf run at the end. |

## 4. Out of scope
- Share flow (F10).
- Reports and Analytics.
- History beyond the 60-min trail and the session buffer.
- Commands to the vehicle.

## 5. Delivery (speed, D-055)
- F07 rev 3 runs **in parallel** with DS1, each in its own worktree.
- DS1 owns the tokens, map styling and trail layer. F07 owns the card, the trail data, the callout and the compass.
- Both start from a shared tokens commit, so neither waits on the other.
