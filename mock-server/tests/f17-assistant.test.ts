// @vitest-environment node
import { chatEventSchema, type ChatEvent, type ReportDescriptor } from '@shared/contract/index.ts';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requestPrefix, toApiMessages } from '../assistant/assistant-runner.ts';
import {
  buildTools,
  toolDefinitions,
  TOOL_NAMES,
  type ToolHost,
} from '../assistant/assistant-tools.ts';
import { ReportStore } from '../assistant/reports.ts';
import { SYSTEM_PROMPT } from '../assistant/system-prompt.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

process.env.FMS_ASSISTANT_FAKE = '1';

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
});
afterAll(() => server.close());

const userOf = (k: 'ops' | 'superadmin' | 'viewer' | 'driver') =>
  server.ctx.accounts.user(`u-${k}`);

/** A vehicle inside (or outside) the user's fleets. */
const vehicleFor = (k: 'ops', inside: boolean) => {
  const { sim, tree } = server.ctx;
  const fleets = userOf(k).fleetIds;
  const i = [...Array(sim.count).keys()].find(
    (n) => tree.inScope(sim.fleetId(n), fleets) === inside,
  )!;
  return { regno: sim.regno(i), vehicleId: sim.vehicleId(i) };
};

function host(k: 'ops' | 'superadmin' | 'viewer' | 'driver', events: ChatEvent[] = []): ToolHost {
  const user = userOf(k);
  return {
    ctx: server.ctx,
    user,
    permissions: server.ctx.accounts.permissions(user),
    api: async (path) => {
      const r = await server.app.inject({
        method: 'GET',
        url: path,
        headers: { cookie: cookies[k] },
      });
      return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as unknown) : null };
    },
    reports: new ReportStore(() => server.ctx.clock.now()),
    emit: (e) => events.push(e),
    entities: new Map(),
    logError: () => {},
  };
}

async function callTool(h: ToolHost, name: string, input: unknown) {
  const tool = buildTools(h).find((t) => t.name === name)!;
  try {
    return {
      ok: true,
      json: JSON.parse((await tool.run(tool.parse(input))) as string) as Record<string, unknown>,
    };
  } catch (err) {
    return { ok: false, error: String((err as { content?: unknown }).content ?? err) };
  }
}

