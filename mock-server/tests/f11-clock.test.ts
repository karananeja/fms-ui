// @vitest-environment node
import { clockSchema, notificationListSchema } from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERSONA } from '../generator/vehicle-sim.ts';
import { NO_GPS_ALERT_MS } from '../store/notifications.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

const MIN = 60_000;
let server: Awaited<ReturnType<typeof startServer>>;
let admin: string;
let viewer: string;

beforeAll(async () => {
  server = await startServer();
  admin = await server.login(SEED_USERS.superadmin);
  viewer = await server.login(SEED_USERS.viewer);
});
afterAll(() => server.close());

const alertsFor = async (cookie: string, vehicleId: string) => {
  const res = await server.api('GET', '/api/notifications?limit=200', {
    cookie,
    schema: notificationListSchema,
  });
  if (res.status !== 200)
    throw new Error(`notifications ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.items.filter((n) => n.kind === 'no-gps-24h' && n.vehicleId === vehicleId);
};
/** Moves the mock clock; sessions expire with it, so sign in again. */
const setClock = async (offsetMs: number) => {
  await server.api('POST', '/api/dev/clock', { body: { offsetMs }, schema: clockSchema });
  admin = await server.login(SEED_USERS.superadmin);
  viewer = await server.login(SEED_USERS.viewer);
};

describe('F11-T7 24 h no-GPS job (mock clock, D-038)', () => {
  it('fires exactly one alert per episode when the clock crosses 24 h, only for in-scope live.view users', async () => {
    const { sim, tree, clock, accounts } = server.ctx;
    const now = clock.now();
    const viewerFleets = accounts.user('u-viewer').fleetIds;
    // A no-GPS vehicle under 24 h old, outside the Viewer's fleets, whose episode is still the
    // same one when it crosses 24 h (most episodes restart every 3–20 h and never get there).
    const crossesAt = (k: number) => sim.noGpsSince(k, now) + NO_GPS_ALERT_MS + 2 * MIN;
    const i = [...Array(sim.count).keys()].find(
      (k) =>
        sim.persona[k] === PERSONA.noGps &&
        now - sim.noGpsSince(k, now) < NO_GPS_ALERT_MS - 10 * MIN &&
        sim.noGpsSince(k, crossesAt(k) + 30 * MIN) === sim.noGpsSince(k, now) &&
        !tree.inScope(sim.fleetId(k), viewerFleets),
    )!;
    expect(i).toBeGreaterThanOrEqual(0);
    const vehicleId = sim.vehicleId(i);
    const age = now - sim.noGpsSince(i, now);
    expect(await alertsFor(admin, vehicleId)).toHaveLength(0);

    await setClock(NO_GPS_ALERT_MS - age + 2 * MIN);
    const fired = await alertsFor(admin, vehicleId);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.severity).toBe('critical');

    await setClock(NO_GPS_ALERT_MS - age + 30 * MIN);
    expect(await alertsFor(admin, vehicleId)).toHaveLength(1);
    expect(await alertsFor(viewer, vehicleId)).toHaveLength(0);
    await setClock(0);
  });
});
