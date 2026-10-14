# F15 — In-App Notifications · Intent

**Status:** Signed off: 2026-10-14 (user)

## Why
Operators must notice problems without watching the map: vehicles in no-GPS for more than 24 h, new driver requests, and waiting replacements.

## What
- **Bell + notification centre** in the app shell: unread count, list (newest first), mark read / mark all read, and click to open the related vehicle or request.
- **Toasts** for new high-priority notifications while the app is open.
- **Sources:**
  - the server's 24 h no-GPS rule (F11);
  - new or updated driver requests (F13/F14);
  - a replacement waiting with no vehicle available.
- **Recipients:** users whose fleet scope contains the vehicle and who hold the relevant permission (`requests.manage` for requests; `live.view` for the no-GPS alerts).
- **Delivery:** live over the existing WS. The main thread stays light (D-005).

## Out of scope
Email, SMS, push and per-user notification preferences.

## Done when
With the mock clock moved past 24 h of no-GPS, the alert appears live for in-scope users only (clock e2e). A new driver request notifies the operator within 5 s.
