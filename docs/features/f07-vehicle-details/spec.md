# F07 — Vehicle Details Panel & Parameters · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` (signed off 2026-10-13; D-017 raw numbers, no units in Parameters) |
| Branch | `feature/f07-vehicle-details` (after F06 is accepted) |
| Visual reference | `reference/current-app-view.png` (compact), `reference/current-app-view-2.png` (expanded) |

## 1. Files (kebab-case)

```
src/features/live-tracking/
  config/details-config.ts             freshness thresholds, SOC colour bands, gauge ranges, N/A sentinels
  lib/vehicle-details-model.ts         pure: payloads (+summary, status, now) → view model (all formatting rules)
  lib/humanize-pid.ts                  'motor_temperature' → 'Motor Temperature'
  components/vehicle-details-panel.tsx     container: desktop side panel / mobile bottom sheet
  components/details-header.tsx
  components/driving-energy-card.tsx
  components/expanded-details.tsx      speed + RPM gauges, wide parameters grid
  components/radial-gauge.tsx          SVG gauge
  components/parameters-grid.tsx
  components/device-comms-card.tsx
  components/location-row.tsx
```
New dependencies: `sonner` (copy toasts, shadcn) and `vaul` (mobile bottom sheet, shadcn Drawer).

## 2. Requirements

### Selection & routing
| ID | Requirement |
|---|---|
| F07-R1 | **Selection lives in the URL** as `?vehicle=<vehicleId>` on `/live-tracking`, kept in sync both ways with `store.selectedVehicleId`. Reload, back/forward and deep links all work. Closing the panel removes the param and deselects. |
| F07-R2 | **The header shows immediately** from `getVehicleSummary` (slim, already in the worker). The full `combinfo`/`lafparsed` payloads fill in when they arrive; until then their sections show skeletons. |
| F07-R3 | If the vehicle is `found: false` (D-033), the panel shows "Vehicle not available in your fleets" with a Close button. |

### Layout
| ID | Requirement |
|---|---|
| F07-R4 | **Desktop (≥ 1024 px):**<br>• A floating card on the right of the map: 420 px wide, `--radius-panel`, `--surface-1`, scrollable. The map stays usable.<br>• **Expand** (a chevron next to "Parameters") switches to the wide two-column view: card + gauges on the left, parameters grid on the right (≈ 60% of the width).<br>• **Collapse** returns to the compact card. |
| F07-R5 | **Mobile (< 1024 px):** a bottom sheet (vaul) with snap points at 35% and 92%. The expanded view stacks vertically. |

### Content, using the view model in `vehicle-details-model.ts`

All numbers use **en-IN** grouping, and all timestamps use `formatIst`.

| ID | Section | Rules |
|---|---|---|
| F07-R6 | **Header** | • Regno, in the display font, with copy and locate buttons. Locate calls `store.locateVehicle`.<br>• `make · model · variant` from the summary, and a fuel badge from `appmeta.fueltype`, falling back to the summary `fuelType`.<br>• A `StatusPill` (F05).<br>• **GPS** time (`gpstime`) and **CAN** time (`canutctime`), each with a freshness dot:<br>&nbsp;&nbsp;• ≤ 5 min: `--ok`<br>&nbsp;&nbsp;• ≤ 30 min: `--warn`<br>&nbsp;&nbsp;• otherwise: `--st-stopped`<br>&nbsp;&nbsp;Freshness is based on server-corrected now. |
| F07-R7 | **Driving · Energy** | • Speed: integer, km/h.<br>• Battery: SOC % with a bar, from `parsedcandata.soc`. Colour bands: < 20 `--st-stopped`, < 60 `--warn`, otherwise `--ok`.<br>• DTE: integer km, from `parsedcandata.dte`.<br>• SOH: 1 decimal %, from lafparsed `soh`.<br>• ODO: integer km, from `parsedcandata.odometer`.<br>• A missing value shows "—". |
| F07-R8 | **Expanded view** | • Two SVG `radial-gauge`s. Speed runs 0–220 km/h (the reference ticks), and shows SOC % underneath. RPM runs 0–12 000, from `engine_speed`.<br>• An ODO odometer strip with 7 digit boxes, plus DTE and SOH.<br>• Gauge ranges are in config. |
| F07-R9 | **Parameters** | • **Every lafparsed PID** (374), in this format: humanised label, raw value, no units (D-017).<br>• `65535` (`config.naSentinels`) shows as "N/A".<br>• Hovering a cell shows `title` = the key + the value's `formatIst(timestamp)`.<br>• A search box does case-insensitive substring matching on label **or** key.<br>• The header shows "Parameters (n)", where n is the filtered count.<br>• Sorted A–Z by label.<br>• Compact view: a collapsible list. Expanded view: a grid of cards, as in the reference.<br>• Hidden without `vehicle.parameters.view`. |
| F07-R10 | **Device & Comms** | • Device ID, with copy.<br>• Aux voltage: `carbattery`, 2 decimals, V.<br>• Internal battery: `devbattery`, 2 decimals, V, with a small battery glyph.<br>• Signal: `rxdbm` dBm. |
| F07-R11 | **Location** | Lat/lng to 5 decimals, with copy. |
| F07-R12 | **Not shown** | Reports and Analytics buttons (C16). The **Share live location** button is not rendered until F10 adds it. |
| F07-R13 | **Permissions** | Visibility is read from `me.permissions`, which the store now holds from bootstrap:<br>• `vehicle.details.view` is needed to open the panel at all. Without it, a click only shows a tooltip.<br>• `vehicle.parameters.view` controls the Parameters section. |
| F07-R14 | **Live updates** | • Values update in place at the push cadence, without layout shift and without re-mounting.<br>• The parameters grid re-renders only the cells whose value changed (memoised per key). |
| F07-R15 | **Accessibility** | • The panel is a labelled region.<br>• Esc closes it on desktop.<br>• Copy buttons have aria-labels and show a sonner toast "Copied".<br>• Focus moves to the panel when it opens. |

