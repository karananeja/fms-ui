import type { Notification } from '@shared/contract/index.ts';
import { apiFetch } from '@/shared/api/api-client';

/** `GET /api/notifications` (F11): newest first, only what the caller may see. */
export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationsApi {
  list(opts?: { unread?: boolean; cursor?: string; limit?: number }): Promise<NotificationPage>;
  markRead(body: { ids: string[] } | { all: true }): Promise<{ unreadCount: number }>;
}

export const PAGE_SIZE = 50;

export const httpNotificationsApi: NotificationsApi = {
  list: ({ unread, cursor, limit = PAGE_SIZE } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (unread) q.set('unread', 'true');
    if (cursor) q.set('cursor', cursor);
    return apiFetch<NotificationPage>(`/api/notifications?${q}`);
  },
  markRead: (body) => apiFetch<{ unreadCount: number }>('/api/notifications/read', { body }),
};
