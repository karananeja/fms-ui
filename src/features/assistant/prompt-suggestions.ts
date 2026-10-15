import type { Permission } from '@shared/contract/permissions.ts';

/**
 * F23 type-ahead: curated prompt templates matched on words as the user types (client-side, no
 * model call), plus vehicle / fleet completion of the word being typed.
 */
export type SuggestionScope = 'global' | 'dashboard';

export interface PromptTemplate {
  id: string;
  text: string;
  /** Extra words that should find it (synonyms). */
  keywords: readonly string[];
  /** Every permission it needs (the answer's data). */
  needs: readonly Permission[];
  scopes: readonly SuggestionScope[];
}

const BOTH = ['global', 'dashboard'] as const;
const DASH = ['dashboard'] as const;
const GLOBAL = ['global'] as const;

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  // Live ops
  { id: 'running-status', text: 'Show running, idle and stopped vehicles by status', keywords: ['live', 'status', 'moving', 'breakdown', 'donut'], needs: ['live.view'], scopes: BOTH },
  { id: 'no-gps', text: 'Which vehicles have no GPS right now?', keywords: ['gps', 'signal', 'offline', 'lost'], needs: ['live.view'], scopes: BOTH },
  { id: 'running-kpi', text: 'Add a KPI of running vehicles', keywords: ['count', 'number', 'tile', 'live'], needs: ['live.view'], scopes: DASH },
  { id: 'low-battery', text: 'List vehicles with battery below 20%', keywords: ['soc', 'ev', 'charge', 'charging', 'low'], needs: ['live.view'], scopes: BOTH },
  { id: 'charging', text: 'How many vehicles are charging right now?', keywords: ['ev', 'battery', 'charger'], needs: ['live.view'], scopes: BOTH },
  { id: 'immobilized', text: 'Show immobilized vehicles with their location', keywords: ['locked', 'blocked', 'immobilised'], needs: ['live.view'], scopes: BOTH },
  // Performance
  { id: 'utilisation', text: 'Summarise fleet utilisation for the last 7 days', keywords: ['utilization', 'usage', 'week', 'performance'], needs: ['analytics.view'], scopes: BOTH },
  { id: 'top-idle', text: 'Top 10 vehicles by idle time this week', keywords: ['idle', 'ranking', 'worst', 'idling'], needs: ['analytics.view'], scopes: BOTH },
  { id: 'distance-chart', text: 'Daily distance driven over the last 30 days', keywords: ['km', 'kilometres', 'mileage', 'chart', 'trend'], needs: ['analytics.view'], scopes: BOTH },
  { id: 'energy-chart', text: 'Daily energy used over the last 30 days', keywords: ['kwh', 'consumption', 'fuel', 'chart', 'ev'], needs: ['analytics.view'], scopes: BOTH },
  // Drivers
  { id: 'top-drivers', text: 'Who are the top drivers this week?', keywords: ['best', 'score', 'ranking', 'performance'], needs: ['analytics.view'], scopes: BOTH },
  { id: 'driver-list', text: 'List drivers on duty', keywords: ['active', 'shift', 'available', 'roster'], needs: ['drivers.manage'], scopes: BOTH },
  // Requests
  { id: 'open-requests', text: 'Show open breakdown requests', keywords: ['tickets', 'issues', 'service', 'repair', 'breakdowns'], needs: ['requests.manage'], scopes: BOTH },
  { id: 'requests-by-type', text: 'Summarise requests by type this week', keywords: ['tickets', 'service', 'count'], needs: ['requests.manage'], scopes: BOTH },
  // Reports / dashboards
  { id: 'export-no-gps', text: 'Export no-GPS vehicles as CSV', keywords: ['download', 'report', 'csv', 'excel'], needs: ['live.view'], scopes: GLOBAL },
  { id: 'build-overview', text: 'Build a dashboard of running vs stopped and top idle vehicles', keywords: ['create', 'new', 'overview', 'dashboard'], needs: ['dashboards.use', 'analytics.view'], scopes: GLOBAL },
  { id: 'add-note', text: 'Add a note widget with today’s shift handover', keywords: ['text', 'note', 'memo'], needs: [], scopes: DASH },
];

