// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../build-server.ts';
import { SEED_USERS } from '../testing/harness.ts';

/** F11-T8: spec §7 budgets at 1 lakh vehicles (in-process, `app.inject`). Best of 3 runs. */
const DAY = 86_400_000;
let app: ReturnType<typeof buildServer>;
let cookie: string;
let buildMs: number;

beforeAll(async () => {
  const t = performance.now();
  app = buildServer({ vehicles: 100_000 });
  await app.ready();
  buildMs = performance.now() - t;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: SEED_USERS.superadmin,
  });
  cookie = res.cookies.find((c) => c.name === 'fms_sid')!.value;
}, 60_000);
afterAll(() => app.close());

const best = async (fn: () => Promise<unknown> | unknown, runs = 3) => {
  let min = Infinity;
  for (let k = 0; k < runs; k++) {
    const t = performance.now();
    await fn();
    min = Math.min(min, performance.now() - t);
  }
  return min;
};
const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, cookies: { fms_sid: cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return res;
};
const report = (name: string, ms: number) =>
  process.stdout.write(`\n[F11-T8] ${name}: ${ms.toFixed(1)} ms`);

describe('F11-T8 budgets (spec §7)', () => {
  it('analytics summary for the root fleet: 30 d ≤ 500 ms, 90 d ≤ 1.2 s', async () => {
    const now = app.mock.clock.now();
    const d30 = await best(() => get(`/api/analytics/summary?from=${now - 30 * DAY}&to=${now}`));
    const d90 = await best(() => get(`/api/analytics/summary?from=${now - 90 * DAY}&to=${now}`));
    report('summary root 30 d', d30);
    report('summary root 90 d', d90);
    expect(d30).toBeLessThanOrEqual(500);
    expect(d90).toBeLessThanOrEqual(1200);
  }, 60_000);

  it('analytics summary for one fleet (≤ 5 k vehicles), 90 d ≤ 100 ms', async () => {
    const { tree, sim } = app.mock;
    // A fleet query covers the whole subtree: pick the largest subtree with ≤ 5 k vehicles.
    const subtree = (id: string) => {
      const mask = tree.scopeMask([id]);
      let n = 0;
      for (let i = 0; i < sim.count; i++) if (mask[sim.fleet[i]!]) n++;
      return n;
    };
    const [fleetId, size] = [...tree.byId.values()]
      .map((f) => [f.id, subtree(f.id)] as const)
      .filter(([, n]) => n > 0 && n <= 5000)
      .sort((a, b) => b[1] - a[1])[0]!;
    const now = app.mock.clock.now();
    const ms = await best(() =>
      get(`/api/analytics/summary?fleetId=${fleetId}&from=${now - 90 * DAY}&to=${now}`),
    );
    report(`summary ${fleetId} (${size} vehicles) 90 d`, ms);
    expect(ms).toBeLessThanOrEqual(100);
  }, 30_000);

  it('replacement suggestions ≤ 50 ms', async () => {
    const { drivers, requests } = app.mock;
    let d = 0;
    while (drivers.vehicleOf(d) < 0) d++;
    const r = requests.create(d, { type: 'replacement', note: '' }, 'perf');
    const ms = await best(() => get(`/api/requests/${r.id}/suggestions`));
    report('suggestions', ms);
    expect(ms).toBeLessThanOrEqual(50);
  });

  it('24 h no-GPS job tick ≤ 20 ms', async () => {
    const ms = await best(() => app.mock.notifications.tick());
    report('no-GPS tick', ms);
    expect(ms).toBeLessThanOrEqual(20);
  });

  it('mock start-up stays within budget (F11 adds ≤ 300 ms)', () => {
    report('build + ready (1 lakh, incl. F11)', buildMs);
    // The pre-F11 server built 1 lakh vehicles in well under 1 s; F11 must not push it past ~1.5 s.
    expect(buildMs).toBeLessThanOrEqual(1500);
  });
});