/** POSTs a question and returns every SSE event (validated against the contract). */
async function chat(
  cookie: string,
  question: string,
  signal?: AbortSignal,
  onEvent?: (e: ChatEvent) => void,
) {
  const res = await fetch(`${server.base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
    signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const events: ChatEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let k: number;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, k);
        buf = buf.slice(k + 2);
        if (!line.startsWith('data: ')) continue;
        const e = chatEventSchema.parse(JSON.parse(line.slice(6)));
        events.push(e);
        onEvent?.(e);
      }
    }
  } catch (err) {
    if (!signal?.aborted) throw err;
  }
  return events;
}

const script = (body: unknown) =>
  server.api('POST', '/api/dev/assistant/script', {
    body,
    schema: z.unknown(),
    cookie: cookies.ops,
  });
const stats = async () =>
  (await (await fetch(`${server.base}/api/dev/assistant/stats`)).json()) as {
    activeRuns: number;
    fakeAborted: number;
  };

describe('F17-T1 tools: schemas, scope and permissions', () => {
  it('tool schemas are strict objects and zod-validated', () => {
    const defs = toolDefinitions(buildTools(host('ops'))) as {
      name: string;
      strict: boolean;
      input_schema: { type: string; additionalProperties?: boolean };
    }[];
    // F19 added the seven dashboard tools to the one sorted list.
    expect(defs.map((d) => d.name)).toEqual([
      'add_widget',
      'arrange_widgets',
      'create_dashboard',
      'create_report',
      'find_drivers',
      'find_vehicles',
      'fleet_summary',
      'get_dashboard',
      'get_driver',
      'get_vehicle',
      'list_requests',
      'remove_widget',
      'rename_dashboard',
      'update_widget',
      'vehicle_history',
    ]);
    for (const d of defs) {
      expect(d.strict).toBe(true);
      expect(d.input_schema.type).toBe('object');
      expect(d.input_schema.additionalProperties).toBe(false);
    }
    const report = buildTools(host('ops')).find((t) => t.name === 'create_report')!;
    expect(() => report.parse({ kind: 'nope', format: 'csv' })).toThrow();
  });

  it('an Operator in North gets their vehicle, but a vehicle outside North is "not found"', async () => {
    const mine = await callTool(host('ops'), 'get_vehicle', {
      regno: vehicleFor('ops', true).regno,
    });
    expect(mine.ok).toBe(true);
    expect(mine.json!.regno).toBe(vehicleFor('ops', true).regno);
    const other = await callTool(host('ops'), 'get_vehicle', {
      regno: vehicleFor('ops', false).regno,
    });
    expect(other).toMatchObject({ ok: false });
    expect(other.error).toMatch(/not found/i);
    // Unknown regnos read the same as out-of-scope ones.
    const unknown = await callTool(host('ops'), 'get_vehicle', { regno: 'ZZ99ZZ9999' });
    expect(unknown.error!.replace('ZZ99ZZ9999', 'X')).toBe(
      other.error!.replace(vehicleFor('ops', false).regno, 'X'),
    );
    const history = await callTool(host('ops'), 'vehicle_history', {
      regno: vehicleFor('ops', false).regno,
    });
    expect(history.error).toMatch(/not found/i);
  });

  it('search results stay inside the scope', async () => {
    const res = await callTool(host('ops'), 'find_vehicles', { limit: 50 });
    const north = new Set(
      [...server.ctx.tree.byId.values()]
        .filter((f) => server.ctx.tree.inScope(f.id, userOf('ops').fleetIds))
        .map((f) => f.name),
    );
    const items = res.json!.items as { fleet: string }[];
    expect(items.length).toBe(50);
    expect(items.every((v) => north.has(v.fleet))).toBe(true);
    const drivers = await callTool(host('ops'), 'find_drivers', {});
    expect((drivers.json!.items as { fleet: string }[]).every((d) => north.has(d.fleet))).toBe(
      true,
    );
    expect((await callTool(host('ops'), 'fleet_summary', { fleet: 'South' })).error).toMatch(
      /not found/i,
    );
  });

  it('permission-gated tools say "not permitted"', async () => {
    expect((await callTool(host('viewer'), 'fleet_summary', {})).error).toMatch(/not permitted/i);
    expect((await callTool(host('viewer'), 'list_requests', {})).error).toMatch(/not permitted/i);
    expect((await callTool(host('driver'), 'get_vehicle', { regno: 'X' })).error).toMatch(
      /not permitted/i,
    );
    expect(
      (await callTool(host('viewer'), 'create_report', { kind: 'utilisation', format: 'csv' }))
        .error,
    ).toMatch(/not permitted/i);
    const ok = await callTool(host('ops'), 'list_requests', {});
    expect(ok.ok).toBe(true);
  });

  it('tool runs emit start/end events with user-facing labels', async () => {
    const events: ChatEvent[] = [];
    const { regno } = vehicleFor('ops', true);
    await callTool(host('ops', events), 'get_vehicle', { regno });
    expect(events[0]).toMatchObject({
      type: 'tool_start',
      name: 'get_vehicle',
      label: `Looking up ${regno}…`,
    });
    expect(events[1]).toMatchObject({ type: 'tool_end', ok: true });
  });
});

describe('F17-T3 /api/chat against the fake model', () => {
  it('guards: 401 without a session, 403 without chat.use, 422 for a bad body', async () => {
    const q = { messages: [{ role: 'user', content: 'hi' }] };
    expect((await server.api('POST', '/api/chat', { body: q })).status).toBe(401);
    expect(
      (await server.api('POST', '/api/chat', { body: q, cookie: cookies.viewer })).status,
    ).toBe(403);
    expect(
      (await server.api('POST', '/api/chat', { body: { messages: [] }, cookie: cookies.ops }))
        .status,
    ).toBe(422);
  });

  it('vehicle question: tool_start → tool_end → text → entities → done (with cache usage)', async () => {
    const { regno, vehicleId } = vehicleFor('ops', true);
    const events = await chat(cookies.ops, `Where is ${regno}?`);
    const types = events.map((e) => e.type);
    const iStart = types.indexOf('tool_start');
    expect(iStart).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('tool_end')).toBeGreaterThan(iStart);
    expect(types.indexOf('text')).toBeGreaterThan(types.indexOf('tool_end'));
    expect(types.indexOf('entities')).toBeGreaterThan(types.lastIndexOf('text'));
    expect(types.at(-1)).toBe('done');
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toContain(regno);
    const entities = events.find((e) => e.type === 'entities');
    expect(entities).toMatchObject({
      items: expect.arrayContaining([{ kind: 'vehicle', id: vehicleId, label: regno }]),
    });
    const done = events.at(-1) as Extract<ChatEvent, { type: 'done' }>;
    expect(done.stopReason).toBe('end_turn');
    expect(done.usage!.cacheReadInputTokens).toBeGreaterThan(0);
    expect(done.usage!.cacheCreationInputTokens).toBeGreaterThan(0);
  });

  it('an out-of-scope regno never leaks: the answer says it was not found', async () => {
    const { regno } = vehicleFor('ops', false);
    const events = await chat(cookies.ops, `Where is ${regno}?`);
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({
      ok: false,
      summary: 'Not found',
    });
    expect(events.some((e) => e.type === 'entities')).toBe(false);
  });

  it('the request carries the model settings and the cache-friendly layout', async () => {
    await chat(cookies.ops, 'hello');
    const last = (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
      beta: string;
      body: Record<string, unknown>;
    };
    expect(last.beta).toContain('server-side-fallback-2026-07-01');
    expect(last.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      tool_choice: { type: 'auto' },
      system: SYSTEM_PROMPT,
      stream: true,
    });
    const first = (last.body.messages as { content: { text: string }[] }[])[0]!;
    expect(first.content[0]!.text).toContain('Ops User');
    expect(first.content[1]!.text).toBe('hello');
  });

  it('CSV and PDF reports: report event, owner-only download with the right headers', async () => {
    const csvEvents = await chat(cookies.ops, 'Export no-GPS vehicles as CSV');
    const csv = (csvEvents.find((e) => e.type === 'report') as { report: ReportDescriptor }).report;
    expect(csv).toMatchObject({ kind: 'no-gps', format: 'csv' });
    expect(csvEvents.at(-1)!.type).toBe('done');
    const res = await fetch(server.base + csv.url, { headers: { cookie: cookies.ops } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${csv.filename}"`);
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[0]).toMatch(/^Regno,Fleet,Status,Last GPS/);
    expect(lines.length - 1).toBe(csv.rows);
    expect(
      (await fetch(server.base + csv.url, { headers: { cookie: cookies.superadmin } })).status,
    ).toBe(404);
    expect((await fetch(server.base + csv.url)).status).toBe(401);

    const pdfEvents = await chat(cookies.ops, 'Export no-GPS vehicles as PDF');
    const pdf = (pdfEvents.find((e) => e.type === 'report') as { report: ReportDescriptor }).report;
    expect(pdf.filename).toMatch(/\.pdf$/);
    const pdfRes = await fetch(server.base + pdf.url, { headers: { cookie: cookies.ops } });
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    const doc = await PDFDocument.load(new Uint8Array(await pdfRes.arrayBuffer()));
    expect(doc.getTitle()).toBe('No-GPS vehicles report');
  });

  it('a final refusal ends with error "refusal" (no done)', async () => {
    await script({ name: 'refusal' });
    const events = await chat(cookies.ops, 'anything');
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'refusal' });
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('429 from the model → error "busy"; a 400 → "failed"', async () => {
    await script({ name: 'busy' });
    expect((await chat(cookies.ops, 'anything')).at(-1)).toMatchObject({
      type: 'error',
      code: 'busy',
    });
    await script({ name: 'failed' });
    expect((await chat(cookies.ops, 'anything')).at(-1)).toMatchObject({
      type: 'error',
      code: 'failed',
    });
  });

  it('caps the tool loop at 8 iterations', async () => {
    await script({ name: 'loop' });
    const events = await chat(cookies.ops, 'loop forever');
    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(8);
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_iterations' });
  });

  it('explicit scripts: tool step then {{result}} text', async () => {
    const { regno } = vehicleFor('ops', true);
    await script({
      steps: [
        { tools: [{ name: 'get_vehicle', input: { regno } }] },
        { text: 'Result: {{result}}' },
      ],
    });
    const text = (await chat(cookies.ops, 'custom'))
      .flatMap((e) => (e.type === 'text' ? [e.delta] : []))
      .join('');
    expect(text).toContain(`"regno":"${regno}"`);
  });

  it('a client abort cancels the run', async () => {
    await script({ name: 'slow' });
    const before = (await stats()).fakeAborted;
    const controller = new AbortController();
    const events = await chat(cookies.ops, 'slow', controller.signal, (e) => {
      if (e.type === 'text') controller.abort();
    });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    for (let k = 0; k < 50; k++) {
      const s = await stats();
      if (s.activeRuns === 0 && s.fakeAborted > before) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const s = await stats();
    expect(s.activeRuns).toBe(0);
    expect(s.fakeAborted).toBeGreaterThan(before);
  });

  it('no API key and fake off → error "not_configured"', async () => {
    const saved = { fake: process.env.FMS_ASSISTANT_FAKE, key: process.env.ANTHROPIC_API_KEY };
    process.env.FMS_ASSISTANT_FAKE = '0';
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await chat(cookies.ops, 'hi')).toEqual([
        expect.objectContaining({ type: 'error', code: 'not_configured' }),
      ]);
    } finally {
      process.env.FMS_ASSISTANT_FAKE = saved.fake;
      if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    }
  });
});

