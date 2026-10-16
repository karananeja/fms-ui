# F31 — Enabled models & chat model picker · Conversation log

## 2026-10-16
**User:** "instead of selecting the model while adding the api key, let the user select the models and enable them via the settings page so that the user can only use the models that are enabled" → four questions answered: picker in chat, checklist per key, server key unchanged, all providers.

**User:** "yes, go ahead" → intent + spec signed off.

**Assistant:** Built on `feature/f31-enabled-models`:
- Contract first (`shared/contract/ai-keys.ts`) and the API client.
- One agent built the client: `ai-keys-page.tsx` rewrite, `model-checklist.tsx`, `lib/model-list.ts`, and `ModelPicker` in `assistant-status.tsx`, used by the Ask FMS panel and the dashboard dock.
- The orchestrator built the server: migration v17 (`enabled_models`, `available_models`, `models_fetched_at`, `user_ai_prefs`), the `AiKeys` store (choice repair, `userModel`, `options`, `choose`), `resolveAssistant` (`preferServer`, `no_models_enabled`), and the routes (Save loads models, refresh, enable, `PUT /me/ai-model`; `/models` and `/test` removed).
- Updated F25 server tests and the e2e spec.

Spec notes found while building:
- The Default assistant choice needed its own per-user table (`user_ai_prefs`).
- The Save fallback message travels as `aiKeysState.notice`.
- Radix names the picker menu after its button, so e2e finds it by role only.
