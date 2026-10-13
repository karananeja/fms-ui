// @vitest-environment node
import {
  combinfoSchema,
  fleetListSchema,
  lafparsedSchema,
  meSchema,
  moveVehiclesResultSchema,
} from '@shared/contract/index.ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SEED_USERS, startServer } from '../../../../mock-server/testing/harness.ts';
import { LiveTrackingEngine } from './live-tracking-engine.ts';
import type { LivePush } from './worker-api.ts';
import type { SocketLike } from './ws-client.ts';

type Server = Awaited<ReturnType<typeof startServer>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `check` until it holds; fails after `timeoutMs`. */
async function waitUntil(check: () => boolean, timeoutMs: number, what: string) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(20);
  }
}

const engines: LiveTrackingEngine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
});

/** Starts an engine against the in-process mock, signed in as `user`; taps every frame. */
async function startEngine(server: Server, user: { email: string; password: string }) {
  const cookie = await server.login(user);
  const me = (await server.api('GET', '/api/auth/me', { cookie, schema: meSchema })).body;
  const frames: { type: string; id?: string }[] = [];
  const pushes: LivePush[] = [];
  const engine = new LiveTrackingEngine({
    url: `${server.base.replace(/^http/, 'ws')}/ws/live`,
    createSocket: (url) => {
      const ws = new WebSocket(url, { headers: { cookie } });
      ws.on('message', (raw) => {
        const { type, id } = JSON.parse(raw.toString()) as { type: string; id?: string };
        frames.push({ type, id });
      });
      return ws as unknown as SocketLike;
    },
    random: () => 1,
  });
  engines.push(engine);
  engine.init(me, (p) => pushes.push(p));
  const payloads = (id: string) => frames.filter((f) => f.type === 'payload' && f.id === id).length;
  return { engine, me, cookie, frames, pushes, payloads };
}

const snapshotDone = (e: LiveTrackingEngine, count?: number) => () =>
  e.stats.snapshotComplete && (count === undefined || e.state.count === count);

function idsInScope(server: Server, fleetIds: string[]) {
  const { sim, tree } = server.ctx;
  const ids: string[] = [];
  for (let i = 0; i < sim.count; i++) {
    if (tree.inScope(sim.fleetId(i), fleetIds)) ids.push(sim.vehicleId(i));
  }
  return ids;
}

function expectNoDuplicates(e: LiveTrackingEngine) {
  const ids = e.state.str.vehicleId;
  expect(ids).toHaveLength(e.state.count);
  expect(new Set(ids).size).toBe(e.state.count);
  expect(e.state.byVehicle.size).toBe(e.state.count);
  expect(e.state.byDevice.size).toBe(e.state.count);
}

