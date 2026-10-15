import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSISTANT_MODEL, FAKE_MODEL_PATH } from './assistant-config.ts';

/**
 * F17 fake Messages API (D-107): `POST /__fake-anthropic/v1/messages` streams the same SSE wire
 * format as the Anthropic API, so the real SDK, tool runner and tools all run; only the model
 * is canned. It is stateless per request: the step of a scripted conversation is the number of
 * assistant turns since the user's question, and the script is recovered from the tool_use ids
 * it handed out (`toolu_fake_<script>_<step>_<n>`).
 *
 * Script choice for a new question: the next queued script (`POST /api/dev/assistant/script`),
 * else the built-in rules on the question text (see `ruleScript`).
 */

export const fakeStepSchema = z.union([
  /** Optional preamble text, then tool calls (stop_reason `tool_use`). */
  z.object({
    tools: z.array(z.object({ name: z.string(), input: z.record(z.string(), z.unknown()) })).min(1),
    text: z.string().optional(),
  }),
  /** A refusal (stop_reason `refusal`), optionally after some text. */
  z.object({ refusal: z.literal(true), text: z.string().optional() }),
  /** An HTTP error from the API (429 → busy, 5xx → busy, others → failed). */
  z.object({ error: z.number().int().min(400).max(599) }),
  /**
   * A final text answer (stop_reason `end_turn`). `{{result}}` is replaced by the first tool
   * result of the previous step. `delayMs` streams it word by word with that pause.
   */
  z.object({ text: z.string(), delayMs: z.number().int().min(0).max(5000).optional() }),
]);
export type FakeStep = z.infer<typeof fakeStepSchema>;

/** `POST /api/dev/assistant/script`: a built-in script by name, or explicit steps. */
export const fakeScriptBodySchema = z.union([
  z.object({
    name: z.enum(['refusal', 'busy', 'loop', 'slow', 'failed', 'dash-invalid', 'dash-many']),
  }),
  /** Steps are played in order; the last step repeats if the conversation goes on. */
  z.object({ steps: z.array(fakeStepSchema).min(1).max(20) }),
]);
export type FakeScriptBody = z.infer<typeof fakeScriptBodySchema>;

const BUILTIN: Record<string, FakeStep[]> = {
  refusal: [{ refusal: true }],
  busy: [{ error: 429 }],
  failed: [{ error: 400 }],
  /** Always calls a tool: exercises the 8-iteration cap. */
  loop: [{ tools: [{ name: 'find_vehicles', input: { limit: 1 } }] }],
  /** F19: a widget outside the catalogue → tool error → an apologetic answer. */
  'dash-invalid': [
    {
      tools: [
        {
          name: 'add_widget',
          input: { widget: { type: 'iframe', title: 'Embedded page', url: 'https://example.com' } },
        },
      ],
    },
    {
      text: "Sorry, I can't add that: dashboards only support the built-in widget types. ({{result}})",
    },
  ],
  /** F19: always calls a tool: exercises the 12-step cap of the dashboard chat. */
  'dash-many': [{ tools: [{ name: 'get_dashboard', input: {} }] }],
  /** A long, slow answer: exercises Stop / abort. */
  slow: [
    {
      text: Array.from({ length: 200 }, (_, k) => `word${k}`).join(' '),
      delayMs: 50,
    },
  ],
};

const REGNO = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4})\b/i;
const REGNO_PREFIX = /\b([A-Z]{2}\d{2})(?:\b|…|\.\.\.)/i;
const DRIVER_NAME = /driver\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/;

/**
 * Built-in rules (first match wins) on the latest question:
 * - `[fake:<name>]` → that built-in script (refusal, busy, loop, slow, failed).
 * - export/report/csv/pdf/download → `create_report` (kind from the words: no-gps, utilisation,
 *   driver, request, else vehicle-status; PDF if "pdf" is mentioned, else CSV).
 * - a full regno (e.g. MH12AB1234) → `get_vehicle`.
 * - a regno prefix (e.g. "MH12…") → `find_vehicles` with that query.
 * - "driver <Capitalised Name>" → `get_driver`; any other "driver" → `find_drivers`.
 * - request/breakdown/rsa/replacement → `list_requests`.
 * - summary/kpi/how is/fleet → `fleet_summary`.
 * - anything else → a plain text answer.
 * After the tool step, the answer is written from the tool results.
 */
