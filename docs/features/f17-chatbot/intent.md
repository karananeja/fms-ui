# F17 — Fleet Assistant (Chatbot) · Intent

**Status:** Signed off: 2026-10-14 (user)

## Why
Users want to ask questions in plain language ("which vehicles have been offline since yesterday?", "who drove MH12AB1234 last week?") and download reports without going through several screens.

## What
- **Chat panel** in the app shell (`chat.use`): conversation history for the session, suggested prompts, and streamed answers.
- **Powered by a real Claude model**, called **only from the server** (mock server proxy, API key in a server env var and never in the browser). The model and settings are decided in the spec.
- The assistant answers through **tools that call the existing APIs as the signed-in user**, so it can only see what that user's permissions and fleet scope allow:
  - **Vehicle info:** status, location, metrics, history.
  - **Driver info:** assignment, requests, KPIs.
  - **Requests and notifications:** open breakdowns, RSA, waiting replacements.
  - **Reports:** generate and **download CSV or PDF** (e.g. vehicle status, utilisation, driver performance, no-GPS for a date range). The download is a link in the chat.
- Clear refusals when something is outside the user's scope. No actions that change data in v1 (read-only).

## Out of scope
Voice, changing data from chat (assign, resolve…), long-term chat memory.

## Done when
- e2e with a mocked model response passes for: a vehicle question, a driver question, a CSV report and a PDF report.
- A scope test proves out-of-fleet data is never returned.
- Works with a real API key when one is configured.
