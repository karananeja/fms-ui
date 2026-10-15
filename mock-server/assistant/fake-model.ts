import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ASSISTANT_MODEL,
  FAKE_MODEL_PATH,
  FAKE_OPENAI_MODEL,
  FAKE_OPENAI_PATH,
  XAI_CONV_ID_HEADER,
} from './assistant-config.ts';
import { titleFromPrompt } from './auto-title.ts';

/**
 * F17 fake Messages API (D-107): `POST /__fake-anthropic/v1/messages` streams the same SSE wire
 * format as the Anthropic API, so the real SDK, tool runner and tools all run; only the model
 * is canned. F21: `POST /__fake-openai/v1/chat/completions` plays the same scripts and rules in
 * the OpenAI chat-completions SSE format (`tool_calls` deltas), for the OpenAI-compatible
 * adapter. It is stateless per request: the step of a scripted conversation is the number of
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
  /** F24: some text, then the stream ends without a finish (a provider cut). */
  z.object({ cut: z.literal(true), text: z.string().optional() }),
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
    name: z.enum([
      'refusal',
      'busy',
      'loop',
      'slow',
      'failed',
      'dash-invalid',
      'dash-many',
      'preview',
      'cut',
    ]),
  }),
  /** Steps are played in order; the last step repeats if the conversation goes on. */
  z.object({ steps: z.array(fakeStepSchema).min(1).max(20) }),
]);
export type FakeScriptBody = z.infer<typeof fakeScriptBodySchema>;

const BUILTIN: Record<string, FakeStep[]> = {
  refusal: [{ refusal: true }],
  busy: [{ error: 429 }],
  cut: [{ cut: true, text: 'Partial answer that never' }],
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
  /** D-135: one widget as a preview card (both chats), then a short answer. */
  preview: [
    {
      tools: [
        {
          name: 'preview_widget',
          input: {
            widget: { type: 'kpi', title: 'Running vehicles', source: 'live', status: 'running' },
          },
        },
      ],
    },
    {
      text: 'Here is a preview of **Running vehicles**. Add it to the dashboard, drag it onto the grid, or ask me to change it.',
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

interface FakeDashboard {
  id: string;
  widgets: FakeWidget[];
  /** Auto-title hint: the title is still the default. */
  titleIsDefault?: boolean;
}

/** The `<dashboard>` block of the latest user turn (dashboard chat), if any. */
function parseDashboardBlock(text: string): FakeDashboard | undefined {
  const m = /<dashboard>\s*([\s\S]*?)\s*<\/dashboard>/.exec(text);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]!) as FakeDashboard;
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
 * rename / remove / arrange / "30 days" / single widget → `preview_widget` / add a note / build;
 * in the global chat, build|create|make … dashboard → `create_dashboard`, else a single-widget
 * phrase → `preview_widget` (D-135). Auto-title: while the block says the title is the default,
 * the add-a-note and build rules also call `rename_dashboard` (title from the question).
 */
function dashboardRule(question: string, dash: FakeDashboard | undefined): FakeStep[] | undefined {
  const steps = dashboardRuleSteps(question, dash);
  const build = steps?.[0];
  if (
    !dash?.titleIsDefault ||
    !build ||
    !('tools' in build) ||
    !build.tools.every((t) => t.name === 'add_widget')
  )
    return steps;
  return [
    {
      ...build,
      tools: [
        ...build.tools,
        { name: 'rename_dashboard', input: { title: titleFromPrompt(question) } },
      ],
    },
  ];
}

function dashboardRuleSteps(
  question: string,
  dash: FakeDashboard | undefined,
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
    const single = singleWidget(q);
    if (single) return step({ name: 'preview_widget', input: { widget: single } });
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
  const single = singleWidget(q);
  if (single)
    return step({ name: 'preview_widget', input: { dashboardId: dash.id, widget: single } });
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

const FAKE_STATUSES = ['running', 'stopped', 'charging', 'immobilized', 'non-comm', 'no-gps'];

/**
 * D-135: a single-widget phrase ("add a … widget", "small …", "a kpi …") → the widget to
 * preview; `undefined` for anything else (multi-widget builds keep the mutating tools).
 */
function singleWidget(q: string): Record<string, unknown> | undefined {
  if (/\bdashboards?\b/.test(q) && !/\bwidget\b/.test(q)) return undefined;
  const single =
    /\bsmall\b/.test(q) || /\ban?\s+kpi\b/.test(q) || /\badd\s+an?\s+[^.?!]*\bwidget\b/.test(q);
  if (!single) return undefined;
  if (/\b(breakdown|donut)\b/.test(q))
    return { type: 'status-breakdown', title: 'Fleet status', display: 'donut' };
  if (/\b(idle|top|ranking)\b/.test(q)) return FAKE_DASHBOARD_WIDGETS[2];
  const status = FAKE_STATUSES.find((st) => q.includes(st));
  if (status) {
    const label = status[0]!.toUpperCase() + status.slice(1);
    return { type: 'kpi', title: `${label} vehicles`, source: 'live', status };
  }
  return { type: 'kpi', title: 'All vehicles', source: 'live', status: 'total' };
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
    case 'preview_widget':
      return `Here is a preview of **${String((r.widget as Json | undefined)?.title)}**. Add it to the dashboard, drag it onto the grid, or ask me to change it.`;
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

// ---- request parsing (both wire formats → one neutral transcript) ----

interface FakeMessage {
  role: 'user' | 'assistant';
  text: string;
  toolUses: { id: string; name: string; input: Record<string, unknown> }[];
  toolResults: { toolUseId: string; content: string; isError: boolean }[];
}

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

/** Anthropic Messages API messages. */
function fromAnthropic(messages: WireMessage[]): FakeMessage[] {
  return messages.map((m) => {
    const blocks: WireBlock[] =
      typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: blocks.map((b) => b.text ?? '').join('\n'),
      toolUses: blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: b.input ?? {} })),
      toolResults: blocks
        .filter((b) => b.type === 'tool_result')
        .map((b) => ({
          toolUseId: b.tool_use_id ?? '',
          content:
            typeof b.content === 'string'
              ? b.content
              : (b.content ?? []).map((c) => c.text ?? '').join(''),
          isError: b.is_error === true,
        })),
    };
  });
}

