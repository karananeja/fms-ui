# F14 — Operator Request Desk & No-GPS Insight · Intent

**Status:** Draft (awaiting user sign-off)

## Why
Fleet operators need one place to act on driver problems, and to understand **why** a vehicle shows no GPS.

## What
- **Request desk** (`/requests`, `requests.manage`):
  - A queue of breakdown, replacement and RSA requests in the operator's fleet scope.
  - Filters: type, status, age.
  - Actions: acknowledge, dispatch RSA (assignee and ETA note), resolve or close, each with a timeline entry.
- **Replacement (both modes):**
  - The system **suggests** the best idle vehicle in the same fleet: nearest, enough SOC/range, healthy, no open breakdown.
  - The operator approves or overrides it.
  - A per-fleet **auto-assign** setting can skip approval. If no vehicle qualifies, the request waits and the operator is notified.
- **No-GPS insight:** for a vehicle in no-GPS, the details card and the desk show the **likely reason**, combining:
  - the driver's reported reason (F13), and
  - device signals: low device battery, weak signal, ignition off, last-seen time, device offline.

## Out of scope
External RSA providers, SLA billing.

## Done when
e2e passes for a driver breakdown → operator acknowledges → replacement suggested → approved → the driver sees the new vehicle; RSA dispatch → resolve; and the no-GPS reason shows for both driver-reported and signal-derived cases.
