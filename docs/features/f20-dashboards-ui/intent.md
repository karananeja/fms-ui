# F20 — Dashboards Route & UI · Intent

**Status:** Signed off: 2026-10-15 (user)

## Why
Dashboards need their own home in the app: a list of them, a page for each one, and clear empty states.

## What
- **`/dashboards`** (nav item, `dashboards.use`):
  - two lists, "My dashboards" and "Shared with me";
  - each card shows the title, widget count, last updated time (IST), and a "shared" badge;
  - actions: open, rename, duplicate, share and delete (delete asks for confirmation).
- **Empty state** when there are no dashboards:
  - an illustration and the text "Ask FMS to build your first dashboard";
  - a prompt box and 3 example prompts;
  - a "Start blank" button.
- **`/dashboards/$id`:**
  - the widget grid (`react-grid-layout`: drag to move and resize, responsive breakpoints; read-only for shared viewers);
  - the dashboard's chat docked on the side, which can be collapsed;
  - a title bar with rename, share, duplicate, delete, refresh and last-saved status.
- **Widgets:**
  - built from the F16 SVG charts, KPI tiles and ranking tables;
  - each widget has a header (title, menu: edit title, remove, refresh), plus loading, empty and error states;
  - live fleet widgets update in real time through the Web Worker; analytics widgets refresh every 60 s and when you click refresh.
- **An empty dashboard** shows a "Ask FMS to add widgets" state inside the grid.
- **Share dialog:** pick users, see who already has access, and revoke.
- **Layout saving:** layout changes save automatically (debounced). On a 409 conflict, the page reloads with a notice.
- Works in both DS3 themes. The route is lazy-loaded, so the live-tracking bundle doesn't grow.

## Out of scope
Full-screen TV/kiosk mode, exporting a dashboard as PDF, dashboard folders and tags.

## Done when
- e2e passes for: the empty state, creating a dashboard from chat, drag and resize persisting after a reload, rename, duplicate, delete, share to a second user who sees it read-only, and revoke.
- The route chunk is reported in the test report, and existing perf budgets pass.
