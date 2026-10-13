// @vitest-environment node
import { publicTrailSchema } from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERSONA } from '../generator/vehicle-sim.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let cookie: string;
let inScope: string;
let outOfScope: string;

beforeAll(async () => {
  server = await startServer();
  cookie = await server.login(SEED_USERS.ops);
  const { sim, tree } = server.ctx;
  const ids = [...Array(sim.count).keys()];
  inScope = sim.vehicleId(
    ids.find((k) => sim.persona[k] === PERSONA.normal && tree.inScope(sim.fleetId(k), ['f1']))!,
  );
  outOfScope = sim.vehicleId(ids.find((k) => !tree.inScope(sim.fleetId(k), ['f1']))!);
});
afterAll(() => server.close());

describe('F07-T7: GET /api/vehicles/:id/trail', () => {
  it('returns about 60 min of points for an in-scope vehicle, oldest first', async () => {
    const res = await server.api('GET', `/api/vehicles/${inScope}/trail?minutes=60`, {
      cookie,
      schema: publicTrailSchema,
    });
    expect(res.status).toBe(200);
    const ts = res.body.points.map((p) => p[2]);
    expect(ts.length).toBeGreaterThan(5);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    const span = ts.at(-1)! - ts[0]!;
    expect(span).toBeGreaterThan(45 * 60_000);
    expect(span).toBeLessThanOrEqual(60 * 60_000);
  });

  it('403 out of scope, 401 without a session', async () => {
    expect((await server.api('GET', `/api/vehicles/${outOfScope}/trail`, { cookie })).status).toBe(
      403,
    );
    expect((await server.api('GET', `/api/vehicles/${inScope}/trail`)).status).toBe(401);
  });
});