export interface Suggestion {
  id: string;
  kind: 'prompt' | 'vehicle' | 'fleet';
  /** What the list shows. */
  label: string;
  /** The box's whole text after accepting. */
  insert: string;
  /** `[start, end)` of `label` to highlight. */
  match: readonly [number, number] | null;
  /** Small right-hand hint ("Vehicle", "Fleet"). */
  hint?: string;
}

export const SUGGESTION_LIMIT = 5;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);

/** Templates whose words (or keywords) start with every typed word, best first. */
export function matchPrompts(
  input: string,
  templates: readonly PromptTemplate[],
  limit = SUGGESTION_LIMIT,
): Suggestion[] {
  const typed = words(input);
  if (!typed.length || input.trim().length < 2) return [];
  const scored: { t: PromptTemplate; score: number }[] = [];
  for (const t of templates) {
    if (t.text.toLowerCase() === input.trim().toLowerCase()) return [];
    const own = words(t.text);
    const extra = t.keywords.flatMap(words);
    let score = 0;
    let ok = true;
    for (const w of typed) {
      if (own.some((o) => o.startsWith(w))) score += 2;
      else if (extra.some((o) => o.startsWith(w))) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) {
      if (t.text.toLowerCase().startsWith(input.trim().toLowerCase())) score += 3;
      scored.push({ t, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ t }) => ({
      id: `prompt:${t.id}`,
      kind: 'prompt',
      label: t.text,
      insert: t.text,
      match: highlight(t.text, typed),
    }));
}

/** The longest typed word found at a word start in `label`. */
export function highlight(label: string, typed: readonly string[]): [number, number] | null {
  const lower = label.toLowerCase();
  let best: [number, number] | null = null;
  for (const w of [...typed].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const m = re.exec(lower);
    if (m) {
      const start = m.index + m[1]!.length;
      best = [start, start + w.length];
      break;
    }
  }
  return best;
}

/** The word being typed at the end of the box (for entity completion). */
export function lastToken(input: string): { token: string; start: number } {
  const m = /(\S+)$/.exec(input);
  return m ? { token: m[1]!, start: m.index } : { token: '', start: input.length };
}

/** A token that looks like a regno / VIN fragment (has a digit, 3+ chars). */
export const looksLikeVehicle = (token: string) => token.length >= 3 && /\d/.test(token);

export function entitySuggestions(
  input: string,
  vehicles: readonly { vehicleId: string; regno: string; vin: string }[],
  fleets: readonly { id: string; name: string }[],
): Suggestion[] {
  const { token, start } = lastToken(input);
  if (token.length < 2) return [];
  const t = token.toLowerCase();
  const head = input.slice(0, start);
  const out: Suggestion[] = [];
  for (const v of vehicles) {
    const label = v.regno.toLowerCase().includes(t) ? v.regno : v.vin;
    const at = label.toLowerCase().indexOf(t);
    if (at < 0 || label === token) continue;
    out.push({
      id: `vehicle:${v.vehicleId}`,
      kind: 'vehicle',
      label,
      insert: `${head}${label} `,
      match: [at, at + t.length],
      hint: 'Vehicle',
    });
  }
  for (const f of fleets) {
    // Fleets complete on a word start only (short tokens would match too much otherwise).
    const match = highlight(f.name, [t]);
    if (!match || f.name.toLowerCase() === t) continue;
    out.push({
      id: `fleet:${f.id}`,
      kind: 'fleet',
      label: f.name,
      insert: `${head}${f.name} fleet `,
      match,
      hint: 'Fleet',
    });
  }
  return out.slice(0, 3);
}

/** Entities first (they complete the word being typed), then prompt templates; ≤ 5. */
export function mergeSuggestions(entities: Suggestion[], prompts: Suggestion[]): Suggestion[] {
  return [...entities, ...prompts].slice(0, SUGGESTION_LIMIT);
}
