# F19 — AI Dashboard Builder · Intent

**Status:** Signed off: 2026-10-15 (user)

## Why
Users should be able to describe a dashboard in plain words ("show today's running vs stopped by fleet, the top 10 idle vehicles, and open breakdowns") and get it built, then keep refining it in conversation.

## What
- **New assistant tools,** limited to dashboards the user owns:
  - `create_dashboard`, `get_dashboard`;
  - `add_widget`, `update_widget`, `remove_widget`;
  - `arrange_widgets`, `rename_dashboard`.
  - These are the assistant's first tools that change data (F17 stays read-only for everything else).
- **Building blocks:** the tools only accept widgets from the F18 catalogue. The model is given the catalogue and the available data sources, and uses the existing read-only tools to check names, fleets and vehicles first.
- **Chat for each dashboard:** the chat on a dashboard page talks about that dashboard, and its thread is saved and resumed when the dashboard is opened again. Every change the assistant makes appears as a chip (for example "Added widget: Top idle vehicles") and shows on the page straight away.
- **Global "Ask FMS" panel:** asking it to build a dashboard creates one and offers to open it at `/dashboards/$id`.
- **Undo:** each assistant turn's changes can be undone in one step, from the chip.
- **Fake model:** new scripts so e2e can build, change and remove widgets without an API key (D-107 conventions).

## Out of scope
Widgets outside the catalogue, AI-written code or HTML, scheduled refresh e-mails, chat on dashboards shared with you.

## Done when
- e2e with the fake model passes for: create a dashboard from one prompt (3+ widgets), then change one widget, remove one, rename the dashboard, undo, and resume the chat after a reload.
- A scope test shows the tools can't read or change another user's dashboard.
- It works with a real API key (a smoke test).