interface OaWireMessage {
  role: string;
  content?: string | { type: string; text?: string }[] | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** Chat-completions messages: the system message is dropped, consecutive `tool` messages merged. */
function fromOpenAi(messages: OaWireMessage[]): FakeMessage[] {
  const out: FakeMessage[] = [];
  const text = (c: OaWireMessage['content']) =>
    typeof c === 'string' ? c : (c ?? []).map((p) => p.text ?? '').join('\n');
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') continue;
    if (m.role === 'tool') {
      const content = text(m.content);
      const isError = content.startsWith('Error: ');
      const result = {
        toolUseId: m.tool_call_id ?? '',
        content: isError ? content.slice('Error: '.length) : content,
        isError,
      };
      const prev = out.at(-1);
      if (prev?.toolResults.length) prev.toolResults.push(result);
      else out.push({ role: 'user', text: '', toolUses: [], toolResults: [result] });
      continue;
    }
    out.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: text(m.content),
      toolUses: (m.tool_calls ?? []).map((c) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // keep {}
        }
        return { id: c.id, name: c.function.name, input };
      }),
      toolResults: [],
    });
  }
  return out;
}

const isQuestion = (m: FakeMessage) => m.role === 'user' && !m.toolResults.length;

// ---- F24: fake prompt cache ----

/**
 * A copy without `cache_control` keys (markers do not change the cached bytes), with string
 * message content as one text block (both render the same prompt).
 */
function stripMarkers(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripMarkers);
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const content =
    typeof o.role === 'string' && typeof o.content === 'string'
      ? { content: [{ type: 'text', text: o.content }] }
      : {};
  return Object.fromEntries(
    Object.entries({ ...o, ...content })
      .filter(([k]) => k !== 'cache_control')
      .map(([k, x]) => [k, stripMarkers(x)]),
  );
}

const hasMarker = (v: unknown) => JSON.stringify(v ?? null).includes('"cache_control"');

/** Fake token count of a JSON part (≈ 4 characters per token). */
const tokensOf = (chars: number) => Math.ceil(chars / 4);

export interface FakeCacheUse {
  /** All prompt tokens. */
  total: number;
  /** Tokens read from the cache (the longest prefix written by an earlier request). */
  cached: number;
  /** Tokens newly written (up to the last write point, minus what was read). */
  written: number;
}

