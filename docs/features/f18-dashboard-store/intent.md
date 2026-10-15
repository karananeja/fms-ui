# F18 — Dashboard Store & Contract · Intent

**Status:** Signed off: 2026-10-15 (user)

## Why
Dashboards built with the assistant must be saved, reopened, edited, shared and continued later. Today all mock-server data is in memory, so it is lost on restart.

## What
- **Database:** Node 24's built-in `node:sqlite`, in a git-ignored file `mock-server/data/fms.db`. Tests use an in-memory database. Schema migrations are versioned. No new dependency.
- **Dashboards:**
  - Each dashboard has an id, an owner, a title, a description, widgets (a typed spec), a layout (`react-grid-layout` items for each breakpoint), and created/updated times.
  - A user can have many dashboards (a soft limit of 50).
- **API:** create, list (mine and shared with me), get, update (title, widgets, layout), duplicate and delete.
- **Concurrency:** each dashboard has a `version` number, so a save based on an old version is rejected (409) instead of overwriting newer changes.
- **Chat thread for each dashboard:**
  - The text turns, tool chips and the change each assistant turn made are stored with the dashboard, so the chat can be resumed (used by F19).
  - Deleting a dashboard deletes its thread.
- **Sharing (view only):**
  - The owner shares a dashboard with other app users, picked from the users they can see, and can revoke access.
  - Shared users can open the dashboard but can't edit it, chat in it or reshare it. They can duplicate it into their own dashboards.
  - Each widget's data is always fetched **as the viewer**, so a shared dashboard never shows vehicles outside the viewer's fleets.
- **Widget catalogue (zod, `shared/contract/dashboards.ts`):** a fixed list of widget types, each with typed settings and a data source taken from existing APIs:
  - KPI tile;
  - daily chart (bar, line or area);
  - status breakdown;
  - ranking table;
  - vehicle list or driver list (with filters);
  - requests summary;
  - text note.
- **Validation:** the server rejects any widget that doesn't match the catalogue. The AI never sends code.
- **Permission:** a new `dashboards.use` permission, given to the roles that already have `chat.use`. Only the owner can edit a dashboard.

## Out of scope
Public (signed-out) dashboard links, edit sharing, version history and undo beyond the last change, moving the other in-memory stores to SQLite.

## Done when
- The CRUD, share, revoke, 409 conflict and scope tests pass, including a test where a viewer with fewer fleets sees only their own data.
- Dashboards and threads survive a mock-server restart.
