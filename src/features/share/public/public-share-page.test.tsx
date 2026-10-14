import type { PublicShare } from '@shared/contract/share-links.ts';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicSharePage } from './public-share-page';
import { combinfo, fakeShareSockets } from './testing/fake-share-socket';

const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);

function share(over: Partial<PublicShare['options']> = {}, expiresAt = NOW + 5 * 3600_000) {
  return {
    vehicleId: 'v_in_1',
    vehicle: {
      regno: 'KA01AB1234',
      make: 'Tata',
      model: 'Nexon EV',
      variant: 'LR',
      fuelType: 'EV',
    },
    options: {
      show: { drivingEnergy: false, device: false },
      trail: { enabled: false, windowMinutes: 60 },
      ...over,
    },
    expiresAt,
  } satisfies PublicShare;
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const hit = routes[url];
      return hit ? hit() : json(404, { error: { code: 'not_found', message: 'nope' } });
    }),
  );
  return calls;
}

async function renderPage(body: PublicShare) {
  const fake = fakeShareSockets();
  const calls = stubFetch({
    '/api/public/share/tok': () => json(200, body),
    '/api/public/share/tok/trail': () =>
      json(200, {
        points: [
          [77.5, 12.9, NOW - 120_000],
          [77.51, 12.91, NOW - 60_000],
        ],
      }),
  });
  render(
    <PublicSharePage
      token="tok"
      socketOptions={{ createSocket: fake.create, silenceTimeoutMs: 600_000 }}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { ...fake, calls };
}

const pushPayload = (s: ReturnType<typeof fakeShareSockets>['sockets'][number], data: unknown) =>
  act(() => s.push({ type: 'payload', id: 'share', topic: 'combinfo', data }));

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('F10-T4: public share page', () => {
  it('404 → "Link not found"; 410 → "no longer available" (no app links)', async () => {
    stubFetch({});
    const { unmount } = render(<PublicSharePage token="missing" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('heading', { name: 'Link not found' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    unmount();

    stubFetch({
      '/api/public/share/old': () => json(410, { error: { code: 'gone', message: 'gone' } }),
    });
    render(<PublicSharePage token="old" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByRole('heading', { name: 'This link is no longer available' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('share-page')).toHaveAttribute('data-theme', 'share-light');
  });

  it('location-only: hidden groups render nothing, no trail request, combinfo only', async () => {
    const { sockets, calls } = await renderPage(share());
    const s = sockets[0]!;
    act(() => s.open());
    await pushPayload(s, combinfo(NOW - 5000));

    expect(screen.getByTestId('share-regno')).toHaveTextContent('KA01AB1234');
    expect(screen.getByTestId('share-model')).toHaveTextContent('Tata · Nexon EV');
    expect(screen.getByTestId('share-live-pill')).toHaveTextContent(/live/i);
    expect(screen.getByTestId('share-expiry')).toHaveTextContent(
      'Link expires in 5 h · 14 Oct, 4:30 pm IST',
    );
    expect(screen.getByTestId('share-group-location')).toBeInTheDocument();
    expect(screen.getByTestId('share-metric-ignition')).toHaveTextContent('On');
    expect(screen.queryByTestId('share-group-driving')).toBeNull();
    expect(screen.queryByTestId('share-group-device')).toBeNull();
    for (const label of [/speed/i, /soc/i, /range/i, /odometer/i, /signal/i, /battery/i])
      expect(screen.queryByText(label)).toBeNull();
    expect(calls).toEqual(['/api/public/share/tok']);
    expect(s.sent).toEqual([expect.objectContaining({ topic: 'combinfo' })]);
  });

  it('all data + trail: metric groups shown and the trail fetched once', async () => {
    const { sockets, calls } = await renderPage(
      share({
        show: { drivingEnergy: true, device: true },
        trail: { enabled: true, windowMinutes: 60 },
      }),
    );
    const s = sockets[0]!;
    act(() => s.open());
    await pushPayload(
      s,
      combinfo(NOW - 5000, {
        speed: 42.4,
        rxdbm: -72,
        devbattery: 3.912,
        carbattery: 12.61,
        parsedcandata: {
          soc: { pidvalue: 81, valtype: 0, timestamp: NOW },
          dte: { pidvalue: 143, valtype: 0, timestamp: NOW },
          odometer: { pidvalue: 12345, valtype: 0, timestamp: NOW },
        },
      }),
    );
    expect(screen.getByTestId('share-metric-speed')).toHaveTextContent('42 km/h');
    expect(screen.getByTestId('share-metric-soc')).toHaveTextContent('81%');
    expect(screen.getByTestId('share-metric-range')).toHaveTextContent('143 km');
    expect(screen.getByTestId('share-metric-odometer')).toHaveTextContent('12,345 km');
    expect(screen.getByTestId('share-metric-signal')).toHaveTextContent('-72 dBm');
    expect(screen.getByTestId('share-metric-device-battery')).toHaveTextContent('3.91 V');
    expect(screen.getByTestId('share-metric-car-battery')).toHaveTextContent('12.6 V');
    expect(screen.getByTestId('share-metric-motion')).toHaveTextContent('Moving');
    expect(calls.filter((c) => c.endsWith('/trail'))).toHaveLength(1);
  });

  it('a 4410 close while open switches to the unavailable screen', async () => {
    const { sockets } = await renderPage(share());
    act(() => sockets[0]!.open());
    act(() => sockets[0]!.serverClose(4410));
    expect(
      screen.getByRole('heading', { name: 'This link is no longer available' }),
    ).toBeInTheDocument();
  });

  it('reaching expiresAt locally shows the unavailable screen; stale data shows "Last update"', async () => {
    const { sockets } = await renderPage(share({}, NOW + 3 * 60_000));
    const s = sockets[0]!;
    act(() => s.open());
    await pushPayload(s, combinfo(NOW - 5000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 10_000);
    });
    expect(screen.getByTestId('share-live-pill')).toHaveTextContent(/last update 2 min ago/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      screen.getByRole('heading', { name: 'This link is no longer available' }),
    ).toBeInTheDocument();
    expect(s.closed).toBe(true);
  });
});
