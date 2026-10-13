# F07 — Vehicle Details Panel & Parameters · Spec

| Field | Value |
|---|---|
| Status | **Revision 2: awaiting sign-off.** Revision 1 was signed off 2026-10-13 and then superseded by the design correction. |
| Intent | `intent.md` (signed off 2026-10-13; D-017 raw numbers, no units in Parameters) |
| Branch | `feature/f07-vehicle-details` (resumes after DS1 is accepted; rebased onto `main`) |
| Visual source of truth | `docs/design/design-direction.html` (DS1). **Not** the current app's screenshots. Those are reference for *which data exists* only. |

## 1. Files (kebab-case)

```
src/features/live-tracking/
  config/details-config.ts             freshness thresholds, SOC colour bands, speed meter max, N/A sentinels   (done)
  lib/vehicle-details-model.ts         pure: payloads (+summary, status, now) → view model (all formatting rules)  (done; extend)
  lib/humanize-pid.ts                  'motor_temperature' → 'Motor Temperature'   (done)
  lib/format-relative.ts               '2 min ago' / '31 h ago'
  components/vehicle-details-panel.tsx     glass card (desktop) / bottom sheet (mobile) + tabs
  components/details-header.tsx
  components/overview-tab.tsx
  components/parameters-tab.tsx
  components/device-tab.tsx
  components/metric-tile.tsx
  components/battery-ring.tsx
  components/location-row.tsx
```
Revision 1's WIP components are deleted: `driving-energy-card`, `expanded-details`, `radial-gauge`, `parameters-grid`, `device-comms-card`, `details-ui`.
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
| F07-R4 | **Desktop (≥ 1024 px):**<br>• A floating `.glass` card on the right of the map: 392 px wide, `--radius-panel`.<br>• Top edge below the map's top slot row; 14 px inset from the right and bottom.<br>• Fixed header, three **tabs** (Overview · Parameters `n` · Device), and a scrollable body.<br>• There is **no** expanded/wide mode. The tabs replace it.<br>• The map stays fully usable around the card. |
| F07-R5 | **Mobile (< 1024 px):**<br>• The same card becomes a bottom sheet (vaul) with snap points at 35% and 92%.<br>• The header's absolute timestamp is hidden. |

### Content, using the view model in `vehicle-details-model.ts`

All numbers use **en-IN** grouping, and all timestamps use `formatIst`.

| ID | Section | Rules |
|---|---|---|
| F07-R6 | **Header** | • Regno in `--font-mono`, with icon buttons for copy, locate (`store.locateVehicle`) and close.<br>• Below it: a `StatusPill` (F05), then `make · model · variant` (from the summary), then a fuel tag (`appmeta.fueltype`, falling back to the summary `fuelType`).<br>• **Freshness row:** "GPS `<relative>`" (`gpstime`) and "CAN `<relative>`" (`canutctime`), each with a dot:<br>&nbsp;&nbsp;• ≤ 5 min: `--ok`<br>&nbsp;&nbsp;• ≤ 30 min: `--warn`<br>&nbsp;&nbsp;• otherwise: `--danger`<br>&nbsp;&nbsp;Based on server-corrected now.<br>• Each relative time has its absolute `formatIst` value as a tooltip.<br>• On desktop, the newer absolute time is also shown right-aligned. |
| F07-R7 | **Overview tab** | • **2×2 metric tiles:**<br>&nbsp;&nbsp;• **Speed**: integer km/h, with a thin teal meter against `config.speedMeterMax` (120).<br>&nbsp;&nbsp;• **Battery**: a ring plus SOC %, coloured by band (< 20 `--danger`, < 60 `--warn`, otherwise `--ok`).<br>&nbsp;&nbsp;• **Range (DTE)**: integer km.<br>&nbsp;&nbsp;• **Odometer**: whole km, rounded down (D-049).<br>• **Key/value tile:**<br>&nbsp;&nbsp;• State of health: 1 decimal %, `--ok` if ≥ 80.<br>&nbsp;&nbsp;• Motor temperature: raw.<br>&nbsp;&nbsp;• Motor speed: `engine_speed`, rpm.<br>&nbsp;&nbsp;• Ignition: On/Off, with the last on/off time.<br>• Location row (R11).<br>• A missing value shows "—". |
| F07-R8 | *(removed in revision 2)* | Dial gauges and the expanded view are dropped in favour of tiles and tabs. |
| F07-R9 | **Parameters tab** | • **Every lafparsed PID** (374), as a dense key/value list: humanised label in muted text, raw value in `--font-mono`, no units (D-017).<br>• `65535` (`config.naSentinels`) shows as "N/A" in `--text-faint`.<br>• Each row's `title` = the key + `formatIst(timestamp)`.<br>• A search box does case-insensitive substring matching on label **or** key.<br>• The tab label shows the filtered count.<br>• Sorted A–Z by label.<br>• The tab is hidden without `vehicle.parameters.view`. |
| F07-R10 | **Device tab** | • Device ID tile, with copy.<br>• 2×2 tiles:<br>&nbsp;&nbsp;• Aux battery: `carbattery`, 2 decimals, V. `--danger` when below the F05 pullout threshold.<br>&nbsp;&nbsp;• Internal battery: `devbattery`, 2 decimals, V.<br>&nbsp;&nbsp;• Signal: `rxdbm` dBm.<br>&nbsp;&nbsp;• GPS fix: `fixquality` 0 → "None" (`--warn`), otherwise "Fix (q)". |
| F07-R11 | **Location** | Lat/lng to 5 decimals in `--font-mono`, with copy. |
| F07-R12 | **Not shown** | Reports and Analytics buttons (C16). The **Share live location** CTA (the teal outline button in the mockup) is not rendered until F10 adds it. |
| F07-R13 | **Permissions** | Visibility is read from `me.permissions`, which the store now holds from bootstrap:<br>• `vehicle.details.view` is needed to open the panel at all. Without it, a click only shows a tooltip.<br>• `vehicle.parameters.view` controls the Parameters tab. |
| F07-R14 | **Live updates** | • Values update in place at the push cadence, without layout shift and without re-mounting.<br>• The parameters list re-renders only the rows whose value changed (memoised per key). |
| F07-R15 | **Accessibility** | • The panel is a labelled region.<br>• Esc closes it on desktop.<br>• Copy buttons have aria-labels and show a sonner toast "Copied".<br>• Focus moves to the panel when it opens. |
| F07-R16 | **Deselect on map click** *(amendment, 2026-10-13, from the F06 hand-over)* | Clicking an empty area of the map, meaning no point and no cluster, closes the panel and clears `?vehicle`. Dragging the map does not count as a click. |