/**
 * F24 (D-141): a fake prompt cache. A request is a list of parts (the fixed prefix, then each
 * message); chained digests identify every prefix. A read is the longest prefix an earlier
 * request wrote; writes go at `writeAt` (Anthropic: its breakpoints) or at every part (OpenAI's
 * automatic prefix caching). So turn 2 of a chat, and step 2 of a tool loop, report a hit.
 */
export class FakePromptCache {
  private seen = new Set<string>();

  use(namespace: string, parts: unknown[], writeAt?: ReadonlySet<number>): FakeCacheUse {
    let digest = createHash('sha256').update(namespace).digest('hex');
    let chars = 0;
    let cachedChars = 0;
    let writtenChars = 0;
    const writes: string[] = [];
    parts.forEach((part, k) => {
      const bytes = JSON.stringify(stripMarkers(part));
      chars += bytes.length;
      digest = createHash('sha256').update(digest).update(bytes).digest('hex');
      if (this.seen.has(digest)) cachedChars = chars;
      if (!writeAt || writeAt.has(k)) {
        writes.push(digest);
        writtenChars = chars;
      }
    });
    if (this.seen.size > 50_000) this.seen.clear();
    for (const d of writes) this.seen.add(d);
    const cached = tokensOf(cachedChars);
    return {
      total: tokensOf(chars),
      cached,
      written: Math.max(0, tokensOf(writtenChars) - cached),
    };
  }
}

/** Anthropic request → cache parts (tools + system, then messages) and its breakpoints. */
function anthropicCacheParts(body: {
  tools?: unknown;
  system?: unknown;
  messages?: unknown[];
  cache_control?: unknown;
}) {
  const parts: unknown[] = [{ tools: body.tools ?? [], system: body.system ?? '' }];
  const writeAt = new Set<number>();
  if (hasMarker(body.system) || hasMarker(body.tools)) writeAt.add(0);
  for (const m of body.messages ?? []) {
    if (hasMarker(m)) writeAt.add(parts.length);
    parts.push(m);
  }
  // Top-level automatic caching: a breakpoint on the last block.
  if (body.cache_control) writeAt.add(parts.length - 1);
  return { parts, writeAt };
}

// ---- SSE writers ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FakeModelStats {
  requests: number;
  /** Streams cut short because the caller went away. */
  aborted: number;
  /** The latest request (caching-hygiene checks). */
  lastRequest?: {
    beta: string | undefined;
    body: unknown;
    wire?: 'anthropic' | 'openai';
    /** F24: the xAI conversation-id header, if sent. */
    convId?: string;
  };
}

type ToolCall = { id: string; name: string; input: Record<string, unknown> };

/** One reply in a wire format. */
interface WireWriter {
  start(): void;
  text(text: string, delayMs?: number): Promise<void>;
  tools(calls: ToolCall[]): void;
  finish(stop: 'end_turn' | 'tool_use' | 'refusal'): void;
}

interface Stream {
  send: (chunk: string) => void;
  closed: () => boolean;
}

/** Splits text into stream parts: word by word with a pause, else 24-char slices. */
async function streamText(
  text: string,
  delayMs: number,
  closed: () => boolean,
  part: (s: string) => void,
) {
  const parts = delayMs > 0 ? text.split(/(?<= )/) : (text.match(/[\s\S]{1,24}/g) ?? []);
  for (const p of parts) {
    if (closed()) return;
    part(p);
    if (delayMs > 0) await sleep(delayMs);
  }
}