describe('F17-T4 prompt caching hygiene', () => {
  const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

  it('system prompt and tool list are byte-identical across users and requests', () => {
    const a = toolDefinitions(buildTools(host('ops')));
    const b = toolDefinitions(buildTools(host('superadmin')));
    expect(digest(a)).toBe(digest(b));
    expect(digest(requestPrefix())).toBe(digest(requestPrefix()));
    expect(TOOL_NAMES).toEqual([...TOOL_NAMES].sort());
  });

  it('no timestamps, dates, ids or names in the cached prefix', () => {
    const prefix = JSON.stringify({
      tools: toolDefinitions(buildTools(host('ops'))),
      system: SYSTEM_PROMPT,
    });
    expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prefix).not.toMatch(/\b\d{10,13}\b/);
    expect(prefix).not.toMatch(/Ops User|Super Admin|u-ops|North/);
  });

  it('per-user context goes in the first user turn only', () => {
    const ctx = { name: 'Ops User', role: 'Operator', fleets: ['North'], today: '2026-10-14' };
    const msgs = toApiMessages(
      [
        { role: 'assistant', content: 'dropped (history must start with a user turn)' },
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ],
      ctx,
    );
    expect(msgs).toHaveLength(3);
    expect(JSON.stringify(msgs[0])).toContain('Today (IST): 2026-10-14');
    expect(msgs[2]).toEqual({ role: 'user', content: 'q2' });
  });
});