export function ruleScript(raw: string): { key: string; steps: FakeStep[] } {
  const dash = parseDashboardBlock(raw);
  const question = stripBlocks(raw);
  const q = question.toLowerCase();
  const named = /\[fake:([a-z-]+)\]/.exec(q)?.[1];
  if (named && BUILTIN[named]) return { key: named, steps: BUILTIN[named] };
  const tool = (name: string, input: Record<string, unknown>): FakeStep[] => [
    { tools: [{ name, input }] },
  ];
  const dashSteps = dashboardRule(question, dash);
  if (dashSteps) return { key: 'auto', steps: dashSteps };
  if (/\b(export|report|csv|pdf|download)\b/.test(q)) {
    const kind = /no.?gps/.test(q)
      ? 'no-gps'
      : /utili[sz]ation/.test(q)
        ? 'utilisation'
        : /driver/.test(q)
          ? 'driver-performance'
          : /request/.test(q)
            ? 'requests'
            : 'vehicle-status';
    return {
      key: 'auto',
      steps: tool('create_report', { kind, format: /\bpdf\b/.test(q) ? 'pdf' : 'csv' }),
    };
  }
  const regno = REGNO.exec(question)?.[1];
  if (regno)
    return { key: 'auto', steps: tool('get_vehicle', { regno: regno.replace(/\s/g, '') }) };
  const prefix = REGNO_PREFIX.exec(question)?.[1];
  if (prefix) return { key: 'auto', steps: tool('find_vehicles', { query: prefix, limit: 5 }) };
  if (/driver/.test(q)) {
    const name = DRIVER_NAME.exec(question)?.[1];
    return {
      key: 'auto',
      steps: name ? tool('get_driver', { name }) : tool('find_drivers', {}),
    };
  }
  if (/\b(request|breakdown|rsa|replacement)s?\b/.test(q))
    return { key: 'auto', steps: tool('list_requests', {}) };
  if (/\b(summary|summarise|summarize|kpi|kpis|how is|how are|fleet)\b/.test(q))
    return { key: 'auto', steps: tool('fleet_summary', {}) };
  return {
    key: 'auto',
    steps: [
      {
        text: 'I am running in fake mode. Ask me about a vehicle by its regno, about a driver, or ask me to export no-GPS vehicles as CSV or PDF.',
      },
    ],
  };
}

// ---- F19 dashboard rules (D-126) ----

interface FakeWidget {
  id: string;
  type: string;
  title: string;
  settings: Record<string, unknown>;
}

/** The `<dashboard>` block of the latest user turn (dashboard chat), if any. */
function parseDashboardBlock(text: string): { id: string; widgets: FakeWidget[] } | undefined {
  const m = /<dashboard>\s*([\s\S]*?)\s*<\/dashboard>/.exec(text);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]!) as { id: string; widgets: FakeWidget[] };
  } catch {
    return undefined;
  }
}

const stripBlocks = (text: string) =>
  text
    .replace(/<context>[\s\S]*?<\/context>/g, '')
    .replace(/<dashboard>[\s\S]*?<\/dashboard>/g, '')
    .trim();

/** The three widgets the fake builds ("running vs stopped and top idle vehicles"). */
export const FAKE_DASHBOARD_WIDGETS = [
  { type: 'kpi', title: 'Running vehicles', source: 'live', status: 'running' },
  { type: 'status-breakdown', title: 'Running vs stopped', display: 'donut' },
  {
    type: 'ranking',
    title: 'Top idle vehicles',
    entity: 'vehicles',
    metric: 'idleMs',
    order: 'desc',
    limit: 10,
    range: '7d',
  },
];

const STOP_WORDS = new Set(['remove', 'delete', 'widget', 'the', 'and', 'from', 'this', 'please']);

/**
 * Dashboard rules, checked before the F17 rules: in a dashboard chat (a `<dashboard>` block),
 * rename / remove / arrange / "30 days" / add a note / build; in the global chat,
 * build|create|make … dashboard → `create_dashboard`.
 */