describe('engine vs in-process mock (2000 vehicles)', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(() => server.close());

  it('F04-T4: superadmin gets all 2000 vehicles joined with lafparsed, and deltas apply', async () => {
    const { engine } = await startEngine(server, SEED_USERS.superadmin);
    await waitUntil(snapshotDone(engine, 2000), 5000, 'snapshot of 2000');
    expect(engine.connection).toBe('live');
    expectNoDuplicates(engine);
    expect([...engine.state.str.vehicleId].sort()).toEqual(idsInScope(server, ['f0']).sort());
    const lafAt = engine.state.cols.lafparsedAt;
    await waitUntil(
      () => engine.state.count > 0 && !lafAt.subarray(0, engine.state.count).some(Number.isNaN),
      3000,
      'lafparsed joined for every vehicle',
    );
    const v = engine.state.version;
    await waitUntil(() => engine.state.version > v, 3000, 'a delta');
    expect(engine.state.count).toBe(2000);
    expect(engine.stats.stateBytes).toBeGreaterThan(0);
  }, 15_000);

  it('F04-T4: the viewer only gets its hub subtree', async () => {
    const { engine, cookie, me } = await startEngine(server, SEED_USERS.viewer);
    const fleets = (await server.api('GET', '/api/fleets', { cookie, schema: fleetListSchema }))
      .body;
    const hub = fleets.find((f) => f.id === me.fleetIds[0])!;
    expect(hub.vehicleCount).toBeGreaterThan(0);
    await waitUntil(snapshotDone(engine, hub.vehicleCount), 5000, 'viewer snapshot');
    expect([...engine.state.str.vehicleId].sort()).toEqual(idsInScope(server, me.fleetIds).sort());
  }, 15_000);

  it('F04-T5: reconnects, re-subscribes the selection and reconciles moves out of scope', async () => {
    const admin = await server.login(SEED_USERS.superadmin);
    const t = await startEngine(server, SEED_USERS.ops);
    const { engine, me } = t;
    await waitUntil(snapshotDone(engine), 5000, 'ops snapshot');
    const before = idsInScope(server, me.fleetIds);
    expect(engine.state.count).toBe(before.length);

    const south = (
      await server.api('GET', '/api/fleets', { cookie: admin, schema: fleetListSchema })
    ).body.find((f) => f.name === 'South')!;
    const moveOut = (vehicleId: string) =>
      server.api('POST', `/api/fleets/${south.id}/vehicles`, {
        cookie: admin,
        body: { vehicleIds: [vehicleId] },
        schema: moveVehiclesResultSchema,
      });

    const [selected, liveMoved, offlineMoved] = before;
    expect(engine.selectVehicle(selected!)).toBe(true);
    await waitUntil(() => t.payloads('sel-c-1') > 0, 3000, 'selection payload');

    // Live move: the leave delta removes the vehicle.
    await moveOut(liveMoved!);
    await waitUntil(() => engine.state.indexOf(liveMoved!) < 0, 3000, 'live removal');

    // Kill the socket server-side, then move a vehicle while the client is away.
    for (const c of server.app.websocketServer.clients) c.terminate();
    await moveOut(offlineMoved!);
    await waitUntil(() => engine.connection === 'reconnecting', 2000, 'reconnecting');
    await waitUntil(
      () => engine.stats.reconnects === 1 && engine.connection === 'live',
      3000,
      'reconnect',
    );
    await waitUntil(snapshotDone(engine), 5000, 'new snapshot');
    const after = idsInScope(server, me.fleetIds);
    expect(after).toHaveLength(before.length - 2);
    expect(engine.state.indexOf(offlineMoved!)).toBe(-1);
    expect(engine.state.count).toBe(after.length);
    expect([...engine.state.str.vehicleId].sort()).toEqual(after.sort());
    expectNoDuplicates(engine);
    await waitUntil(() => t.payloads('sel-c-2') > 0, 3000, 're-subscribed selection payload');
    await waitUntil(() => t.payloads('sel-l-2') > 0, 3000, 're-subscribed lafparsed payload');
  }, 15_000);
});

describe('selection payloads (1 s report interval)', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer({ vehicleIntervalMs: 1000 });
  });
  afterAll(() => server.close());

  it('F04-T6: selectVehicle delivers full payloads (374 PIDs); deselecting stops them', async () => {
    const t = await startEngine(server, SEED_USERS.superadmin);
    const { engine } = t;
    await waitUntil(snapshotDone(engine), 5000, 'snapshot');
    const id = engine.state.str.vehicleId[0]!;
    expect(engine.selectVehicle(id)).toBe(true);
    await waitUntil(
      () => t.pushes.some((p) => p.selected?.combinfo && p.selected.lafparsed),
      3000,
      'both payloads pushed',
    );
    const selected = t.pushes.findLast(
      (p) => p.selected?.combinfo && p.selected.lafparsed,
    )!.selected!;
    expect(selected.vehicleId).toBe(id);
    expect(combinfoSchema.parse(selected.combinfo).vehicleid).toBe(id);
    expect(Object.keys(lafparsedSchema.parse(selected.lafparsed).candata)).toHaveLength(374);
    await waitUntil(() => t.payloads('sel-c-1') >= 2, 4000, 'payload updates');

    expect(engine.selectVehicle(null)).toBe(true);
    await waitUntil(() => server.ctx.hub.subscriptionCount === 2, 2000, 'unsubscribed');
    await sleep(100);
    const n = t.payloads('sel-c-1') + t.payloads('sel-l-1');
    await sleep(2500);
    expect(t.payloads('sel-c-1') + t.payloads('sel-l-1')).toBe(n);
    expect(t.pushes.at(-1)!.connection).toBe('live');
  }, 15_000);
});
