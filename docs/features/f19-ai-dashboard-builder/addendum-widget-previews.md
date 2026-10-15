# F19/F20 Addendum — Widget previews in chat · Spec

**Status:** Approved in chat 2026-10-15 (user: "yes" to the recommendations). Decision **D-135** (Proposed).

## Behaviour
- **When to preview:** a request for **one widget** ("add a small KPI of running vehicles") shows a **preview card in the chat** instead of changing the dashboard.
- **When to add directly:** multi-widget builds ("build me a fleet health dashboard") and edits/removals of existing widgets still apply directly, as change chips with Undo (F19, unchanged).
- **The preview card** renders the widget **live, with real data** (as the viewer), using the F20 widget renderer at a chat-friendly size. Actions:
  - **Add to dashboard:** appends the widget at the first free spot. This is a normal owner save (PATCH with `version`, so 409 rules apply), recorded as a manual change.
  - **Drag onto the grid:** a dashboard page only. The card is draggable (HTML5 DnD), and the grid accepts it at the drop position (react-grid-layout `isDroppable` + `onDrop`, with a placeholder sized to the widget's default size).
  - **Ask to change:** pre-fills the composer with `Change the "<title>" preview: `.
  - **Discard:** hides the card.
- **The card's state** (`pending | added | discarded`) is saved for dashboard chats and survives a reload. An added card shows "Added ✓" and the Add button is disabled.
- **Global "Ask FMS" panel:** preview cards there have **Add to dashboard…**, which opens a picker of the user's own dashboards plus "New dashboard". Adding opens or offers that dashboard. Global previews live only for the panel session (the global chat has no server thread).
- **Permissions and limits:**
  - Viewers never see previews; the chat is owner-only.
  - The widget catalogue rules (zod, `widget_not_permitted`) are checked when the preview is made **and** again when it is added.
  - The 24-widget limit applies on add (`dashboard_limit` → toast).

## Contract (`shared/contract/assistant.ts`, `shared/contract/dashboards.ts`)
- **New tool `preview_widget`:**
  - Input: `{ dashboardId?: string, widget: <widget tool input, same as add_widget> }`. `dashboardId` is required in the dashboard chat (its own id) and optional in the global chat.
  - The tool validates the widget like `add_widget` but **does not mutate**.
  - It returns `{ previewId, widget }` (the widget gets a fresh id).
  - The system prompt (catalogue section) says: single-widget requests → `preview_widget`; multi-widget builds or edits → the mutating tools.
- **New SSE event:** `{ type: 'widget_preview', preview: WidgetPreview }`.
- **`WidgetPreview`:** `{ id, dashboardId: string | null, widget: Widget, size: { w, h }, status: 'pending' | 'added' | 'discarded', createdAt }`.
- **Thread storage:** `ThreadMessage` gains `previews: WidgetPreview[]` (default `[]`). DB migration 2 adds a `previews_json` column to `dashboard_messages`; existing rows read as `[]`.
- **New endpoint `PATCH /api/dashboards/:id/previews/:previewId`:**
  - Body: `{ status: 'added' | 'discarded' }`. Owner only, `dashboards.use`.
  - Returns 404 for an unknown preview, and 409 `chat_busy` while a turn runs.
  - It only records the card's state. Adding the widget itself is the client's PATCH of the dashboard.
- **Fake model:** a rule — a single-widget phrase ("add a … widget", "small …", "a kpi …") → `preview_widget` — plus a built-in `[fake:preview]`.

## Acceptance tests
| ID | Test |
|---|---|
| P-T1 | Contract: `preview_widget` validates like `add_widget` (bad widget → error result with paths; not-permitted → error); the dashboard is **not** changed and `version` is the same. |
| P-T2 | Contract: the dashboard chat stores previews on the assistant message; `GET …/thread` returns them; `PATCH …/previews/:id` sets the status; a viewer gets 403, a stranger 404; `chat_busy` returns 409. Migration 2 runs on an F18 DB file without loss. |
| P-T3 | Fake model: "add a small KPI of running vehicles" → `preview_widget`; "build me a fleet health dashboard" → mutating tools. The same through the OpenAI path (F21). |
| P-T4 | Component: the preview card renders the widget, Add calls the dashboard save + the preview PATCH and shows "Added ✓"; Discard hides it; Ask to change pre-fills the composer. |
| P-T5 | e2e (fake model, dashboard page): ask for a small widget → a preview card in the chat with data → **Add to dashboard** → a new grid item and "Added ✓"; a second preview **dragged onto the grid** lands at the drop spot; both persist after a reload, and the card states persist. |
| P-T6 | e2e (global panel): a preview → Add to dashboard… → pick a dashboard → the widget is on it. |

## Ownership (parallel agents, one branch)
- **Server agent:** `shared/contract/{assistant,dashboards}.ts`, `mock-server/**` (tool, prompt, event, migration, endpoint, fake rules, OpenAI-path parity), P-T1…T3.
- **Client agent:** `src/features/assistant/**`, `src/features/dashboards/**`, e2e P-T5/T6, P-T4. Builds against the shapes above.
