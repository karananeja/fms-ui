# F21 — AI Provider Choice · Intent & Spec

**Status:** Approved in chat 2026-10-15 (user asked to proceed and to update `.env.example`). Decision **D-134** (Proposed).

## Why
The user has an xAI Grok key now and may get OpenAI or Anthropic keys later. Today the assistant (F17/F19) only works with Claude through `@anthropic-ai/sdk` (D-105).

## What
- **Providers:** `anthropic` (the existing path, unchanged), `openai` and `xai`, plus `fake`.
  - `openai` and `xai` share one OpenAI-compatible chat-completions adapter, written with plain `fetch` + SSE parsing. No new dependency.
  - Default base URLs: `https://api.openai.com/v1` and `https://api.x.ai/v1`.
- **Config (server env only, see `.env.example`):**
  - `FMS_ASSISTANT_PROVIDER`, `FMS_ASSISTANT_MODEL`, `XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `FMS_ASSISTANT_BASE_URL`, `FMS_ASSISTANT_FAKE`.
  - Auto-pick when the provider is unset: anthropic → openai → xai by key present; no key → fake in dev, `not-configured` in production.
  - `xai`/`openai` without `FMS_ASSISTANT_MODEL` → `not-configured`, with a clear server log line.
  - Existing F17 rules (`FMS_ASSISTANT_FAKE`, D-107) keep working.
- **Same behaviour for every provider:**
  - Tools: one zod definition per tool, converted to each API's tool format (OpenAI `tools[].function` with JSON Schema, `strict` where accepted).
  - The same system prompt, including the F19 widget catalogue.
  - Limits: 8 / 12 steps and 60 / 90 s.
  - The same SSE events to the browser (text deltas, tool chips, dashboard events, reports).
  - Errors map to the existing chat error codes.
- **Browser:** no change.

## Acceptance tests
| ID | Test |
|---|---|
| F21-T1 | Unit: `assistantEnv` provider and model resolution matrix (explicit provider, auto-pick, missing model, fake flags, production). |
| F21-T2 | Unit: zod tool → OpenAI tool schema conversion for all 15 tools (snapshot), including the strict-safe widget schema. |
| F21-T3 | Integration: a fake OpenAI-compatible endpoint (`/__fake-openai/v1/chat/completions`, real SSE wire format with `tool_calls` deltas) drives the existing F17 and F19 contract scenarios: vehicle question, CSV report, create a dashboard with 3 widgets, change and remove a widget, undo. Same SSE events as the Anthropic path. |
| F21-T4 | Scope: out-of-fleet data is never returned via the OpenAI path (F17 scope test re-run). |
| F21-T5 | Manual smoke test with the user's `XAI_API_KEY`: a question, a report, and building and refining a dashboard. |

## Out of scope
A provider picker in the UI, per-user providers, cost tracking, other providers (Gemini etc.).
