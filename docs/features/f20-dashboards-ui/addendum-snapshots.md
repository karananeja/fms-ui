# F20 addendum — dashboard snapshots on list cards (D-142, "A+")

Status: implemented, tested (2026-10-16), awaiting UAT. Dependency: `modern-screenshot@4.7.0`
(published 2026-04-16, exact pin) in `lib/snapshot-capture.ts` only, which the lazy
`/dashboards/$id` page loads with a dynamic `import()` (its own `snapshot-capture-*` chunk).

## Contract (additive, `shared/contract/dashboards.ts`)
- `dashboardSnapshotSchema = { url: string, capturedAt: epochMs, theme: 'light' | 'dark' }`.
- `DashboardSummary.snapshot?: DashboardSnapshot | null` — the **current user's own** snapshot of
  that dashboard (owner and viewer alike); `null` until the first capture. Optional so older
  fixtures stay valid; the server always sends it.
- `url` = `/api/dashboards/:id/snapshot?v=<capturedAt>` (cache-busting; the image is immutable
  per `v`).
- Limits: `SNAPSHOT_MAX_BYTES = 120 * 1024` (server cap), client target ≤ 40 KB, ~640 px wide.

## Endpoints (`dashboards.use`; access = owner or shared viewer, else 404)
- `GET /api/dashboards/:id/snapshot` → `200` image bytes (`content-type` as stored,
  `cache-control: private, max-age=31536000, immutable`, headers `x-snapshot-captured-at`,
  `x-snapshot-theme`); `404 not_found` when the caller has none. `HEAD` gives the headers only
  (the capture hook uses it to decide whether a capture is due).
- `PUT /api/dashboards/:id/snapshot?theme=light|dark` — raw body, `content-type: image/webp` or
  `image/png` (anything else → `415`), > 120 KB → `413`, bytes that are not a WebP/PNG → `422
  validation_failed`. Replaces the caller's snapshot; `capturedAt` = server now. → `200
  DashboardSnapshot`.

## Schema (migration **v9** `dashboard_snapshots`; v8 belongs to F25)
```sql
CREATE TABLE dashboard_snapshots (
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  theme        TEXT NOT NULL CHECK (theme IN ('light','dark')),
  mime         TEXT NOT NULL,
  image        BLOB NOT NULL,
  captured_at  INTEGER NOT NULL,
  PRIMARY KEY (dashboard_id, user_id)
);
```
- Deleted with the dashboard (FK cascade); `revokeShare` deletes that viewer's row; dev reset
  (`wipeDatabase`) wipes the table. Store: `mock-server/store/dashboard-snapshots.ts`, owned by
  `Dashboards` (`dashboards.snapshots`), so no new context wiring.

## Capture rules (client, `src/features/dashboards/lib/snapshot-capture.ts` + `use-dashboard-snapshot.ts`)
- Only the grid element (`[data-testid="dashboard-grid"]`) is captured: no chat dock, title bar,
  toasts, menus or drag placeholder (`filter`). Nothing is captured for an empty dashboard.
- **Due** when: no snapshot (HEAD 404), or it is older than 10 min, or it was taken in the other
  theme, or the dashboard changed after it (`updatedAt > capturedAt`, covers in-session edits).
- **Ready** when: the tab is visible, no widget shows `data-state="loading"`, no build is running,
  nothing is being dragged/resized, and this held for two checks in a row (checks every 2 s).
  Then `requestIdleCallback` (timeout 3 s; `setTimeout` fallback) runs the capture.
- Encode: `domToCanvas` at scale 640/width → crop the top 640×400 → WebP q 0.8, 0.65, 0.5 until
  ≤ 40 KB (PNG fallback where WebP encoding is unsupported, still ≤ 120 KB) → PUT.
- One capture in flight per page; a failure is silent and retried no sooner than 60 s later.
- Maps: WebGL canvases are blank without `preserveDrawingBuffer`. A dashboard map widget calls
  `registerSnapshotMap(map)` (`lib/snapshot-canvas.ts`); at capture time each registered map is
  repainted and read with `map.getCanvas().toDataURL()` inside a one-off `render` handler, and that
  URL stands in for the canvas. The live-tracking map is untouched (no flag, no listener).

## Card (`dashboard-card.tsx`)
- With `snapshot`: an `<img>` (lazy, `alt=""`) over a blurred copy of the layout drawing; it
  fades in on load (blur-up). Caption "Snapshot · N min ago"; hover/focus zooms the image (1.04,
  reduced motion → none). Taken in the other theme → 55 % opacity + caption "(other theme)".
- Without one (or on image error): the F23 layout drawing as before.

## Tests
- **S-T1** (server) PUT then GET round-trips bytes, content-type, `x-snapshot-*` headers.
- **S-T2** (server) caps: 413 > 120 KB, 415 wrong type, 422 not an image or bad theme.
- **S-T3** (server) access: viewer can PUT/GET own; stranger 404; users never see another's.
- **S-T4** (server) list items carry `snapshot` for the caller only (`null` otherwise).
- **S-T5** (server) dashboard delete cascades; share revoke removes the viewer's row only.
- **S-T6** (server) migration v9 present, dev reset wipes `dashboard_snapshots`.
- **S-T7** (unit) `isSnapshotDue` rules (none / age / theme / changed) and `fitWebp` quality loop.
- **S-T8** (unit) card: snapshot image + caption + other-theme fade; layout fallback; img error.
- **S-T9** (e2e) open a dashboard → a snapshot is uploaded → the list card shows the image and
  "Snapshot · just now"; the image request excludes the chat dock (grid only).