function anthropicWriter(out: Stream, meta: { requests: number; cache: FakeCacheUse }) {
  const send = (event: string, data: unknown) =>
    out.send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  let index = 0;
  let outputTokens = 0;
  const writer: WireWriter = {
    start() {
      send('message_start', {
        type: 'message_start',
        message: {
          id: `msg_fake_${Date.now().toString(36)}_${meta.requests}`,
          type: 'message',
          role: 'assistant',
          model: ASSISTANT_MODEL,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: Math.max(0, meta.cache.total - meta.cache.cached - meta.cache.written),
            output_tokens: 1,
            cache_creation_input_tokens: meta.cache.written,
            cache_read_input_tokens: meta.cache.cached,
          },
        },
      });
    },
    async text(text, delayMs = 0) {
      send('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      await streamText(text, delayMs, out.closed, (part) => {
        send('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: part },
        });
        outputTokens++;
      });
      if (out.closed()) return;
      send('content_block_stop', { type: 'content_block_stop', index });
      index++;
    },
    tools(calls) {
      for (const t of calls) {
        send('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} },
        });
        send('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) },
        });
        send('content_block_stop', { type: 'content_block_stop', index });
        index++;
        outputTokens += 10;
      }
    },
    finish(stop) {
      send('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: stop,
          stop_sequence: null,
          ...(stop === 'refusal'
            ? { stop_details: { type: 'refusal', category: null, explanation: 'fake refusal' } }
            : {}),
        },
        usage: { output_tokens: outputTokens },
      });
      send('message_stop', { type: 'message_stop' });
    },
  };
  return writer;
}

