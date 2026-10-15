# F25 — User-provided AI Keys · Test report

**Date:** 2026-10-16 · **Status:** Implemented, server + component tests green; e2e written, pending wiring.

## Targeted runs
| Command | Result |
|---|---|
| `pnpm vitest run mock-server/tests/f25-user-api-keys.test.ts` | 19/19 |
| `pnpm vitest run src/features/settings` | 5/5 |
| F25 + F17, F19 (chat, previews, auto-title), F21, F22, F24, `database.test.ts`, `rest-contract`, `auth-flows`, `build-server` | 13 files, 142/142 |
| `pnpm exec tsc -b` | clean |
| `pnpm exec eslint` on all F25 files | clean |

## Coverage by acceptance test
| ID | Where | Notes |
|---|---|---|
| F25-T1 | `f25-user-api-keys.test.ts` | round trip, AAD binding (other user / provider), other secret, short secret, mask, redaction |
| F25-T2 | same | DB row has `v1:` ciphertext, no plaintext in DB, responses or audit; active switching; 404s; 409 `secret_missing`; unreadable keys flagged |
| F25-T3 | same | stubbed fetch for OpenAI (Bearer, non-chat filter), Anthropic (`x-api-key`, version), 401 → fixed message; fake keys; 6th check → 429 |
| F25-T4 | same | pure `resolveAssistant` + fallback switch end to end (`not_configured` event, status reason) |
| F25-T5 | same | user fake OpenAI key → request on the OpenAI wire with the user's model while the server env is on the Anthropic wire; `/api/assistant/status` |
| F25-T6 | same | key + setting survive a restart (file DB); 403 for ops on `/api/settings/ai` |
| F25-T7 | same | user row delete cascades; `POST /api/dev/reset` wipes keys, settings, audit |
| F25-T8 | `src/features/settings/ai-keys-page.test.tsx` | add → load models → test → save (input cleared, masked row), failed test + 429 error, remove with confirm, admin switch, storage-unavailable |
| F25-T9 | `e2e/f25-user-api-keys.spec.ts` | `test.fixme` until the route, chat label and `FMS_SECRET_KEY` env are wired |

## Notes
- `mock-server/db/database.test.ts` table list updated for v8 (and the parallel v9 `dashboard_snapshots`);
  the "newer schema" assertion now reads the latest version from `MIGRATIONS`.
- Prettier was not run on the new files (not part of `pnpm check`); run `pnpm format` before merge.
- Full `pnpm check` / build / e2e: not run (left to the orchestrator's single end-of-batch run).
