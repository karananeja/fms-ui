import type { Assignment } from '@shared/contract/index.ts';
import { useEffect, useRef } from 'react';
import { eventsSocket } from '@/features/notifications/events-socket';

/**
 * F12-R5/R6: WS `events` → `assignment` events on the main thread (low volume, D-093), over the
 * shared F15 `eventsSocket` (D-097). Local echoes (`emitAssignment`) reach the same listeners.
 */

export type AssignmentListener = (a: Assignment) => void;

const listeners = new Set<AssignmentListener>();
let offSocket: (() => void) | null = null;

/** Delivers one assignment to every listener (server events and local echoes alike). */
function dispatch(a: Assignment): void {
  for (const l of [...listeners]) {
    try {
      l(a);
    } catch {
      // one listener must not break the others
    }
  }
}

/** Listens to assignment events; the socket subscription lives while any listener does. */
export function subscribeAssignmentEvents(listener: AssignmentListener): () => void {
  listeners.add(listener);
  offSocket ??= eventsSocket.onEvent('assignment', dispatch);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      offSocket?.();
      offSocket = null;
    }
  };
}

/** Local echo after this tab's own mutation, so every view updates before the server event. */
export const emitAssignment = (a: Assignment) => dispatch(a);

/** `subscribeAssignmentEvents` for a component; `listener` may change between renders. */
export function useAssignmentEvents(listener: AssignmentListener, enabled = true): void {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribeAssignmentEvents((a) => ref.current(a));
  }, [enabled]);
}