function dashboardRule(
  question: string,
  dash: { id: string; widgets: FakeWidget[] } | undefined,
): FakeStep[] | undefined {
  const q = question.toLowerCase();
  const step = (...tools: { name: string; input: Record<string, unknown> }[]): FakeStep[] => [
    { tools },
  ];
  if (!dash) {
    if (/\bdashboards?\b/.test(q) && /\b(build|create|make)\b/.test(q))
      return step({
        name: 'create_dashboard',
        input: { title: 'Fleet overview', widgets: FAKE_DASHBOARD_WIDGETS },
      });
    return undefined;
  }
  const widgets = dash.widgets;
  const rename = /\brename\b[\s\S]*?\bto\s+["“']([^"”']+)["”']/i.exec(question);
  if (rename) return step({ name: 'rename_dashboard', input: { title: rename[1]!.trim() } });
  if (/\b(remove|delete)\b/.test(q) && widgets.length) {
    const words = new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
    // The widget whose title shares the most words with the question, else the last one.
    let hit = widgets.at(-1)!;
    let best = 0;
    for (const w of widgets) {
      const score = w.title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => words.has(t)).length;
      if (score > best) [hit, best] = [w, score];
    }
    return step({ name: 'remove_widget', input: { widgetIds: [hit.id] } });
  }
  if (/\b(arrange|rearrange|reorder)\b/.test(q) && widgets.length)
    return step({
      name: 'arrange_widgets',
      input: { order: widgets.map((w) => w.id).reverse() },
    });
  if (/\b(change|update|make)\b/.test(q) && /\b30\s*(days?|d)\b/.test(q)) {
    const ranking = widgets.find((w) => w.type === 'ranking');
    if (ranking)
      return step({
        name: 'update_widget',
        input: {
          widgetId: ranking.id,
          widget: { type: ranking.type, title: ranking.title, ...ranking.settings, range: '30d' },
        },
      });
  }
  if (/\badd\b/.test(q) && /\b(note|text)\b/.test(q))
    return step({
      name: 'add_widget',
      input: { widget: { type: 'text', title: 'Note', body: 'Check the no-GPS vehicles first.' } },
    });
  if (/\b(build|add)\b/.test(q)) {
    if (!widgets.length)
      return step(
        ...FAKE_DASHBOARD_WIDGETS.map((widget) => ({ name: 'add_widget', input: { widget } })),
      );
    return step({
      name: 'add_widget',
      input: { widget: { type: 'kpi', title: 'All vehicles', source: 'live', status: 'total' } },
    });
  }
  return undefined;
}

// ---- answers written from tool results (built-in rules) ----

interface ToolOutcome {
  name: string;
  input: Record<string, unknown>;
  content: string;
  isError: boolean;
}

type Json = Record<string, unknown>;

function answerFrom(outcomes: ToolOutcome[]): string {
  return outcomes.map(answerOne).join('\n\n');
}

