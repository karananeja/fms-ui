# F17b — Fleet Assistant client · Test report

| Field | Value |
|---|---|
| Date | 2026-10-14 |
| Branch | `feature/f17-assistant` (uncommitted, orchestrator commits) |
| Ports | VITE 5373 / MOCK 4200 |
| Spec | `spec.md` §4 F17-R1…R6, §6 budgets, §7 F17-T5…T8 (client part) |

## Results
| ID | Type | Where | Result |
|---|---|---|---|
| F17-T5 | component / unit | `src/features/assistant/assistant.test.tsx` (11 tests) | Pass |
| F17-T6 | e2e (fake model) | `e2e/assistant.spec.ts`: vehicle question → tool chip → map link; driver question → analytics link; no-GPS CSV download (row count = report descriptor = CSV lines); PDF download (`.pdf`, `%PDF-` header) | Pass |
| F17-T7 | e2e | Viewer: no "Ask FMS" button, `POST /api/chat` → 403. Operator (North) asking for a South regno: tool fails, "not found", no entity links | Pass |
| F17-T8 | e2e screenshots | `screenshots/`: `panel-empty`, `panel-answer`, `tool-chips`, `report-card`, `mobile`, `not-configured` | Pass |

Targeted runs: `pnpm vitest run src/features/assistant src/app` gives 39/39 (4 files). `FMS_ASSISTANT_FAKE=1 VITE_PORT=5373 MOCK_PORT=4200 pnpm playwright test --project=setup --project=chromium e2e/assistant.spec.ts` gives 7/7. `pnpm typecheck` is clean. `pnpm eslint src/features/assistant src/app e2e/assistant.spec.ts` is clean.

### What F17-T5 covers
- SSE parser: chunk boundaries, CRLF, comments, malformed JSON, unknown event types, a last event without a trailing blank line.
- Store: the transcript is ≤ 30 turns, oldest dropped first, starts with a user turn, and leaves out failed exchanges. The conversation clears on sign-out and aborts a running answer. A 401 expires the session. HTTP 429 shows busy.
- Panel: suggested prompts. Enter sends, Shift+Enter adds a new line. Streaming text renders markdown (bold, table, list, inline code). Tool chips go from running to ok to failed. Entity links point to `/live-tracking?vehicle=` and `/analytics?tab=drivers&driver=`, and clicking one closes the sheet. Stop aborts the fetch, keeps the partial answer and marks unfinished chips failed. Retry asks again. The report card shows the file name, rows, format and Download, and says "Link expired — ask again to regenerate" once expired. `not_configured` shows the set-up notice with no alert and disables the composer. `busy` shows the message with Retry. `refusal` shows a polite line with no Retry. A stream cut off without `done` shows an error.

## Budgets (§6)
| Budget | Measured |
|---|---|
| Panel chunk ≤ 40 kB gzip | `assistant-panel-*.js` 17.7 kB raw / **6.5 kB gzip** (zod and the contract are already in the shell) |
| App shell +≤ 2 kB gzip | `app-entry` 101.26 → 101.71 kB gzip (**+0.45 kB**) |
| No `@anthropic-ai/sdk` / `pdf-lib` in the browser bundle | Confirmed (grep of `dist/assets/*.js`) |

## Notes
- The not-configured screenshot uses `page.route('/api/chat')` returning an SSE `error {code: not_configured}`, because the server's mode is fixed at start (env).
- The PDF e2e queues a script (`POST /api/dev/assistant/script`) for one small fleet (`Delhi Hub 1`). The rule-based no-GPS report for the super admin is about 13 k rows, which is above the 5 k PDF cap, so the tool correctly refuses it.
- The driver e2e creates a uniquely named driver. Seeded names repeat, and `get_driver` answers "several drivers match" for them.
- Manual smoke test with a real `ANTHROPIC_API_KEY` is not part of CI and has not been run yet.