### `humanize-pid`
Strip leading underscores. Split on `_`. Title-case each word. Keep numeric parts unchanged (`cell_voltage_01` → "Cell Voltage 01").
A small override map handles known acronyms: SOC, SOH, DTE, BMS, MCU, VCU, MVCU, ODO, ECU, ID, BLE, CAN, GSM, IMU, AFE, OCV, LED, DC, AC, UDS, EOL, TFT, ADC, PWM, FOC, TCU, VIN.

## 3. Acceptance tests

| ID | Type | Test |
|---|---|---|
| F07-T1 | unit | `humanize-pid` covers underscores, numbers and acronyms, plus `_12v_count` → "12V Count" and `5v_fault` → "5V Fault". |
| F07-T2 | unit | `vehicle-details-model` from the **`caninfo.md` / `lafparsed.md` samples**, with status `pullout` and a fixed `now`, produces **exactly** the reference screenshot's values:<br>• Regno `P6DED30BPDC002607`.<br>• GPS `08 Sep 26 \| 09:33:42`; CAN `08 Sep 26 \| 09:33:49`.<br>• Battery `49%` with the warn band.<br>• DTE `56` km; SOH `100.0` %; ODO `1,077` km.<br>• Aux `0.07` V; Internal `3.60` V.<br>• Location `28.70419, 80.56578`.<br>• 374 parameters, and `time_to_charge` shows "N/A". |
| F07-T3 | unit | Freshness and SOC colour bands at each boundary. Missing values show "—". Parameter search matches both label and key. |
| F07-T4 | component | The panel renders from fixture payloads. Expand/collapse switches views. Parameter search narrows the count. Copy writes to the clipboard and shows a toast. The not-found state appears. Parameters are hidden without the permission. |
| F07-T5 | component | Re-rendering with one PID changed re-renders only that cell (render counting). |
| F07-T6 | e2e | Clicking a point on the map opens the panel with that regno, and the URL has `?vehicle=`. Reloading restores the panel. Esc and the close button remove the param. Back reopens it. |
| F07-T7 | e2e | Within 20 s, the GPS time in the open panel changes, showing live updates. Locate flies the map to the vehicle (zoom 16). |
| F07-T8 | e2e | At 390 px wide, the bottom sheet opens at 35% and drags to 92%, and the map is still visible above it. |
| F07-T9 | e2e | Expanded view shows both gauges and the parameters grid with 374 items. Searching "cell_voltage" shows 23 (20 cell voltages + maximum, minimum and mismatch-warning keys). |
| F07-T10 | cmd | `pnpm check`, `pnpm build` and `pnpm e2e` all pass. F04/F05/F06 budgets still hold: re-run the perf project and record the numbers. |

## 4. Out of scope
- Share flow (F10).
- Reports and Analytics.
- Trend charts.
- Writing values back to the vehicle (e.g. immobilise).
