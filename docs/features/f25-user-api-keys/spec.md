# F25 — User-provided AI Keys · Spec

**Status:** Draft — written with the signed-off intent (2026-10-15). Decision: D-143 (Proposed).

## 1. Scope
Per-user AI provider keys (xAI Grok, OpenAI, Anthropic) for the fleet assistant and the dashboard chat
(F17/F19/F21). Keys are encrypted at rest, used only by the mock server, and never returned to the browser.
An org setting decides whether the server `.env` key (F21) may be used when a user has no key.

## 2. Resolution order (every chat turn, both chats)
1. The user's **active** key (one per provider; the last saved is active) → its provider + model.
2. Else, if the org setting **Allow the server key as a fallback** is on (default **on**, keeps F21
   behaviour) → `assistantEnv()` (F21: env key, or the fake model in dev / `FMS_ASSISTANT_FAKE=1`).
3. Else → `not_configured` (chat error event; the client shows "Add your key in Settings" + link).

A key that can't be decrypted (secret changed or missing) counts as absent and is flagged `readable: false`.
Fake keys: a key starting `fake-` uses the fake model on that provider's wire format, only when the fake
model is registered (dev or `FMS_ASSISTANT_FAKE=1`); `fake-…invalid…` is rejected by Test/Load models.

## 3. Contract (`shared/contract/ai-keys.ts`)
- `aiProviderSchema` = `xai | openai | anthropic`; `AI_PROVIDER_LABELS`.
- `aiKeySummary` = `{ provider, model, masked, active, readable, createdAt, updatedAt }` — `masked` is
  prefix + `…` + last 4 (`xai-…9f3c`, `sk-ant-…ab12`). No other key material.
- `assistantStatus` = `{ source: user|server|none, provider|null, model|null, fake, reason: null|fallback_disabled|server_not_configured }`.
- `aiKeysState` = `{ keys, status, fallback: { allowed, serverConfigured }, storageAvailable }`.
- `aiSettings` = `{ allowServerKeyFallback, serverConfigured, serverProvider|null, serverModel|null }`.
- Inputs: `apiKey` 8–512 printable non-space chars; `model` 1–200 chars; all inputs `strictObject`.
- `KEY_CHECK_LIMIT` = 5 checks (Load models + Test) per user per `KEY_CHECK_WINDOW_MS` = 60 s.

## 4. Endpoints (session cookie)
| Method · path | Permission | Body → response |
|---|---|---|
| `GET /api/me/ai-keys` | `chat.use` | → `aiKeysState` |
| `POST /api/me/ai-keys/models` | `chat.use`, rate-limited | `{ provider, apiKey? }` → `{ models }` (no `apiKey` = stored key) |
| `POST /api/me/ai-keys/test` | `chat.use`, rate-limited | `{ provider, apiKey?, model }` → `{ ok, message, models }` |
| `PUT /api/me/ai-keys/:provider` | `chat.use` | `{ apiKey?, model }` → `aiKeysState`; makes it active. No `apiKey` = keep the stored key (change model / make active) |
| `DELETE /api/me/ai-keys/:provider` | `chat.use` | → `aiKeysState`; the newest remaining key becomes active |
| `GET /api/assistant/status` | `chat.use` | → `assistantStatus` (chat header label) |
| `GET /api/settings/ai` | `roles.manage` | → `aiSettings` |
| `PUT /api/settings/ai` | `roles.manage` | `{ allowServerKeyFallback }` → `aiSettings` |

Errors: 409 `secret_missing` (Save while `FMS_SECRET_KEY` is unset/short), 404 `not_found` (no stored key
for that provider when `apiKey` is omitted), 429 `rate_limited` (+ `retry-after`), 422 validation;
Load models: 422 `key_rejected`, 502 `key_unreachable` / `key_failed` (fixed messages).
Test connection never fails with 5xx for provider problems: it answers `ok: false` with a fixed message
("The provider rejected this key.", "Couldn't reach OpenAI.", "Model X isn't available for this key.").

## 5. Model list
- OpenAI `GET https://api.openai.com/v1/models`, xAI `GET https://api.x.ai/v1/models` (Bearer);
  Anthropic `GET https://api.anthropic.com/v1/models?limit=100` (`x-api-key`, `anthropic-version: 2023-06-01`).
