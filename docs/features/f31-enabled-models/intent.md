# F31 — Enabled models & chat model picker · Intent

**Status:** Signed off: 2026-10-16 (user: "yes, go ahead"). User: "instead of selecting the model while adding the api key, let the user select the models and enable them via the settings page so that the user can only use the models that are enabled". Answers to four questions: picker in the chat; a checklist per key; server key unchanged; models from all saved keys.

## Why
F25 ties each saved key to one model, which is chosen in the add-key form. Switching models means saving the key again, and the user can't keep a short list of models they trust and switch between them.

## What
- **Adding a key** asks only for the provider and the key. Saving it checks the key and loads that provider's model list. The form has no model field and no separate Load models or Test step.
- **Each saved key** shows its provider's models as a searchable checklist, with **Refresh models**. Nothing is enabled until the user ticks a model, and the first model ticked becomes the chat's model.
- **Chat model picker** in the Ask FMS panel header and the dashboard chat dock:
  - It lists only the enabled models of every saved key, grouped by provider, plus the default assistant (server key) when the org allows it.
  - The choice is stored per user on the server, so both chats and every tab share it, and it applies from the next turn.
  - The picker is disabled while a turn runs, and **Manage models** links to Settings.
- **Only enabled models can be used.** The server refuses a model that isn't enabled. Disabling or removing the chosen model moves the choice to another enabled one, or to the default assistant, or to "not configured".
- **The "Active key" concept goes away:** the model picked decides which key is used.
- **The server key (.env, F21)** keeps its single model and the admin fallback switch. It is not part of the checklist.
- Existing keys keep working: their saved model is enabled and stays chosen.

## Out of scope
Per-thread or per-dashboard model choice, admin allow-lists for user keys, model prices for OpenAI/xAI (F30 shows tokens only), and comparing models.

## Done when
- A key saves without a model, and its models appear as a checklist.
- Only enabled models appear in both chat pickers, and choosing one changes the provider and model of the next turn (F30 usage rows show it).
- A model that isn't enabled is refused by the server (an API test).
- Migration keeps existing users' key and model working.
- e2e: add a fake key, enable two models, pick one in Ask FMS, see it in the dashboard dock, disable it, and see the choice move.
