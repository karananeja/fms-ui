# F04 — Live Data Pipeline · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
This is the core of the module and the main scale risk. 1 lakh live vehicles (10 lakh headroom) must stream in without the UI stuttering.

## What
- **`live-tracking-worker.ts`** (Web Worker) starts as soon as the app shell loads. It does the following:
  - Opens the WS (cookie-authenticated).
  - Subscribes to fleet-scope `combinfo` and `lafparsed` for the user's permitted fleets.
  - Reconnects with exponential backoff and jitter, and re-subscribes on reconnect.
  - Stores fleet state as typed arrays (struct-of-arrays), joined on `deviceid`, and drops stale or out-of-order messages.
  - Hosts the search index, filter engine, cluster index, table queries and CSV export. F06–F09 plug into these.
  - Pushes batched change notifications to the main thread at **≤ 4 Hz**.
- **`live-tracking-store.ts`** (class, main thread) is the only place UI business logic lives:
  - It holds UI state: viewport, selection, filters, search text, table mode, connection state.
  - It forwards intents to the worker over Comlink.
  - It caches small results only.
  - It exposes `subscribe` / `getSnapshot` selectors for `useSyncExternalStore`.
- Selecting a vehicle adds a vehicle-scope subscription to its full payloads. Deselecting removes it.
- A connection indicator shows: connecting, live, reconnecting and offline.

## Out of scope
Rendering. That belongs to F06–F09.

## Done when
- Against the mock with 1 lakh vehicles, both of these hold:
  - There are no main-thread long tasks over 50 ms during the stream.
  - First data arrives in ≤ 2 s.
- Unit tests cover reconnect, ordering and the deviceid join.
- The store has no React imports and is unit-tested in isolation.