/** Chat-completions chunks: `data: {…}` lines, tool calls split over several `tool_calls` deltas. */
function openAiWriter(
  out: Stream,
  meta: { requests: number; model: string; cache: FakeCacheUse; usage: boolean },
) {
  const id = `chatcmpl-fake-${Date.now().toString(36)}-${meta.requests}`;
  const created = Math.floor(Date.now() / 1000);
  let outputTokens = 0;
  const chunk = (delta: object, finish: string | null = null) =>
    out.send(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model: meta.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );
  const writer: WireWriter = {
    start() {
      chunk({ role: 'assistant', content: '' });
    },
    async text(text, delayMs = 0) {
      await streamText(text, delayMs, out.closed, (part) => {
        chunk({ content: part });
        outputTokens++;
      });
    },
    tools(calls) {
      calls.forEach((t, n) => {
        chunk({
          tool_calls: [
            { index: n, id: t.id, type: 'function', function: { name: t.name, arguments: '' } },
          ],
        });
        const args = JSON.stringify(t.input);
        const mid = Math.ceil(args.length / 2);
        for (const piece of [args.slice(0, mid), args.slice(mid)])
          if (piece) chunk({ tool_calls: [{ index: n, function: { arguments: piece } }] });
        outputTokens += 10;
      });
    },
    finish(stop) {
      chunk(
        {},
        stop === 'tool_use' ? 'tool_calls' : stop === 'refusal' ? 'content_filter' : 'stop',
      );
      // Usage only when asked for (`stream_options.include_usage`), as the OpenAI API does.
      if (meta.usage)
        out.send(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: meta.model,
            choices: [],
            usage: {
              prompt_tokens: meta.cache.total,
              completion_tokens: outputTokens,
              total_tokens: meta.cache.total + outputTokens,
              prompt_tokens_details: { cached_tokens: meta.cache.cached },
            },
          })}\n\n`,
        );
      out.send('data: [DONE]\n\n');
    },
  };
  return writer;
}

/**
 * Registers the fake endpoints (Anthropic Messages and OpenAI chat completions, same scripts and
 * rules); returns the script queue and stats for the dev routes.
 */
export function registerFakeModel(app: FastifyInstance) {
  const queue: FakeStep[][] = [];
  const custom = new Map<string, FakeStep[]>();
  let seq = 0;
  const stats: FakeModelStats = { requests: 0, aborted: 0 };
  const cache = new FakePromptCache();

  /** The step to play for this transcript (stateless: recovered from the tool ids). */
  function plan(messages: FakeMessage[]) {
    let start = messages.length - 1;
    while (start > 0 && !isQuestion(messages[start]!)) start--;
    const question = messages[start]?.text ?? '';
    const after = messages.slice(start + 1);
    const step = after.filter((m) => m.role === 'assistant').length;

    // Which script: from earlier tool ids, else a queued one, else the rules.
    let key: string | undefined;
    for (const m of after)
      for (const u of m.toolUses) if (u.id.startsWith('toolu_fake_')) key = u.id.split('_')[2];
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
    if (last && prev && prev.role === 'assistant')
      for (const r of last.toolResults) {
        const use = prev.toolUses.find((u) => u.id === r.toolUseId);
        outcomes.push({
          name: use?.name ?? '',
          input: use?.input ?? {},
          content: r.content,
          isError: r.isError,
        });
      }

    let current: FakeStep;
    if (key === 'auto' && step >= steps.length) current = { text: answerFrom(outcomes) };
    else current = steps[Math.min(step, steps.length - 1)] ?? { text: '' };
    if (
      'text' in current &&
      !('tools' in current) &&
      !('refusal' in current) &&
      !('cut' in current)
    )
      current = {
        ...current,
        text: current.text.replace('{{result}}', outcomes[0]?.content ?? ''),
      };
    return { current, key, step, question };
  }

  /** Streams one planned reply with the given writer. */
  async function play(
    reply: FastifyReply,
    planned: ReturnType<typeof plan>,
    makeWriter: (out: Stream) => WireWriter,
  ) {
    const { current, key, step } = planned;
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
    const out: Stream = {
      send: (chunk) => {
        if (!closed) res.write(chunk);
      },
      closed: () => closed,
    };
    const w = makeWriter(out);
    w.start();
    let stop: 'end_turn' | 'tool_use' | 'refusal' = 'end_turn';
    if ('tools' in current) {
      if (current.text) await w.text(current.text);
      w.tools(
        current.tools.map((t, n) => ({
          id: `toolu_fake_${key}_${step}_${n}`,
          name: t.name,
          input: t.input,
        })),
      );
      stop = 'tool_use';
    } else if ('refusal' in current) {
      if (current.text) await w.text(current.text);
      stop = 'refusal';
    } else if ('cut' in current) {
      if (current.text) await w.text(current.text);
      res.end();
      return;
    } else if ('text' in current) await w.text(current.text, current.delayMs);
    if (closed) return;
    w.finish(stop);
    res.end();
  }

  const errorType = (status: number) =>
    status === 429
      ? 'rate_limit_error'
      : status === 529
        ? 'overloaded_error'
        : status >= 500
          ? 'api_error'
          : 'invalid_request_error';

  app.post(`${FAKE_MODEL_PATH}/v1/messages`, async (req, reply) => {
    stats.requests++;
    stats.lastRequest = {
      beta: req.headers['anthropic-beta'] as string | undefined,
      body: req.body,
      wire: 'anthropic',
    };
    const body = req.body as {
      model?: string;
      messages?: WireMessage[];
      tools?: unknown;
      system?: unknown;
      cache_control?: unknown;
    };
    const planned = plan(fromAnthropic(body.messages ?? []));
    const { current } = planned;
    if ('error' in current) {
      const type = errorType(current.error);
      return reply
        .code(current.error)
        .header('x-should-retry', 'false')
        .send({ type: 'error', error: { type, message: `fake ${type}` } });
    }
    const { parts, writeAt } = anthropicCacheParts(body);
    const use = cache.use(`anthropic\n${body.model ?? ''}`, parts, writeAt);
    await play(reply, planned, (out) =>
      anthropicWriter(out, { requests: stats.requests, cache: use }),
    );
  });

  /** F21: the same scripts over the OpenAI-compatible chat-completions wire format. */
  app.post(`${FAKE_OPENAI_PATH}/chat/completions`, async (req, reply) => {
    stats.requests++;
    const convId = req.headers[XAI_CONV_ID_HEADER] as string | undefined;
    stats.lastRequest = { beta: undefined, body: req.body, wire: 'openai', convId };
    const body = req.body as {
      model?: string;
      messages?: OaWireMessage[];
      tools?: unknown;
      stream_options?: { include_usage?: boolean };
    };
    const planned = plan(fromOpenAi(body.messages ?? []));
    const { current } = planned;
    if ('error' in current) {
      const type = errorType(current.error);
      return reply
        .code(current.error)
        .send({ error: { message: `fake ${type}`, type, code: type } });
    }
    // Automatic prefix caching: tools + leading system message, then each message.
    const [first, ...rest] = body.messages ?? [];
    const parts =
      first?.role === 'system'
        ? [{ tools: body.tools ?? [], system: first }, ...rest]
        : [{ tools: body.tools ?? [] }, ...(body.messages ?? [])];
    const use = cache.use(`openai\n${body.model ?? ''}`, parts);
    await play(reply, planned, (out) =>
      openAiWriter(out, {
        requests: stats.requests,
        model: body.model ?? FAKE_OPENAI_MODEL,
        cache: use,
        usage: body.stream_options?.include_usage === true,
      }),
    );
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
