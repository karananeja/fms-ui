import type { DashboardSummary } from '@shared/contract/dashboards.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardCard, type ListView } from './components/dashboard-card';
import { freezeMapCanvases, registerSnapshotMap } from './lib/snapshot-canvas';
import {
  fitEncoded,
  gridReady,
  isSnapshotDue,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_TARGET_BYTES,
  snapshotAgeText,
} from './lib/snapshot-rules';

const NOW = Date.UTC(2026, 9, 16, 6, 0);
const blob = (size: number, type = 'image/webp') => new Blob([new Uint8Array(size)], { type });

describe('S-T7: capture rules', () => {
  const ctx = { now: NOW, theme: 'dark' as const, updatedAt: NOW - 60_000 };
  it('is due with none, when old, in the other theme or after a change', () => {
    expect(isSnapshotDue(null, ctx)).toBe(true);
    expect(isSnapshotDue({ capturedAt: NOW - 1000, theme: 'dark' }, ctx)).toBe(false);
    expect(isSnapshotDue({ capturedAt: NOW - SNAPSHOT_MAX_AGE_MS - 1, theme: 'dark' }, ctx)).toBe(
      true,
    );
    expect(isSnapshotDue({ capturedAt: NOW - 1000, theme: 'light' }, ctx)).toBe(true);
    expect(isSnapshotDue({ capturedAt: NOW - 120_000, theme: 'dark' }, ctx)).toBe(true);
  });

  it('lowers WebP quality until ≤ 40 KB, falls back to PNG, gives up over the cap', async () => {
    const asked: number[] = [];
    const sizes = [90_000, 60_000, SNAPSHOT_TARGET_BYTES - 1];
    const fit = await fitEncoded(async (_t, q) => {
      asked.push(q!);
      return blob(sizes[asked.length - 1]!);
    });
    expect(asked).toEqual([0.8, 0.65, 0.5]);
    expect(fit!.size).toBe(SNAPSHOT_TARGET_BYTES - 1);
    // Never small enough for the target but under the cap: the smallest one.
    expect((await fitEncoded(async (_t, q) => blob(Math.round(q! * 100_000))))!.size).toBe(35_000);
    // No WebP encoder: the PNG it returned, when under the cap.
    expect((await fitEncoded(async () => blob(50_000, 'image/png')))!.type).toBe('image/png');
    expect(await fitEncoded(async () => blob(500_000, 'image/png'))).toBeNull();
    expect(await fitEncoded(async () => blob(200_000))).toBeNull();
  });

  it('formats the age', () => {
    expect(snapshotAgeText(NOW - 10_000, NOW)).toBe('just now');
    expect(snapshotAgeText(NOW - 7 * 60_000, NOW)).toBe('7 min ago');
    expect(snapshotAgeText(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
  });

  it('waits for loading widgets and drags', () => {
    const grid = document.createElement('div');
    expect(gridReady(grid)).toBe(false);
    grid.innerHTML = '<div data-testid="widget"><div data-testid="widget-state" data-state="loading"></div></div>';
    expect(gridReady(grid)).toBe(false);
    grid.innerHTML = '<div data-testid="widget"><p>42</p></div>';
    expect(gridReady(grid)).toBe(true);
    grid.innerHTML += '<div class="react-grid-placeholder"></div>';
    expect(gridReady(grid)).toBe(false);
  });

  it('a registered map stands in its rendered frame for toDataURL, then restores it', async () => {
    const root = document.createElement('div');
    const canvas = document.createElement('canvas');
    root.append(canvas);
    let onRender: (() => void) | null = null;
    const unregister = registerSnapshotMap({
      getCanvas: () => canvas,
      once: (_t, fn) => (onRender = fn),
      triggerRepaint: () => {
        canvas.toDataURL = () => 'data:image/png;base64,FRAME';
        onRender?.();
      },
    });
    const restore = await freezeMapCanvases(root);
    expect(canvas.toDataURL()).toBe('data:image/png;base64,FRAME');
    restore();
    expect(Object.hasOwn(canvas, 'toDataURL')).toBe(false);
    unregister();
  });
});

const summary = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  id: 'dash-1',
  ownerId: 'u-ops',
  ownerName: 'Ops User',
  title: 'Fleet board',
  description: '',
  widgetCount: 2,
  version: 3,
  updatedAt: NOW - 3_600_000,
  access: 'owner',
  shareCount: 0,
  snapshot: null,
  ...over,
});

async function renderCard(d: DashboardSummary, view: ListView = 'grid') {
  const root = createRootRoute({ component: () => <Outlet /> });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <ul>
        <DashboardCard d={d} now={NOW} onAction={() => {}} view={view} />
      </ul>
    ),
  });
  const page = createRoute({ getParentRoute: () => root, path: 'dashboards/$id' });
  const router = createRouter({
    routeTree: root.addChildren([home, page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByTestId('dashboard-card');
}

describe('S-T8: card snapshot', () => {
  it('shows the layout drawing until the first capture', async () => {
    await renderCard(summary());
    expect(screen.getByTestId('card-thumbnail')).toBeInTheDocument();
    expect(screen.queryByTestId('card-snapshot')).toBeNull();
  });

  it('shows the snapshot with blur-up and its age; faded in the other theme', async () => {
    const url = `/api/dashboards/dash-1/snapshot?v=${NOW - 5 * 60_000}`;
    await renderCard(summary({ snapshot: { url, capturedAt: NOW - 5 * 60_000, theme: 'light' } }));
    const img = screen.getByTestId('card-snapshot-img');
    expect(img).toHaveAttribute('src', url);
    expect(img.className).toContain('opacity-0');
    fireEvent.load(img);
    expect(img.className).toContain('opacity-55');
    expect(screen.getByTestId('card-snapshot')).toHaveAttribute('data-theme-match', 'false');
    expect(screen.getByTestId('card-snapshot-age')).toHaveTextContent(
      'Snapshot · 5 min ago (other theme)',
    );
  });

  it('same theme: full opacity; a broken image falls back to the drawing', async () => {
    const url = `/api/dashboards/dash-1/snapshot?v=${NOW}`;
    await renderCard(summary({ snapshot: { url, capturedAt: NOW, theme: 'dark' } }));
    const img = screen.getByTestId('card-snapshot-img');
    fireEvent.load(img);
    expect(img.className).toContain('opacity-100');
    expect(screen.getByTestId('card-snapshot-age')).toHaveTextContent('Snapshot · just now');
    fireEvent.error(img);
    expect(screen.queryByTestId('card-snapshot')).toBeNull();
    expect(screen.getByTestId('card-thumbnail')).toBeInTheDocument();
  });

  it('list rows show the image without the caption', async () => {
    const url = `/api/dashboards/dash-1/snapshot?v=${NOW}`;
    await renderCard(summary({ snapshot: { url, capturedAt: NOW, theme: 'dark' } }), 'list');
    expect(screen.getByTestId('card-snapshot-img')).toBeInTheDocument();
    expect(screen.queryByTestId('card-snapshot-age')).toBeNull();
  });
});
