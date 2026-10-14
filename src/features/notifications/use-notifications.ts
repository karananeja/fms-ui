import { createContext, use, useSyncExternalStore } from 'react';
import {
  notificationStore,
  type NotificationState,
  type NotificationStore,
} from './notification-store.ts';

/** The app uses the singleton; component tests provide their own store. */
export const NotificationStoreContext = createContext<NotificationStore>(notificationStore);

export const useNotificationStore = (): NotificationStore => use(NotificationStoreContext);

/** Subscribes to one slice of the notification state (a primitive or a stable reference). */
export function useNotifications<T>(selector: (s: NotificationState) => T): T {
  const store = useNotificationStore();
  const get = () => selector(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, get, get);
}

/** F15-R1: "1"…"99", then "99+"; `null` hides the badge. */
export function formatBadge(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

export function bellLabel(unread: number): string {
  return unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
}
