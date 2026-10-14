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
