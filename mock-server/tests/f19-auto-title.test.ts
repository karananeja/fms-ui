// @vitest-environment node
import {
  chatEventSchema,
  dashboardSchema,
  dashboardThreadSchema,
  DEFAULT_DASHBOARD_TITLE,
  type ChatEvent,
  type Dashboard,
  type DashboardThread,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { titleFromPrompt } from '../assistant/auto-title.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/** F19 auto-title: a default-titled dashboard gets a meaningful title on its first chat turn. */

process.env.FMS_ASSISTANT_FAKE = '1';
process.env.FMS_ASSISTANT_PROVIDER = 'anthropic';
delete process.env.FMS_ASSISTANT_MODEL;

let server: Awaited<ReturnType<typeof startServer>>;
let ops = '';

beforeAll(async () => {
  server = await startServer();
  ops = await server.login(SEED_USERS.ops);
});
afterAll(() => {
  process.env.FMS_ASSISTANT_PROVIDER = 'anthropic';
  return server.close();
});

async function chat(id: string, message: string) {
  const res = await fetch(`${server.base}/api/dashboards/${id}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ops },
    body: JSON.stringify({ message }),
  });
  expect(res.status).toBe(200);
  const events: ChatEvent[] = [];
  for (const block of (await res.text()).split('\n\n'))
    if (block.startsWith('data: ')) events.push(chatEventSchema.parse(JSON.parse(block.slice(6))));
  return events;
}

type Changed = Extract<ChatEvent, { type: 'dashboard_changed' }>;
const changes = (events: ChatEvent[]) =>
  events.filter((e): e is Changed => e.type === 'dashboard_changed');
const saved = (events: ChatEvent[]) =>
  events.find((e) => e.type === 'thread_saved') as Extract<ChatEvent, { type: 'thread_saved' }>;

async function newDashboard(title?: string): Promise<Dashboard> {
  const res = await server.api('POST', '/api/dashboards', {
    body: title === undefined ? {} : { title },
    cookie: ops,
    schema: dashboardSchema,
  });
  expect(res.status).toBe(201);
  return res.body;
}
const getDash = async (id: string) =>
  (await server.api('GET', `/api/dashboards/${id}`, { cookie: ops, schema: dashboardSchema }))
    .body as Dashboard;
const thread = async (id: string) =>
  (
    await server.api('GET', `/api/dashboards/${id}/thread`, {
      cookie: ops,
      schema: dashboardThreadSchema,
    })
  ).body as DashboardThread;
const undo = (id: string, changeId: string, version: number) =>
  server.api('POST', `/api/dashboards/${id}/changes/${changeId}/undo`, {
    body: { version },
    cookie: ops,
    schema: dashboardSchema,
  });
const script = (steps: unknown[]) =>
  server.api('POST', '/api/dev/assistant/script', {
    body: { steps },
    schema: z.unknown(),
    cookie: ops,
  });
/** The user messages of the latest model request (the <dashboard> block rides on the latest). */
const lastUserTurn = async () => {
  const last = (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
    body: { messages: { role: string; content: unknown }[] };
  };
  return JSON.stringify(last.body.messages.filter((m) => m.role === 'user'));
};
const systemOf = async () => {
  const last = (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
    body: { system?: unknown; messages: { role: string; content: unknown }[] };
  };
  return JSON.stringify(last.body.system ?? last.body.messages[0]);
};

const BUILD = 'Build this dashboard: running vs stopped and top idle vehicles';

describe('F19 auto-title: titleFromPrompt', () => {
  it.each([
    [BUILD, 'Running vs Stopped Top Idle Vehicles'],
    ['Create a dashboard with no-GPS vehicles by fleet', 'No-GPS Vehicles by Fleet'],
    ['show me a dashboard of charging EVs in Pune 🚗', 'Charging EVs in Pune'],
    [
      'Please build me a new dashboard for "driver performance" and idle time this week',
      'Driver Performance Idle Time Week',
    ],
    ['create a dashboard', 'Fleet Dashboard'],
  ])('%s → %s', (prompt, title) => {
    const t = titleFromPrompt(prompt);
    expect(t).toBe(title);
    expect(t.length).toBeLessThanOrEqual(40);
  });
});

describe('F19 auto-title: model path (fake model calls rename_dashboard)', () => {
  it.each(['anthropic', 'openai'] as const)(
    '%s wire: rename in the same turn and change set; Undo restores the default',
    async (provider) => {
      process.env.FMS_ASSISTANT_PROVIDER = provider;
      const d = await newDashboard();
      expect(d.title).toBe(DEFAULT_DASHBOARD_TITLE);
      const events = await chat(d.id, BUILD);
      // The hint is in the latest user turn's <dashboard> block only, not in the system prompt.
      expect(await lastUserTurn()).toContain('titleIsDefault');
      expect(await systemOf()).not.toContain('titleIsDefault');
      expect(events.some((e) => e.type === 'tool_start' && e.name === 'rename_dashboard')).toBe(
        true,
      );
      const ch = changes(events);
      expect(ch).toHaveLength(4);
      expect(new Set(ch.map((c) => c.changeId)).size).toBe(1);
      expect(ch.at(-1)!.dashboard.title).toBe('Running vs Stopped Top Idle Vehicles');
      const msg = saved(events).messages[1]!;
      expect(msg.chips.filter((c) => c.tool === 'rename_dashboard')).toHaveLength(1);
      expect(msg.chips.map((c) => c.label)).toContain(
        'Renamed dashboard to "Running vs Stopped Top Idle Vehicles"',
      );
      expect((await getDash(d.id)).title).toBe('Running vs Stopped Top Idle Vehicles');

      const res = await undo(d.id, ch[0]!.changeId, ch.at(-1)!.version);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: DEFAULT_DASHBOARD_TITLE, widgets: [] });
    },
  );
});

describe('F19 auto-title: server fallback', () => {
  it('the model did not rename → renamed from the first message, in the turn change set; Undo; never again', async () => {
    const d = await newDashboard();
    await script([{ text: 'Sure, tell me more about what you need.' }]);
    const events = await chat(d.id, 'Create a dashboard with no-GPS vehicles by fleet');
    expect(events.some((e) => e.type === 'tool_start')).toBe(false);
    const ch = changes(events);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({
      label: 'Renamed dashboard: No-GPS Vehicles by Fleet',
      dashboard: { title: 'No-GPS Vehicles by Fleet' },
    });
    const types = events.map((e) => e.type);
    expect(types.indexOf('dashboard_changed')).toBeLessThan(types.indexOf('thread_saved'));
    expect(types.at(-1)).toBe('done');
    const msg = saved(events).messages[1]!;
    expect(msg.chips).toEqual([
      {
        tool: 'rename_dashboard',
        label: 'Renamed dashboard: No-GPS Vehicles by Fleet',
        status: 'ok',
      },
    ]);
    expect(msg.change).toMatchObject({ id: ch[0]!.changeId, undoable: true });

    const res = await undo(d.id, ch[0]!.changeId, ch[0]!.version);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(DEFAULT_DASHBOARD_TITLE);

    // Renamed once (even though undone): later turns leave the title alone and drop the hint.
    await script([{ text: 'OK.' }]);
    const later = await chat(d.id, 'Show charging vehicles too');
    expect(changes(later)).toHaveLength(0);
    expect(await lastUserTurn()).not.toContain('titleIsDefault');
    expect((await getDash(d.id)).title).toBe(DEFAULT_DASHBOARD_TITLE);
  });

  it('extends the change set of a turn that also changed widgets', async () => {
    const d = await newDashboard();
    await script([
      {
        tools: [
          {
            name: 'add_widget',
            input: { widget: { type: 'text', title: 'Note', body: 'Hello' } },
          },
        ],
      },
      { text: 'Added a note.' },
    ]);
    const events = await chat(d.id, 'add a note about the morning shift');
    const ch = changes(events);
    expect(ch.map((c) => c.label)).toEqual([
      'Added widget: Note',
      'Renamed dashboard: Note Morning Shift',
    ]);
    expect(new Set(ch.map((c) => c.changeId)).size).toBe(1);
    const res = await undo(d.id, ch[0]!.changeId, ch.at(-1)!.version);
    expect(res.body).toMatchObject({ title: DEFAULT_DASHBOARD_TITLE, widgets: [] });
  });

  it('no rename after an error turn', async () => {
    const d = await newDashboard();
    await script([{ error: 400 }]);
    const events = await chat(d.id, 'Create a dashboard with no-GPS vehicles');
    expect(events.at(-1)?.type).toBe('error');
    expect(changes(events)).toHaveLength(0);
    expect((await getDash(d.id)).title).toBe(DEFAULT_DASHBOARD_TITLE);
  });
});

describe('F19 auto-title: a title the user chose is never touched', () => {
  it('created with a title: no hint, no rename tool, no fallback', async () => {
    const d = await newDashboard('My ops board');
    const events = await chat(d.id, BUILD);
    expect(await lastUserTurn()).not.toContain('titleIsDefault');
    expect(events.some((e) => e.type === 'tool_start' && e.name === 'rename_dashboard')).toBe(
      false,
    );
    expect(changes(events).every((c) => c.dashboard.title === 'My ops board')).toBe(true);
    expect((await getDash(d.id)).title).toBe('My ops board');
    expect((await thread(d.id)).messages[1]!.chips.map((c) => c.tool)).not.toContain(
      'rename_dashboard',
    );
  });

  it('renamed by the user after creation: untouched', async () => {
    const d = await newDashboard();
    const patched = await server.api('PATCH', `/api/dashboards/${d.id}`, {
      body: { version: d.version, title: 'Night shift' },
      cookie: ops,
      schema: dashboardSchema,
    });
    expect(patched.status).toBe(200);
    await script([{ text: 'OK.' }]);
    const events = await chat(d.id, 'Create a dashboard with no-GPS vehicles');
    expect(changes(events)).toHaveLength(0);
    expect((await getDash(d.id)).title).toBe('Night shift');
  });
});
