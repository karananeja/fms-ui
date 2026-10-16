# F30 — AI token usage monitor · Intent

**Status:** Draft, 2026-10-16. Waiting for sign-off. User: "i need a monitor to track my token usage" (chose: my own usage, plus an admin view).

## Why
Users now bring their own AI keys (F25), and every chat turn costs money on their account. Today usage is counted only in memory per provider. Output tokens are dropped, and nothing is per user or model, stored, or visible in the app.

## What
- **Record every model run** in SQLite, one row per run:
  - who: user, and whether their own key or the server key was used
  - where: global Ask FMS or dashboard chat, plus the thread
  - what: provider, model, number of tool steps
  - tokens: input, output, cache read, cache write
  - outcome, timestamp, and an **estimated cost**
- **Estimated cost:**
  - Comes from a price table per provider and model, kept in code with the date it was checked, and always labelled "estimate".
  - Models missing from the table show tokens only.
  - Fake-model runs are recorded but flagged, and hidden by default.
- **My usage** (Settings → AI usage, for everyone with `chat.use`):
  - Totals for today, 7 days and 30 days: tokens in and out, cache hit rate, estimated cost.
  - A daily chart (in-house SVG, as in F16).
  - A breakdown by provider and model, and by chat.
  - The most expensive recent turns, each linking to its thread.
- **Admin view** (same page, extra tab, for `roles.manage`):
  - The whole organisation, broken down by user, provider and model, and day.
  - Filters by date range, user and provider.
  - CSV export.
- **Live:** the totals update after each turn (no polling).

## Out of scope
- Quotas, spending limits or blocking a user. This could be a follow-up once there is data.
- Reconciling with the provider's own billing dashboard.
- Usage of other paid APIs (map tiles, etc.).
- Alerts.

## Done when
- Every run (global chat, dashboard chat, Retry, auto-title) writes exactly one usage row with correct token counts (unit tests with the fake providers' usage).
- My usage shows the right totals and breakdowns for the signed-in user only.
- The admin tab shows all users and is hidden without `roles.manage`.
- Costs are labelled as estimates, and unknown models show tokens only.
- e2e covers both views and the CSV export.
