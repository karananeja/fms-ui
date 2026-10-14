import type { EventKind, Notification } from '@shared/contract/index.ts';
import { vi } from 'vitest';
import type { EventHandler, EventsSocket, SyncHandler } from '../events-socket.ts';

/** A `no-gps-24h` notification `ntf-<id>` for vehicle `v<id>` (unread, critical). */
export const note = (id: number, over: Partial<Notification> = {}): Notification => ({
  id: `ntf-${id}`,
  kind: 'no-gps-24h',
  severity: 'critical',
  title: `MH12AB${String(id).padStart(4, '0')} has had no GPS for 24 hours`,
  body: 'No GPS fix for over 24 hours.',
  fleetId: 'f1',
  vehicleId: `v${id}`,
  createdAt: 1_760_000_000_000 + id * 1000,
  readAt: null,
  ...over,
});

/** A socket stand-in the test drives: `emit` a notification, `sync` a (re)subscribe. */
export function fakeEventsSocket() {
  const handlers = new Set<EventHandler<'notification'>>();
  const syncs = new Set<SyncHandler>();
  return {
    onEvent: vi.fn((_kind: EventKind, h: EventHandler<'notification'>) => {
      handlers.add(h);
      return () => void handlers.delete(h);
    }) as unknown as EventsSocket['onEvent'],
    onSync: vi.fn((h: SyncHandler) => {
      syncs.add(h);
      return () => void syncs.delete(h);
    }),
    now: () => 1_770_000_000_000,
    emit: (n: Notification) => handlers.forEach((h) => h(n)),
    sync: (reconnect: boolean) => syncs.forEach((h) => h({ reconnect })),
    get listeners() {
      return handlers.size + syncs.size;
    },
  };
}

