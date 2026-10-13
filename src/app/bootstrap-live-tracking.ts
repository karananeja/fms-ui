import type { Me } from '@shared/contract/index.ts';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';

declare global {
  interface Window {
    __fmsLive?: typeof liveTrackingStore.metrics;
  }
}

/** Gets the session and starts the live-tracking worker as soon as the app has loaded. */
export async function bootstrapLiveTracking(): Promise<void> {
  if (import.meta.env.DEV) window.__fmsLive = liveTrackingStore.metrics;
  let res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401 && import.meta.env.DEV) {
    const { devSignIn } = await import('./dev-session');
    res = await devSignIn();
  }
  if (!res.ok) return;
  liveTrackingStore.start((await res.json()) as Me);
}
