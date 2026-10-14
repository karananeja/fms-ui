# F03 — Conversation log

## 2026-10-14 — Contract commit (agent, worktree `../fms-ui-f03c`, branch `feature/f03-contract`)
**Done (spec §5):**
- `access/api/access-api.ts`: typed calls for every access endpoint + `accessKeys`.
- `access/permissions/can.ts` (`can`, `useCan`, `firstAllowedPath`, `ROUTE_PERMISSIONS`, `ADMIN_PERMISSIONS`); `require-permission.tsx` (`<RequirePermission p>`, a separate file because `can.ts` can't hold JSX).
- `admin-layout.tsx` (+ `AdminPlaceholder`), `no-access-page.tsx`; placeholder page files for `/admin`, fleets, users, invites, roles (lazy route chunks).
- Router: `staticData.permission` per signed-in route, checked by `AppLayout` with `<RequirePermission>`; `/` (now inside the app shell) and the post-sign-in default (`DEFAULT_REDIRECT`, accept invite, signed-in `/login`) go to the first allowed page.
- Nav filtered by `NavItem.permission`; live store `hasPermission` → `can` (R3). `table.view` gating not added (no existing check; F03b, R2).
- `FleetPickerProps` + placeholder select / checkbox list; `fakeMe()` now holds every permission (optional `permissions`), `sessionAs(status, api, me)`.

**Results:** check 562/562 (F03-T1: `can.test.tsx` 17, `nav-items.test.ts` 8, `app.test.tsx` +5), build clean, e2e setup + chromium 36/36.

## 2026-10-14 — F03a Fleets (agent, worktree `../fms-ui-f03a`, branch `feature/f03a-fleets`)
**Done (R4–R7, T2, T3, fleets share of T9/T10):**
- `fleets/fleet-tree-model.ts`: index from the flat list (children, heights, direct counts), visible rows (search keeps ancestors), blockers (depth 5, delete reasons, root fixed), optimistic `withMove`, `impliedBy`.
- `fleet-tree-store.ts` (class store, `accessKeys.fleets()`): load/refresh, expand/collapse/expand all, search, select; optimistic create/rename/move/delete, undone by the inverse on 409/422 with the server message toasted.
- `fleet-vehicles-store.ts`: direct vehicles (`limit: 100` cursor pages, stale pages dropped by `accessKeys.vehicles` key), checkbox / shift-range / select page, "Move to fleet…" → "Moved N vehicles" → tree refresh.
- `fleet-tree.tsx`: virtualised tree, tree ARIA pattern with `aria-activedescendant` (↑↓ Home End ← → Enter/Space F2 Shift+F10), depth guides, counts, ⋯ menu with disabled-with-reason items, inline rename (Enter saves, Esc cancels, blur saves).
- `fleet-vehicles.tsx`: 420 px `surface-solid` panel (bottom sheet on mobile), breadcrumbs, subtree/direct counts, debounced search, virtualised rows + infinite scroll, move dialog with the picker.
- `fleet-picker.tsx`: real searchable tree picker (single + multi, subtree implication); `FleetPickerProps` unchanged.
- Decisions D-080…D-082 (Proposed). No mock, router or contract changes.
- Note: port 4100 was held by a stale mock from `../fms-ui-f09h`, so this worktree ran with `MOCK_PORT=4101` (VITE_PORT 5273).

**Results:** see `test-report-f03a.md` — check 596/596, build clean, e2e setup + chromium 39/40 first run (F06-T6 camera timing flake, passes on re-run), fleets 4/4, budgets met.
## 2026-10-14 — F03b People (agent, worktree `../fms-ui-f03b`, branch `feature/f03b-people`, ports 5373/4200)
**Done (R1–R3 completion, R8–R14):**
- `people/users-page.tsx` (R8): glass table (name + "You", email, role, fleet scope "+N", status pill), search, role filter, Active/Disabled filter; row → side panel (420 px `surface-solid`, bottom sheet on mobile) with role, fleet scope (`FleetPicker` multi, ≥ 1) and status. Disable asks "Disable X? They will be signed out now." Own role and status are disabled with the reason; R12 hint for own scope.
- `people/invites-page.tsx` (R9): status filter with counts (default Pending), sent / expires as relative + IST, invited by; Invite user dialog (email, role, fleets ≥ 1; client validation; 409 on the email field, 422 mapped to fields); Resend for pending or expired; Revoke for pending with confirm.
- `people/roles-page.tsx` (R10): roles with permission count (`n / 11`) and user count; editor with Live · Vehicle · Table · Share · Admin groups from `PERMISSION_LABELS`; Super Admin read-only; `users.invite` / `roles.manage` locked for custom roles with "Only Super Admin can invite users or manage roles."; delete shows the server 409 in the panel.
- `components/admin-overview-page.tsx` (R11): Fleets / Users (active · disabled) / Pending invites / Roles cards, each only with its permission (and only then fetched).
- Shared: `components/admin-ui.tsx` (DataTable, AdminStatusPill on the extracted `TintPill`, SidePanel, Modal, ConfirmDialog, SelectField, FilterSelect, Segmented, LockedNote), `lib/use-resource.ts`, `lib/access-format.ts`, `people/permission-groups.ts`.
- Contract gaps: (a) `table.view` gates the table button and `?view=table`; (b) the live worker starts only with `live.view` (D-085).
- Mock (R14, the one change): roles reject `users.invite` / `roles.manage` for custom roles with 422 + field message (D-083). Expired invites were already resendable (derived status), no change.
- `fleets/*` untouched; the placeholder `FleetPicker` is used through `FleetPickerProps` (multi). e2e selects fleets by clicking the fleet name inside the "Fleet scope" group, which should survive F03a's tree if it renders the name as text.

**Decisions:** D-083…D-085 (Proposed). **Results:** see `test-report-f03b.md`.