function answerOne(o: ToolOutcome): string {
  if (o.isError) return `Sorry, I couldn't get that: ${o.content}`;
  let r: Json;
  try {
    r = JSON.parse(o.content) as Json;
  } catch {
    return o.content;
  }
  switch (o.name) {
    case 'get_vehicle': {
      const driver = r.driver as { name: string } | null;
      const loc = r.location as { lat: number; lng: number } | null;
      return [
        `**${String(r.regno)}** is **${String(r.statusLabel)}** in ${String(r.fleet)}.`,
        `- Speed: ${String(r.speedKmh)} km/h, SOC: ${String(r.socPct)} %, range: ${String(r.rangeKm)} km`,
        `- Location: ${loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'unknown'} (last GPS ${String(r.lastGps ?? 'never')})`,
        `- Driver: ${driver ? driver.name : 'none assigned'}`,
      ].join('\n');
    }
    case 'find_vehicles': {
      const items = r.items as { regno: string; status: string; fleet: string }[];
      if (!items.length) return 'No vehicles match that.';
      return [
        `I found ${String(r.total)} matching vehicles. The first ${items.length}:`,
        ...items.map((v) => `- **${v.regno}**: ${v.status} (${v.fleet})`),
      ].join('\n');
    }
    case 'get_driver': {
      if (r.ambiguous) {
        const m = r.matches as { name: string }[];
        return `Several drivers match: ${m.map((d) => d.name).join(', ')}. Which one do you mean?`;
      }
      const k = r.last30Days as { score: number | null; distanceKm: number } | undefined;
      return [
        `**${String(r.name)}** (${String(r.status)}, ${String(r.fleet)}) is currently driving ${r.currentVehicle ? `**${String(r.currentVehicle)}**` : 'no vehicle'}.`,
        k ? `- Last 30 days: ${k.distanceKm} km, score ${k.score ?? 'n/a'}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'find_drivers': {
      const items = r.items as { name: string; currentVehicle: string | null }[];
      if (!items.length) return 'No drivers match that.';
      return [
        `You have ${String(r.total)} matching drivers. The first ${Math.min(5, items.length)}:`,
        ...items
          .slice(0, 5)
          .map((d) => `- ${d.name}${d.currentVehicle ? ` (${d.currentVehicle})` : ''}`),
      ].join('\n');
    }
    case 'create_report':
      return `Your report **${String(r.filename)}** is ready with ${String(r.rows)} rows. Use the Download button below; the link expires in 15 minutes.`;
    case 'list_requests':
      return `There are ${String(r.total)} requests. By status: ${Object.entries(r.byStatus as Json)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(', ')}.`;
    case 'create_dashboard': {
      const ws = r.widgets as unknown[];
      return `I created **${String(o.input.title)}** with ${ws.length} widgets. [Open it](${String(r.url)})`;
    }
    case 'get_dashboard':
      return r.title !== undefined
        ? `**${String(r.title)}** has ${(r.widgets as unknown[]).length} widgets.`
        : `Done: ${o.content.slice(0, 200)}`;
    case 'add_widget':
      return `Added **${String((o.input.widget as Json | undefined)?.title)}**.`;
    case 'update_widget':
      return `Updated **${String((o.input.widget as Json | undefined)?.title)}**.`;
    case 'remove_widget': {
      const n = (r.removed as unknown[]).length;
      return `Removed ${n} widget${n === 1 ? '' : 's'}.`;
    }
    case 'arrange_widgets':
      return 'Rearranged the widgets.';
    case 'rename_dashboard':
      return `Renamed the dashboard to **${String(r.title)}**.`;
    case 'fleet_summary':
      return `Across ${String(r.vehicles)} vehicles from ${String(r.from)} to ${String(r.to)}: ${String(r.distanceKm)} km driven, uptime ${String(r.uptimePct)} %, ${String(r.breakdowns)} breakdowns.`;
    default:
      return `Done: ${o.content.slice(0, 200)}`;
  }
}

// ---- request parsing ----

interface WireBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | { type: string; text?: string }[];
  is_error?: boolean;
}
interface WireMessage {
  role: string;
  content: string | WireBlock[];
}

const blocks = (m: WireMessage): WireBlock[] =>
  typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
const isQuestion = (m: WireMessage) =>
  m.role === 'user' && !blocks(m).some((b) => b.type === 'tool_result');
const resultText = (b: WireBlock) =>
  typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? '').join('');

// ---- SSE writer ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FakeModelStats {
  requests: number;
  /** Streams cut short because the caller went away. */
  aborted: number;
  /** The latest request (caching-hygiene checks). */
  lastRequest?: { beta: string | undefined; body: unknown };
}

/** Registers the fake endpoint; returns the script queue and stats for the dev routes. */
export function registerFakeModel(app: FastifyInstance) {
  const queue: FakeStep[][] = [];
  const custom = new Map<string, FakeStep[]>();
  let seq = 0;
  const stats: FakeModelStats = { requests: 0, aborted: 0 };

  app.post(`${FAKE_MODEL_PATH}/v1/messages`, async (req, reply) => {
    stats.requests++;
    stats.lastRequest = {
      beta: req.headers['anthropic-beta'] as string | undefined,
      body: req.body,
    };
    const body = req.body as { messages?: WireMessage[] };
    const messages = body.messages ?? [];
    let start = messages.length - 1;
    while (start > 0 && !isQuestion(messages[start]!)) start--;
    const question = blocks(messages[start] ?? { role: 'user', content: '' })
      .map((b) => b.text ?? '')
      .join('\n');
    const after = messages.slice(start + 1);
    const step = after.filter((m) => m.role === 'assistant').length;

    // Which script: from earlier tool ids, else a queued one, else the rules.
    let key: string | undefined;
    for (const m of after)
      for (const b of blocks(m))
        if (b.type === 'tool_use' && b.id?.startsWith('toolu_fake_')) key = b.id.split('_')[2];
    let steps: FakeStep[];
    if (key && key !== 'auto') steps = custom.get(key) ?? BUILTIN[key] ?? [];
    else if (step === 0 && queue.length) {
      key = `c${++seq}`;
      steps = queue.shift()!;
      custom.set(key, steps);
    } else {
      const rule = ruleScript(question);
      key = rule.key;
      steps = rule.steps;
    }

    // Outcomes of the previous step's tool calls (for answers written from results).
    const last = after.at(-1);
    const prev = after.at(-2);
    const outcomes: ToolOutcome[] = [];
    if (last && prev && prev.role === 'assistant') {
      const uses = blocks(prev).filter((b) => b.type === 'tool_use');
      for (const b of blocks(last))
        if (b.type === 'tool_result') {
          const use = uses.find((u) => u.id === b.tool_use_id);
          outcomes.push({
            name: use?.name ?? '',
            input: use?.input ?? {},
            content: resultText(b),
            isError: b.is_error === true,
          });
        }
    }

    let current: FakeStep;
    if (key === 'auto' && step >= steps.length) current = { text: answerFrom(outcomes) };
    else current = steps[Math.min(step, steps.length - 1)] ?? { text: '' };
    if ('text' in current && !('tools' in current) && !('refusal' in current))
      current = {
        ...current,
        text: current.text.replace('{{result}}', outcomes[0]?.content ?? ''),
      };

    if ('error' in current) {
      const type =
        current.error === 429
          ? 'rate_limit_error'
          : current.error === 529
            ? 'overloaded_error'
            : current.error >= 500
              ? 'api_error'
              : 'invalid_request_error';
      return reply
        .code(current.error)
        .header('x-should-retry', 'false')
        .send({ type: 'error', error: { type, message: `fake ${type}` } });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    let closed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        closed = true;
        stats.aborted++;
      }
    });
    const send = (event: string, data: unknown) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const id = `msg_fake_${Date.now().toString(36)}_${stats.requests}`;
    send('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: ASSISTANT_MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 40 + question.length,
          output_tokens: 1,
          cache_creation_input_tokens: step === 0 ? 1800 : 0,
          cache_read_input_tokens: step === 0 ? 0 : 1800,
        },
      },
    });
    let index = 0;
    let outputTokens = 0;
    const textBlock = async (text: string, delayMs = 0) => {
      send('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      const parts = delayMs > 0 ? text.split(/(?<= )/) : (text.match(/[\s\S]{1,24}/g) ?? []);
      for (const part of parts) {
        if (closed) return;
        send('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: part },
        });
        outputTokens++;
        if (delayMs > 0) await sleep(delayMs);
      }
      send('content_block_stop', { type: 'content_block_stop', index });
      index++;
    };

    let stopReason = 'end_turn';
    if ('tools' in current) {
      if (current.text) await textBlock(current.text);
      current.tools.forEach((t, n) => {
        send('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: {
            type: 'tool_use',
            id: `toolu_fake_${key}_${step}_${n}`,
            name: t.name,
            input: {},
          },
        });
        send('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) },
        });
        send('content_block_stop', { type: 'content_block_stop', index });
        index++;
        outputTokens += 10;
      });
      stopReason = 'tool_use';
    } else if ('refusal' in current) {
      if (current.text) await textBlock(current.text);
      stopReason = 'refusal';
    } else await textBlock(current.text, current.delayMs);

    if (closed) return;
    send('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
        ...(stopReason === 'refusal'
          ? { stop_details: { type: 'refusal', category: null, explanation: 'fake refusal' } }
          : {}),
      },
      usage: { output_tokens: outputTokens },
    });
    send('message_stop', { type: 'message_stop' });
    res.end();
  });

  return {
    stats,
    /** Queues a script for the next question (FIFO, one question each). */
    enqueue(body: FakeScriptBody) {
      queue.push('name' in body ? BUILTIN[body.name]! : body.steps);
      return { queued: queue.length };
    },
    clear() {
      queue.length = 0;
    },
  };
}
