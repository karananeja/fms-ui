# F30 — AI token usage monitor · Spec

**Status:** Draft, 2026-10-16. Building on the user's go-ahead ("speed up, focus on development"); sign-off at UAT. Intent signed off 2026-10-16.
**Proposed decision:** D-169 (usage storage, price table, views).

## 1. Recording (migration v15, `ai_usage`)

- **What:** one row per model run:
  - user
  - chat: `global`, `dashboard` or `title`
  - thread or dashboard
  - provider and model
  - source: the user's own key, the server key, or the fake model
  - tool steps
  - tokens: input, output, cache read, cache write
  - outcome
  - an estimated cost in USD
- **Where:** written from the runner's existing `onUsage` callback in `assistant-routes.ts`, for the global chat, dashboard chat and Retry, and for the auto-title call where it uses a model.
- **Cost:** from `mock-server/store/usage-prices.ts`, USD per 1M tokens, dated `checked: 2026-10-06`. It covers the Anthropic models only (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1). Any other model gets no cost, and the UI says "tokens only: no price on file". Fake runs are stored with no cost and hidden unless `includeFake=1`.

## 2. API

| Route | Who | Returns |
|---|---|---|
| `GET /api/me/usage?range=7d\|30d\|90d` | chat.use (own rows) | totals for today, 7 days and 30 days; daily series; by provider and model; by chat; the 10 costliest recent turns |
| `GET /api/admin/usage?range=&userId=` | roles.manage | the same for everyone, plus totals per user |
| `GET /api/admin/usage.csv?range=` | roles.manage | one line per run |

Totals: tokens in and out, cache read and write, cache hit rate = cache read ÷ (input + cache read + cache write), turns, estimated cost. Days are in IST.

## 3. UI: Settings → AI usage (`/settings/usage`)

- **Range:** 7, 30 or 90 days.
- **Tiles:** tokens in, tokens out, cache hit rate, estimated cost (labelled "estimate").
- **Chart:** a daily stacked bar chart (in-house SVG).
- **Tables:** by provider and model, by chat, and the costliest turns (dashboard turns link to their dashboard).
- **Organisation tab:** with roles.manage only. Same views plus per-user totals and Export CSV.
- **Updates:** the page shows the latest numbers when opened or when the range changes. There is no polling.

## 4. Acceptance tests (relaxed)

| ID | What it proves |
|---|---|
| F30-T1 | record → summary, daily, by model and by chat numbers; cost for a priced model and none for an unpriced one |
| F30-T2 | `/api/me/usage` returns only the caller's rows; the admin routes are 403 without roles.manage; the CSV header |
| F30-T3 | e2e: the page renders tiles or the empty state; the Organisation tab only for an admin |
| F30-T4 | wiring: a fake-model chat turn writes exactly one row |