- Ids sorted; OpenAI non-chat models (embeddings, audio, image, moderation…) filtered out. 10 s timeout.
- Fake keys: anthropic `claude-opus-5-5`, `claude-fake-small`; openai/xai `fake-model`, `fake-model-mini`.
- Provider response bodies are never echoed to the browser or the log.

## 6. Schema (migration v8 `ai_keys`, append-only)
- `user_ai_keys(user_id → users ON DELETE CASCADE, provider, model, secret, masked, active, created_at,
  updated_at, PK(user_id, provider))`.
- `org_settings(key PK, value JSON, updated_by, updated_at)` — key `assistant.allowServerKeyFallback`.
- `audit_log(seq PK, at, actor_id, action, target, details JSON)` — actions `ai_key.saved`,
  `ai_key.removed`, `ai_settings.updated`; details hold provider/model/flag only.
- Store `AiKeys` (`mock-server/store/ai-keys.ts`): write-through cache like F22 (hydrate at start,
  `atomic()` per mutation). Dev reset / `MOCK_DB_RESET=1` wipe the three tables.

## 7. Crypto
- AES-256-GCM (`node:crypto`), 12-byte random IV, 16-byte tag; AAD = `<userId>:<provider>` (a row copied
  to another user or provider fails to decrypt).
- Key = HKDF-SHA256(`FMS_SECRET_KEY`, salt `fms-ai-keys`, info `aes-256-gcm v1`, 32 bytes).
  `FMS_SECRET_KEY` must be ≥ 16 chars; otherwise keys are not stored (409) and stored keys are unreadable.
- Stored as `v1:` + base64(iv ‖ tag ‖ ciphertext). Documented in `.env.example` and README.

## 8. Security notes
- Keys never leave the server: responses carry `masked` only; the key input is cleared after Save.
- Fastify logger redacts `apiKey`, `*.apiKey`, `authorization`, `x-api-key`; provider error text is replaced
  by fixed messages and any `sk-…` / `xai-…` token is redacted before logging.
- Fake-key chats send the fake placeholder key, never the user's key, to the local fake API.
- Rate limit: 5 key checks per user per minute (in memory). Audit rows carry no key material.
- Deleting a user row cascades to their keys (no user-delete API exists yet; disabled users keep keys
  but cannot sign in).

## 9. UI (`src/features/settings/`)
`AiKeysPage` (route `/settings/ai`, needs `chat.use`): status line ("Answering with OpenAI · gpt-5 · your
key"), saved keys (masked, model, Active, **Use**, **Remove** with confirm), add/replace form (provider
segmented control, password-type key input, **Load models**, model select, **Test connection**,
**Save key**), and for `roles.manage` an **Allow the server key as a fallback** switch.
Wiring by the orchestrator (outside F25 ownership): route + nav/user-menu entry, "not configured → Add your
key in Settings" link and the provider/model label in the assistant panel and dashboard chat dock
(`GET /api/assistant/status`), `FMS_SECRET_KEY` in the Playwright web-server env.

## 10. Acceptance tests
- **F25-T1** crypto: round trip; DB row is not plaintext; wrong AAD / secret fails; mask format.
- **F25-T2** save/list/remove: responses never contain the key; masked + model; active switching; audit rows
  without key material; 409 without `FMS_SECRET_KEY`.
- **F25-T3** models + test with fake keys; rejected key → `ok: false`; unknown model → `ok: false`;
  6th check in a minute → 429.
- **F25-T4** resolution: user key beats server; fallback off → `not_configured`; removing the key falls back.
- **F25-T5** chat uses the user key: fake OpenAI-wire request with the user's model while the server is on
  the Anthropic wire; `/api/assistant/status` reports `source: user`.
- **F25-T6** admin setting: `roles.manage` only (403 for ops); persisted across restart (hydrate).
- **F25-T7** user row deleted → keys gone (FK cascade); dev reset wipes keys.
- **F25-T8** page (component): add, load models, test, save (input cleared), use, remove; fallback switch
  only for admins; storage-unavailable note.
- **F25-T9** e2e (pending wiring): Settings → add fake key, test, save, chat header label, remove.
