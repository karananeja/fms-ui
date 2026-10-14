import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicSharePage } from './public-share-page';

/** Token of a `/share/:token` path, or `null` for any other path. */
export function shareToken(pathname: string): string | null {
  const m = /^\/share\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

/** F10-R8 / D-089: the public page's own boot (no router, session or live-tracking code). */
export function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <PublicSharePage token={shareToken(location.pathname) ?? ''} />
    </StrictMode>,
  );
}