### `humanize-pid`
Strip leading underscores. Split on `_`. Title-case each word. Keep numeric parts unchanged (`cell_voltage_01` → "Cell Voltage 01").
A small override map handles known acronyms: SOC, SOH, DTE, BMS, MCU, VCU, MVCU, ODO, ECU, ID, BLE, CAN, GSM, IMU, AFE, OCV, LED, DC, AC, UDS, EOL, TFT, ADC, PWM, FOC, TCU, VIN.

## 3. Acceptance tests

| ID | Type | Test |
|---|---|---|
| F07-T1 | unit | `humanize-pid` covers underscores, numbers and acronyms, plus `_12v_count` → "12V Count" and `5v_fault` → "5V Fault". |
| F07-T2 | unit | `vehicle-details-model` from the **`caninfo.md` / `lafparsed.md` samples**, with status `pullout` and a fixed `now`, produces **exactly** these values (the data matches the sample; the presentation is new):<br>• Regno `P6DED30BPDC002607`.<br>• GPS `08 Sep 26 \| 09:33:42`; CAN `08 Sep 26 \| 09:33:49` (absolute).<br>• With `now` = GPS time + 31 h: relative times `31 h ago`, danger dots.<br>• Battery `49%` with the warn band.<br>• DTE `56` km; SOH `100.0` %; ODO `1,077` km.<br>• Aux `0.07` V; Internal `3.60` V.<br>• Location `28.70419, 80.56578`.<br>• 374 parameters, and `time_to_charge` shows "N/A". |
| F07-T3 | unit | Freshness and SOC colour bands at each boundary. `format-relative` covers just now / min / h / d. Missing values show "—". Parameter search matches both label and key. |
| F07-T4 | component | The panel renders from fixture payloads. Tabs switch content. Parameter search narrows the count. Copy writes to the clipboard and shows a toast. The not-found state appears. The Parameters tab is hidden without the permission. |
| F07-T5 | component | Re-rendering with one PID changed re-renders only that cell (render counting). |
| F07-T6 | e2e | Clicking a point on the map opens the panel with that regno, and the URL has `?vehicle=`. Reloading restores the panel. Esc and the close button remove the param. Back reopens it. Clicking an empty map area closes the panel (R16). |
| F07-T7 | e2e | Within 20 s, the GPS time in the open panel changes, showing live updates. Locate flies the map to the vehicle (zoom 16). |
| F07-T8 | e2e | At 390 px wide, the bottom sheet opens at 35% and drags to 92%, and the map is still visible above it. |
| F07-T9 | e2e | The Parameters tab lists 374 rows. Searching "cell_voltage" shows 23 (20 cell voltages + maximum, minimum and mismatch-warning keys). |
| F07-T10 | cmd | `pnpm check`, `pnpm build` and `pnpm e2e` all pass. F04/F05/F06 budgets still hold: re-run the perf project and record the numbers. |
| F07-T11 | e2e | Screenshots of the Overview, Parameters and Device tabs (desktop) and the mobile sheet are saved to `docs/features/f07-vehicle-details/screenshots/` for UAT against the mockup. |

## 4. Out of scope
- Share flow (F10).
- Reports and Analytics.
- Trend charts.
- Writing values back to the vehicle (e.g. immobilise).
