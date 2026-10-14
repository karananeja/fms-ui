import { describe, expect, it } from 'vitest';
import { DEFAULT_REDIRECT, safeRedirect } from './safe-redirect.ts';

describe('F02-T2: safeRedirect', () => {
  it.each(['/live-tracking?vehicle=x', '/live-tracking?view=table', '/admin', '/admin/users#top'])(
    'allows %s',
    (path) => expect(safeRedirect(path)).toBe(path),
  );

  it.each([
    '//evil.com',
    '//evil.com/live-tracking',
    '/\\evil.com',
    '/\t/evil.com',
    'https://evil.com',
    'http://localhost/live-tracking',
    'javascript:alert(1)',
    'live-tracking',
    '/login',
    '/login?redirect=/admin',
    '/login/',
    '/forgot-password',
    '/reset-password?token=x',
    '/accept-invite?token=x',
    '',
    undefined,
    null,
    42,
  ])('rejects %j', (value) => expect(safeRedirect(value)).toBe(DEFAULT_REDIRECT));
});
