# F10 — Share Live Location · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
Users need to share one vehicle's live position with outsiders, such as customers or partners. Those viewers have no account.

## What
- **Create link** from the details panel. The user picks:
  - **Expiry:** 1 h, 6 h, 24 h, 7 days, or a custom date/time.
  - **Visible data:** location only, or location plus selected metric groups (driving·energy, device).
  - **Trail:** on or off, and how far back (for example, the last 1 h).
- The result is a copyable public URL `/share/:token`.
- **Manage links:** a list of active and expired links for the vehicle, plus a global list for admins, with **revoke**.
- **Public page:**
  - No sign-in and no app chrome. A light, map-first page.
  - It shows the vehicle marker updating live, plus the trail and metrics allowed by the link's options.
  - It shows the time the link expires.
  - Expired or revoked links show a clear "link no longer available" screen.
  - The page uses a vehicle-scoped, token-authenticated WS subscription. It never sees fleet data.

## Out of scope
- Sharing multiple vehicles in one link.
- Password-protected links.

## Done when
- e2e tests pass for: create → open in a fresh context → live updates arrive → revoke → the page shows the unavailable screen; and expiry.
- Options are enforced: hidden data is never sent to the public page.
