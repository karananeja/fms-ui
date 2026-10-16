# F31 — Enabled models & chat model picker · Spec

**Status:** Signed off: 2026-10-16 (user: "yes, go ahead"). Decision: D-171 (Accepted 2026-10-17). Amends D-143 (F25).

## 1. Data (migration v17, append-only)
- `user_ai_keys` gains `enabled_models TEXT NOT NULL DEFAULT '[]'` (JSON ids, in the order ticked), `available_models TEXT NOT NULL DEFAULT '[]'` (JSON ids from the provider) and `models_fetched_at INTEGER`.
- Existing columns get new meanings: `model` = the last model picked for this provider; `active = 1` = the user's chosen key (at most one per user, as before).
- Backfill: `enabled_models = available_models = [model]`; `active` stays as it is, so existing users keep their key and model.
- Limits: at most 20 enabled models per key; the stored available list is capped at 500 ids.
- New `user_ai_prefs(user_id PK → users ON DELETE CASCADE, use_server, updated_at)`: the user picked **Default assistant** in the chat picker. Dev reset wipes it.

## 2. Resolution (every chat turn, both chats)
1. The chosen key (`active`) when it is readable and its `model` is still in `enabled_models` → that provider and model.
2. Otherwise the first enabled model of the most recently updated readable key (the choice is repaired and saved).
3. Otherwise the server key, if the fallback is allowed (F25/F21, unchanged), or if the user explicitly chose **Default assistant**.
4. Otherwise → `not_configured`. New reason `no_models_enabled` when keys exist but none has an enabled model and there is no fallback.

## 3. Contract (`shared/contract/ai-keys.ts`)
- `aiKeySummary`: **removes** `model` and `active`, and **adds** `enabledModels: string[]`, `availableModels: string[]`, `modelsFetchedAt: epochMs | null`.
- New `aiModelChoice = { provider: AiProvider, model }`, and `assistantChoiceInput = aiModelChoice | { source: 'server' }`.
- `assistantStatus` adds `options: { provider, model }[]` (enabled models of all readable keys, in provider order) and `serverOption: { provider, model } | null` (set when the default assistant may be used). `reason` adds `no_models_enabled`.
- `aiKeysState` carries the new summary in `keys`, plus an optional `notice` (Save could not load models: "Saved. Couldn't load models: try Refresh.").
- `saveAiKeySchema` becomes `{ apiKey }` (required); `MAX_ENABLED_MODELS = 20`.

## 4. Endpoints (session cookie, `chat.use`)
| Method · path | Body → response | Notes |
|---|---|---|
| `PUT /api/me/ai-keys/:provider` | `{ apiKey }` → `aiKeysState` | Rate-limited. Loads models with the key first: a rejected key → 422 `key_rejected` and nothing is saved; unreachable → saved with an empty list and the message "Saved. Couldn't load models: try Refresh." A replaced key keeps the enabled models that are still available. |
| `POST /api/me/ai-keys/:provider/models/refresh` | — → `aiKeysState` | Rate-limited; uses the stored key. Enabled models that disappeared are disabled. |
| `PUT /api/me/ai-keys/:provider/models` | `{ enabled: string[] }` → `aiKeysState` | Each id must be in `availableModels` (422 otherwise); ≤ 20; the first enabled model with no current choice becomes the choice. |
| `PUT /api/me/ai-model` | `assistantChoiceInput` → `assistantStatus` | 422 `model_not_enabled` when the model isn't enabled on a readable key; 409 `fallback_disabled` for `server` when not allowed. |
| `DELETE /api/me/ai-keys/:provider` | → `aiKeysState` | Unchanged; the choice moves per §2. |
| `GET /api/assistant/status` | → `assistantStatus` | Now carries `options` / `serverOption`. |

- **Removed:** `POST /api/me/ai-keys/models` and `POST /api/me/ai-keys/test`, which are replaced by Save and Refresh. The F25 rate limit (5 checks per user per minute) now counts Save and Refresh.
- **Chat endpoints are unchanged:** `/api/chat` and the dashboard chat resolve per §2 on each turn, so a choice made in one chat applies to the other. The model is not part of the request body.
- **Audit:** `ai_key.saved` (provider and model count) and new `ai_key.models_updated` (provider, enabled ids). Choosing a model is not audited.

## 5. UI
- **Settings → AI assistant (`/settings/ai`):**
  - **Answering with** line (unchanged).
  - **Add a key:** provider segmented control, password key input, **Save key** (busy "Checking key…"). The input clears after Save.
  - **Your keys:** one card per key with the masked key, "N of M models enabled", **Refresh models**, **Replace key** (inline key input) and **Remove** (with confirm).
    - The card holds a checklist with search: enabled models are listed first, then the rest, with All / Clear limited to the current search results.
    - Each tick saves straight away (optimistic, rolled back with a toast on error).
    - Above 20 enabled, further ticks are disabled ("Up to 20 models").
    - An unreadable key shows "Can't be read. Paste it again." and its checklist is hidden.
  - **Organisation** fallback switch (unchanged).
- **Chat model picker (`ModelPicker`, replaces `AssistantModelLabel`)** in the Ask FMS panel header and the dashboard chat dock:
  - A compact button shows "Claude · claude-opus-5-5" and opens a menu: one group per provider listing its enabled models, a **Default assistant · <model>** item when `serverOption` is set, a tick on the current choice, and a **Manage models** link at the bottom.
  - Disabled while a turn is streaming.
  - It refreshes the status on open and after a choice. With no options at all, it shows the F25 `AddKeyNote` text, now "Enable a model in Settings" when keys exist.

## 6. Acceptance tests
- **F31-T1** migration v17: an F25 row backfills `enabled = available = [model]` and resolution gives the same provider and model as before.
- **F31-T2** save: no model in the body (a body with one is a 422 strictObject error); fake key → `availableModels` filled and nothing enabled; rejected fake key → 422 and nothing stored; the response never contains the key.
- **F31-T3** enable / refresh: unknown id → 422; more than 20 → 422; refresh drops models that are gone; the first enable sets the choice.
- **F31-T4** choice: `PUT /me/ai-model` with a model that isn't enabled → 422; switching to another provider's model changes the provider of the next chat turn (fake OpenAI wire while the server is on Anthropic) and the F30 usage row; disabling the chosen model moves the choice; `server` refused when the fallback is off.
- **F31-T5** status: `options` lists only enabled models of readable keys; `serverOption` follows the fallback switch; reason `no_models_enabled`.
- **F31-T6** settings page (component): add key without a model field, tick and untick models, search, refresh, remove; the 20 cap.
- **F31-T7** picker (component): grouped options, current tick, disabled while streaming, Manage models link.
- **F31-T8** e2e: Settings → add fake key, enable two models → Ask FMS picker → pick → dashboard dock shows the same → disable it in Settings → the picker moved.
- Update F25-T2/T3/T8/T9 for the removed endpoints and the new form.
