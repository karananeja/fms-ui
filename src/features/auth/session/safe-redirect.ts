export const DEFAULT_REDIRECT = '/live-tracking';

/** Screens that must never be a post-sign-in target. */
export const AUTH_PATHS = ['/login', '/forgot-password', '/reset-password', '/accept-invite'];

const ORIGIN = 'http://fms.invalid';

/**
 * F02-R5: a same-origin relative path (single leading `/`, no scheme, not an auth screen);
 * anything else becomes `/live-tracking`.
 */
export function safeRedirect(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || /^\/[/\\]/.test(raw)) {
    return DEFAULT_REDIRECT;
  }
  // Browsers strip tabs/newlines from URLs, so `/\t/evil.com` would become `//evil.com`.
  if (raw.includes('\\') || [...raw].some((c) => c.charCodeAt(0) < 0x20)) return DEFAULT_REDIRECT;
  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (url.origin !== ORIGIN) return DEFAULT_REDIRECT;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return DEFAULT_REDIRECT;
  return url.pathname + url.search + url.hash;
}
