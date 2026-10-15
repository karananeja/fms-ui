# F23 — Chat & Dashboard UX Polish · Intent

**Status:** Signed off: 2026-10-15 (user: Q1 "all" three card kinds; Q5 build alongside F22)

## Why
UAT feedback on F19/F20: results appear without warning, interrupted answers dead-end, navigation and the list feel thin, and the chat button is duplicated on the dashboard page.

## What
- **Richer cards** (all three kinds, user 2026-10-15): dashboard list cards, chat preview cards and grid widget frames get more context.
  - Dashboard cards: mini layout thumbnail, widget-type icons, owner or "shared by", last updated, share count.
  - Preview cards: type icon, data source, time range, size.
  - Widget frames: source chip, last refreshed time, live dot.
- **Loading in chat:** a visible progress row while the assistant works ("Thinking…", then each step: "Looking up vehicles…", "Adding widget…"), elapsed time, and Stop. The composer shows a busy state. No silent waits.
- **Skeletons while a dashboard is generated:**
  - When a turn is changing the dashboard, the grid shows skeleton tiles where widgets are about to land, plus a "Building your dashboard…" banner.
  - New widgets fade in.
  - Each widget shows a skeleton until its first data arrives.
- **One chat entry point:** on `/dashboards/$id` the global "Ask FMS" button is hidden (the dock is the chat there). Elsewhere it stays.
- **Back button:** the dashboard page title bar gets "← Dashboards" (keeps the list's tab and filter), plus a breadcrumb on wide screens.
- **Dashboard list UI:**
  - search and sort (recent, name, widgets);
  - "My / Shared with me" tabs with counts;
  - richer cards (above) and a "Create with AI" hero with example prompts;
  - pinned or recent first;
  - a grid or list toggle, and skeletons while loading.
- **Retry for interrupted answers:**
  - Detect a stream that ends without `done`/`error` (network drop, provider cut, server timeout) and mark the reply "Interrupted", keeping the partial text.
  - Show **Retry**, which re-sends the same message. In a dashboard chat, changes the interrupted turn already made stay, are listed, and can still be undone.
  - The server sends a heartbeat comment every 15 s so proxies don't drop idle streams.
  - The server log records why a stream ended.

- **Added 2026-10-15 (user):**
  - **A rich new/empty dashboard page:**
    - a hero with the composer focused;
    - example prompt chips grouped by theme;
    - one-click starter templates;
    - ghost tiles in the background;
    - a one-line "ask → preview → add" explainer;
    - everything permission-filtered.
  - **Prompt suggestions as you type** in both chats:
    - up to 5 matching templates, with the match highlighted;
    - vehicle regno/VIN and fleet name completion;
    - keyboard and screen-reader friendly;
    - client-side, with no AI call per keystroke.

  - **No side chat on a new, empty dashboard** (no widgets, no messages):
    - full-width empty state with a centred composer;
    - the first prompt animates into the side dock, which slides in (about 300 ms, no motion with reduced-motion);
    - from then on the dashboard opens with the dock.
  - **Scroll fix on the dashboard screen** (user-reported bug).

## Out of scope
New widget types (F26), API keys (F25), caching (F24).

## Done when
- e2e: progress row visible during a turn; skeletons during a build; Ask FMS hidden on the dashboard page; back keeps the list state; list search and sort work; a forced stream cut shows Interrupted + Retry, and Retry completes.
