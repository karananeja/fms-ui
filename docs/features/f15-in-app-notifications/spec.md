# F15 — In-App Notifications · Spec

| Field | Value |
|---|---|
| Status | **Draft: awaiting user sign-off** |
| Intent | `intent.md` (signed off 2026-10-14) |
| Server contract | F11: `GET /api/notifications`, `POST /api/notifications/read`, WS `events` (`kind:'notification'`), the 24 h no-GPS job, visibility rules (F11 §3). **No mock changes.** |
| Visual source of truth | DS1 tokens + Doto; the bell sits in the existing app header actions area; the panel uses the F07 card/sheet style; toasts reuse the app's existing toaster. No new look. |
| Delivery | One agent in the main checkout, branch `feature/f15-notifications`, ports 5373/4200, decisions **D-097…D-098**. Runs in parallel with F12. |

## 1. Files (kebab-case)
```
src/features/notifications/api/notifications-api.ts       list (cursor), mark read (ids | all)
src/features/notifications/notification-store.ts          class-based store (main thread): items, unread count, dedupe by id
src/features/notifications/events-socket.ts               shared main-thread client for WS `events` (also used by F13/F14 later)
src/features/notifications/components/notification-bell.tsx    bell + unread badge in the app header
src/features/notifications/components/notification-panel.tsx   popover (desktop) / sheet (mobile)
src/features/notifications/components/notification-item.tsx
src/features/notifications/notification-links.ts          kind → route (vehicle → /live-tracking?vehicle=; request → /requests/:id once F14 lands, the vehicle until then)
src/app/app-layout.tsx                                     mount bell (header, before page actions) — small edit only
```

## 2. Requirements
| ID | Requirement |
|---|---|
| F15-R1 | **Bell** in the app header for every signed-in staff user (not the Driver page). Unread badge: 1–99, "99+" above that. The `aria-label` gives the count ("Notifications, 3 unread"). |
| F15-R2 | **Panel:** opens from the bell as a 380 px popover on desktop or a full-height sheet on mobile. Newest first, with infinite scroll on the cursor. **Tabs:** All · Unread. **Each item:** severity icon/colour, title, body, relative time + IST on hover, unread dot. **Actions:** "Mark all read"; clicking an item marks it read and navigates (`notification-links.ts`). |
| F15-R3 | **Live:** `events-socket.ts` opens one WS `events` subscription after sign-in, with the user's fleet scope. New items are prepended, the badge is incremented and they're deduped by id. It reconnects with backoff, then re-syncs with `GET /api/notifications?unread`. Sign-out closes it. |
| F15-R4 | **Toasts** for `warning`/`critical` notifications that arrive while the app is open. At most 3 are visible at once and extra arrivals collapse into "+N more". They aren't shown for items loaded on page load. A toast's action opens the item. |
| F15-R5 | **Kinds (from F11):** `no-gps-24h` ("MH12AB1234 has had no GPS for 24 h", critical), `request-created` / `request-updated` (warning/info), `replacement-waiting` (warning). Unknown kinds render generically and are never dropped. |
| F15-R6 | **Read state:** "mark read" is optimistic and rolls back on error. Read state is per user (server) and syncs across tabs through the next WS/refresh. |
| F15-R7 | **Main thread stays light:** notifications are low volume, so they live in a small main-thread store, not the fleet worker (D-005 is unchanged). The `events-socket.ts` client is shared so F13/F14 can reuse it. |

## 3. Budgets
- The bell adds ≤ 5 kB gzip to the app shell. The panel is a lazy chunk.
- A new notification shows in the badge within 1 s of the server event. Opening the panel has no long task > 50 ms.

## 4. Tests
| ID | Type | Test |
|---|---|---|
| F15-T1 | unit | `notification-store`: prepend, dedupe, unread count, mark read (optimistic + rollback), cursor pagination merge. |
| F15-T2 | unit | `events-socket`: subscribe after auth, reconnect with backoff, re-sync on reconnect, close on sign-out (fake WS). |
| F15-T3 | component | Bell badge formatting and aria-label; panel tabs, mark all read, item click navigates; toast cap and "+N more". |
| F15-T4 | e2e (clock) | `notifications.clock.spec.ts`: move the mock clock past 24 h of no-GPS for an in-scope vehicle. The bell count rises and the critical toast appears; clicking it opens the vehicle. A Viewer whose scope doesn't contain the vehicle gets nothing. |
| F15-T5 | e2e | A request event created through the F11 API as the seed driver → the super admin sees `request-created` within 5 s; "Mark all read" clears the badge, and it stays cleared after a reload. |
| F15-T6 | e2e | UAT screenshots → `screenshots/`: bell with badge, panel (desktop), sheet (mobile), critical toast. |
| F15-T7 | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock) once at the end. Perf by the orchestrator. |

## 5. Decisions to propose
- **D-097:** notifications use a main-thread class store plus one shared `events-socket` (not the fleet worker), and are re-synced over REST after reconnect.
- **D-098:** the toast policy: warning/critical only, live arrivals only, max 3 + "+N more".

## 6. Out of scope
Email/SMS/push, per-user notification preferences or muting, notification sounds.
