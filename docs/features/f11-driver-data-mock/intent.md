# F11 — Driver Data & Mock Contract · Intent

**Status:** Signed off: 2026-10-14 (user)

## Why
Every driver-monitoring feature (F12–F16) and the chatbot (F17) need the same new data: drivers, who drives what, the problems drivers report, and history for analytics. Like F01, a shared contract and mock first lets the later features run in parallel without guessing.

## What
- **Zod contract** in `shared/contract/`:
  - drivers;
  - vehicle ↔ driver assignments, with history;
  - driver requests: `breakdown`, `replacement`, `rsa`, with a status flow and timeline;
  - no-GPS reasons;
  - notifications;
  - analytics aggregates.
- **Mock server:**
  - seeded drivers for each fleet;
  - REST for drivers, assignments, requests and their status changes, the notifications feed, and analytics queries;
  - **90 days of generated history** per vehicle and driver: trips, distance, uptime and idle time, SOC/energy use, breakdowns, harsh events.
- **Live events:** request and notification events go over the existing WS (new topic(s)), scoped by fleet like vehicles.
- **Permissions:** new ones, `drivers.manage`, `requests.manage`, `analytics.view` and `chat.use`, plus a new system role **Driver** (sees only their own page). These are wired into `can()` (F03).
- **No-GPS 24 h rule:** a server-side job raises a notification when a vehicle has been in no-GPS for more than 24 h (mock clock aware, D-038).

## Out of scope
Any UI (F12–F17).

## Done when
- The contract and mock tests pass. Every endpoint enforces fleet scope and permissions.
- The history generator is deterministic (seeded) and fast enough for 1 lakh vehicles.
