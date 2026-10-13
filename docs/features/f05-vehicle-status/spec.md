# F05 — Vehicle Status Derivation · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` (signed off 2026-10-13, D-015) |
| Branch | `feature/f05-vehicle-status` (after F04 is accepted) |

## 1. Files (kebab-case)

```
shared/domain/vehicle-status.ts                       status ids + type (shared with mock tests)
src/features/live-tracking/config/status-rules-config.ts   the ONE place to change rules (D-015)
src/features/live-tracking/config/status-meta.ts      label, colour token, icon per status
src/features/live-tracking/worker/status-deriver.ts   pure evaluation + vectorised sweep
```

## 2. Configuration (`status-rules-config.ts`)

```ts
export const statusRulesConfig = {
  preferServerStatus: true,             // use row.displayStatus when present and valid (A5)
  priority: ['gps-never','non-comm','pullout','immobilized','charging','no-gps','running','stopped'],
  thresholds: {
    nonCommMs: 30 * 60_000,             // now − utctime  >  this → non-comm
    noGpsMs: 10 * 60_000,               // now − gpstime  >  this → no-gps
    pulloutVolts: 1.0,                  // carbattery     <  this → pullout
    runningSpeedKmh: 2,                 // speed          >  this (and ignition on) → running
  },
  immobilized: { field: 'immobilization_status', equals: 1 },
  charging: {                           // any-of; a PID that has not arrived yet (null) never matches
    anyOf: [
      { pid: 'mcu_charge_plug_status', equals: 1 },
      { pid: 'charger_status', notEquals: 0 },
    ],
  },
  sweepIntervalMs: 1000,
} satisfies StatusRulesConfig;
```

- A zod schema validates the config when the worker starts. These are errors:
  - Unknown or duplicate status IDs in `priority`.
  - A missing status, other than `stopped`, which must be last and is the fallback.
  - Non-positive thresholds.
- The fleet-scope lafparsed PIDs (F04-R9) are **derived from this config**: the unique `charging.anyOf[].pid` values, plus `immobilized.field` if it isn't a combinfo field. `live-tracking-config.ts` stops hard-coding them.

## 3. Rules

`deriveStatus(v, now, cfg)` walks `cfg.priority`. **The first rule that matches wins.**

| Status | Matches when |
|---|---|
| gps-never | `lat` and `lng` are both `0`, or missing/NaN |
| non-comm | `now − utctime > nonCommMs` |
| pullout | `carbattery < pulloutVolts` |
| immobilized | `[immobilized.field] === immobilized.equals` |
| charging | any `charging.anyOf` condition holds. `null`/NaN never matches; this applies to both `equals` and `notEquals`. |
| no-gps | `now − gpstime > noGpsMs` |
| running | `ignstatus === 1 && speed > runningSpeedKmh` |
| stopped | always (fallback), including ignition on with speed 0 |

- **Server status:** if `preferServerStatus` is set and the row has a valid `displayStatus` string, that value is used. The mock never sends one (D-025), so this is covered by unit tests only.
- **`now`** is `engine.now()`, which is server-clock corrected (F04-R8).
- Comparisons are strict, exactly as written. A vehicle exactly 30 min stale is **not** non-comm.

## 4. Worker integration

| ID | Requirement |
|---|---|
| F05-R1 | `fleet-state` gains a `Uint8Array status` column, plus `Uint32Array counts[8]` and `total`. |
| F05-R2 | Status is recomputed for a vehicle on every row applied to it (combinfo or lafparsed). Counts are updated incrementally, both on removal and when a status changes. |
| F05-R3 | **Sweep:** every `sweepIntervalMs`, a full pass re-evaluates every vehicle so time-based changes like non-comm and no-gps happen without new messages. The pass must take ≤ 5 ms at 1 lakh vehicles; the benchmark asserts ≤ 20 ms to allow for slow CI machines. |
| F05-R4 | The push payload adds `statusCounts: Record<VehicleStatus, number>` and `total`. `getVehicleSummary` and `selected` include `status`. The store snapshot exposes `statusCounts` and `total`. |
| F05-R5 | `status-meta.ts` maps each status to a label, colour variable (F00 tokens) and lucide icon:<br>• Running: `--st-running`, `navigation`<br>• Stopped: `--st-stopped`, `circle-stop`<br>• Immobilized: `--st-immobilized`, `lock`<br>• Non-comm: `--st-noncomm`, `wifi-off`<br>• Charging: `--st-charging`, `battery-charging`<br>• Pullout: `--st-pullout`, `battery-warning`<br>• No GPS: `--st-nogps`, `map-pin-off`<br>• GPS never: `--st-gpsnever`, `circle-dashed`<br>Every later UI (marker, chip, pill, table) reads only from here. |
| F05-R6 | The diagnostics panel (F04-R22) adds a status list: a coloured dot, label and live count per status, plus Total. The selected vehicle shows its status pill. |

## 5. Acceptance tests

| ID | Type | Test |
|---|---|---|
| F05-T1 | unit | A table-driven test covers:<br>• Every rule positive and negative.<br>• Every threshold boundary (equal, just over, just under).<br>• Priority conflicts: non-comm + pullout gives non-comm; pullout + charging gives pullout; immobilized + running gives immobilized.<br>• Null and NaN PIDs never match charging.<br>• The ignition-on, speed-0 case gives stopped. |
| F05-T2 | unit | Changing the config changes the results with no code change: reordered priority, new thresholds, a different charging PID. Invalid configs are rejected with clear zod errors. |
| F05-T3 | unit | Sweep with fake time: a vehicle with no new messages becomes no-gps after 10 min and non-comm after 30 min. Counts follow. |
| F05-T4 | unit | Counts: across random insert, update and remove sequences, the counts always sum to `total` = `vehicleCount`. |
| F05-T5 | unit | Server `displayStatus` overrides the rules when valid. An invalid value is ignored. |
| F05-T6 | integration | Engine vs mock (`MOCK_VEHICLES=2000`): all 8 statuses are present, and the mix is within ±5 points of D-030. The fleet lafparsed subscription uses the PIDs derived from config. |
| F05-T7 | perf | A full sweep over 100 000 synthetic vehicles is ≤ 20 ms; the time is reported. |
| F05-T8 | e2e | At 1 lakh vehicles, the diagnostics status counts sum to 100000.<br>After `POST /api/dev/clock {offsetMs: 31 min}`, the diagnostics server clock offset moves to about +31 min within the next heartbeat (≤ 20 s). The counts still sum to the total and are not all non-comm. This proves the worker uses server time, not browser time.<br>Time-based transitions without messages are covered by F05-T3. |
| F05-T9 | cmd | `pnpm check`, `pnpm build` and `pnpm e2e` all pass. |

## 6. Out of scope
How status is shown on the map, counters UI and filters (F06, F08). F05 only provides data, metadata and the diagnostics list.
