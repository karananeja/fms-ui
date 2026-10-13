# F07 — Vehicle Details Panel & Parameters · Intent

**Status:** Signed off: 2026-10-13 (user). Layout wording amended for the design correction; see spec revision 2.

## Why
Operators need the current state of a single vehicle from GPS and CAN data in one place. The current app's screenshots show which data exists; the **design is new** and follows `docs/design/design-direction.html` (DS1, correction 2026-10-13).

## What
- **Header:**
  - Regno, with copy and locate buttons.
  - Make · model · variant, and a fuel badge (from `appmeta`).
  - Status pill.
  - **GPS** and **CAN** last-update times in IST, each with a freshness dot.
- **Driving · Energy:**
  - Speed, battery SOC bar, DTE, SOH, ODO.
  - An expanded view with speed and RPM gauges, as in your second screenshot.
- **Parameters:**
  - Every `lafparsed` PID (A4) in a searchable grid.
  - Labels are humanised from the key (`motor_temperature` → "Motor Temperature").
  - Raw values are shown. `65535` is shown as "N/A".
  - Each value shows its own timestamp on hover.
- **Device & Comms:** device ID (copy), aux voltage (`carbattery`), internal battery (`devbattery`), signal (`rxdbm`).
- **Location:** lat/long with a copy button.
- **Share live location** button, which opens F10. It shows only if the user has `share.create`.
- **Layout:** a side panel on desktop and a bottom sheet on mobile. The panel reflects live updates in place.
- **Reports and Analytics are not rendered** (C16).

## Done when
- The panel matches the approved mockup (`docs/design/design-direction.html`).
- Live values update while the panel is open.
- Parameter search filters the grid.
- The panel works on mobile widths.

## Resolved
- Parameters show **raw numbers with no units** (D-017).
- The fixed cards (speed, SOC, DTE, ODO, voltages) show units (km/h, %, km, V).
