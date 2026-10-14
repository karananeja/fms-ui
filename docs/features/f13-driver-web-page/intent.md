# F13 — Driver Web Page · Intent

**Status:** Draft (awaiting user sign-off)

## Why
Drivers need a simple way to tell the fleet operator when their vehicle breaks down, to ask for a replacement, and to ask for roadside assistance (RSA), so they don't sit idle.

## What
- **A simple, mobile-first web page** (`/driver`) for users with the **Driver** role. Drivers are invited and sign in with the existing auth (F02). No map-heavy UI and no live-tracking worker.
- It shows **my vehicle**: regno, model, status, and last known location (one vehicle, light page).
- **Report breakdown:** pick a reason (no GPS / device issue, battery or charging, tyre, accident, mechanical, other) plus a note and the current location. This sets the vehicle's **reported reason** that operators see (F14).
- **Request replacement vehicle** and **request RSA** (handled inside the fleet). Each request shows its status timeline (submitted → acknowledged → assigned/dispatched → resolved) and updates live.
- A replacement vehicle, once assigned, shows up as the driver's new vehicle.

## Out of scope
Native app, push notifications, offline mode, photos/attachments (could follow later).

## Done when
A driver signs in, reports a breakdown and requests RSA and a replacement, and sees each status change live as the operator acts (e2e, two contexts).
