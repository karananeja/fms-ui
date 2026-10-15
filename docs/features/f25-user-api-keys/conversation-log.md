# F25 — User-provided AI Keys · Conversation log

## 2026-10-16 — Spec + implementation (agent, parallel with F23)
**User (via orchestrator):** Implement F25 per the signed-off intent: per-user xAI/OpenAI/Anthropic keys,
encrypted at rest, masked only, model list, Test connection, Save/Remove; user key → server key (admin
fallback setting) → not configured; redaction, rate limit, audit, delete with the user. Settings UI as a
self-contained page under `src/features/settings/`; do not touch `src/app/**`, assistant or dashboards UI.

**Assistant:**
- Wrote `spec.md` (Draft) and Proposed **D-143** (storage, crypto, `org_settings` + `roles.manage`,
  default fallback on, audit log, rate limit, fake keys).
- Server: migration v8 (`user_ai_keys`, `org_settings`, `audit_log`), `AiKeys` store, `key-crypto.ts`
  (AES-256-GCM, HKDF of `FMS_SECRET_KEY`), `provider-models.ts`, `user-assistant.ts`,
  `routes/ai-key-routes.ts`; both chats now resolve per user; "not configured" text points to Settings;
  logger redaction; dev reset wipes the new tables.
- Contract: `shared/contract/ai-keys.ts`.
- Client: `AiKeysPage`, `ai-keys-api.ts`, `assistantLabel()` / `notConfiguredText()` helpers + tests.
- e2e spec written as `fixme` pending wiring. README and `.env.example` document `FMS_SECRET_KEY`.

**Status/Next:** Orchestrator wires the route, nav entry, chat header label, "Add your key in Settings"
link and `FMS_SECRET_KEY` in the Playwright env, un-fixmes the e2e; then UAT and D-143 approval.
