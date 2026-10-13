# F05 — Vehicle Status Derivation · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
Status drives marker colour, counters, filters and the detail pill. The client derives it (A5) and uses the server's `displayStatus` when one is present.

## What
The worker evaluates each vehicle against the rules below, **first match wins**. Thresholds are configurable constants.

| Priority | Status | Proposed rule |
|---|---|---|
| 1 | **gps-never** | The vehicle has never reported a valid position. Coordinates are missing or `0,0`. |
| 2 | **non-comm** | `now − utctime` > **30 min**. The device has stopped talking. |
| 3 | **pullout** | `carbattery` < **1.0 V**. The main battery has been removed. The sample (0.07 V) appears as "Pulled out" in the current app. |
| 4 | **immobilized** | `immobilization_status` = 1. |
| 5 | **charging** | `mcu_charge_plug_status` = 1 **or** `charger_status` ≠ 0. **Please confirm which PID/value means charging.** |
| 6 | **no-gps** | The device is communicating but `now − gpstime` > **10 min**. |
| 7 | **running** | `ignstatus` = 1 **and** `speed` > **2 km/h**. |
| 8 | **stopped** | Everything else, including ignition on with speed 0. |

**total** is the count of all vehicles the user can see. It is a counter, not a per-vehicle status.

- The derived status is recomputed on every update. A 1 Hz sweep also handles time-based transitions like non-comm and no-gps.
- Each status has a fixed colour and icon, used the same way on the map, counters, filter chips, table and detail pill.

## Done when
- A unit-test table covers every rule, priority conflict and boundary.
- Counts always add up to the total.

## Resolved
- The rules above are accepted. **Every threshold, PID name, PID value and the priority order lives in one config file**, `status-rules-config.ts`, so it can be changed without touching the code that applies it (D-015).
- "Ignition on, speed 0" counts as **stopped**.
