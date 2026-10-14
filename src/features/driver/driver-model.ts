import {
  TERMINAL_REQUEST_STATUSES,
  type BreakdownReason,
  type DriverRequest,
  type GeoPoint,
  type RequestStatus,
  type RequestType,
  type TimelineEntry,
} from '@shared/contract/index.ts';

export const NOTE_MAX = 280;
/** Closed requests shown under the open ones (F13-R4). */
export const CLOSED_SHOWN = 10;

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  breakdown: 'Breakdown',
  replacement: 'Replacement',
  rsa: 'Roadside assistance',
};

export const REASON_LABEL: Record<BreakdownReason, { label: string; hint: string }> = {
  'no-gps-device': { label: 'GPS device fault', hint: 'Tracker not working' },
  'battery-charging': { label: 'Battery / charging', hint: 'Won’t charge or flat' },
  tyre: { label: 'Tyre', hint: 'Puncture or damage' },
  accident: { label: 'Accident', hint: 'Collision or damage' },
  mechanical: { label: 'Mechanical', hint: 'Engine, brakes, other parts' },
  other: { label: 'Other', hint: 'Describe it in the note' },
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  dispatched: 'Dispatched',
  waiting: 'Waiting',
  suggested: 'Vehicle found',
  approved: 'Approved',
  assigned: 'Assigned',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Rejected',
};

export const STATUS_COLOR: Record<RequestStatus, string> = {
  open: 'var(--warn)',
  acknowledged: 'var(--accent)',
  dispatched: 'var(--accent)',
  waiting: 'var(--warn)',
  suggested: 'var(--accent)',
  approved: 'var(--accent)',
  assigned: 'var(--ok)',
  resolved: 'var(--ok)',
  closed: 'var(--text-faint)',
  rejected: 'var(--danger)',
};

const terminal = new Set<RequestStatus>(TERMINAL_REQUEST_STATUSES);
export const isOpen = (r: DriverRequest) => !terminal.has(r.status);

/** Open requests (newest first), then the last `CLOSED_SHOWN` closed ones. */
export function orderRequests(list: readonly DriverRequest[]): DriverRequest[] {
  const byNew = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  return [...byNew.filter(isOpen), ...byNew.filter((r) => !isOpen(r)).slice(0, CLOSED_SHOWN)];
}

/** Inserts or replaces one request by id. */
export function mergeRequest(list: readonly DriverRequest[], r: DriverRequest): DriverRequest[] {
  const i = list.findIndex((x) => x.id === r.id);
  if (i < 0) return [r, ...list];
  if (list[i]!.updatedAt > r.updatedAt) return list as DriverRequest[];
  const next = list.slice();
  next[i] = r;
  return next;
}

/** The open request of `type`, if any (one per type, F11). */
export const openOfType = (list: readonly DriverRequest[], type: RequestType) =>
  list.find((r) => r.type === type && isOpen(r)) ?? null;

/** One line per timeline step, e.g. "RSA dispatched: Suresh, ETA 30 min". */
export function stepText(r: DriverRequest, e: TimelineEntry): string {
  if (e.status === 'dispatched' && r.rsa)
    return `RSA dispatched: ${r.rsa.assignee}, ETA ${r.rsa.etaMinutes} min`;
  if (e.status === 'open') return `${REQUEST_TYPE_LABEL[r.type]} reported`;
  if (e.status === 'assigned' && e.by === 'system') return 'Replacement assigned automatically';
  if (e.status === 'assigned') return 'Replacement assigned';
  if (e.status === 'waiting') return 'Looking for a replacement vehicle';
  if (e.status === 'suggested') return 'Replacement vehicle found';
  return STATUS_LABEL[e.status];
}

/** What the driver needs on top of reporting the problem (D-109). */
export interface HelpNeeded {
  rsa: boolean;
  replacement: boolean;
}

/** Suggested help per reason (the driver can change it): accidents need both, a GPS fault neither. */
export const SUGGESTED_HELP: Record<BreakdownReason, HelpNeeded> = {
  'no-gps-device': { rsa: false, replacement: false },
  'battery-charging': { rsa: true, replacement: false },
  tyre: { rsa: true, replacement: false },
  accident: { rsa: true, replacement: true },
  mechanical: { rsa: true, replacement: false },
  other: { rsa: false, replacement: false },
};

export interface ReportValues {
  reason: BreakdownReason | null;
  note: string;
}

/** Step 1 validation: a reason is required; the note is at most `NOTE_MAX` characters. */
export function validateReport(v: ReportValues): { reason?: string; note?: string } {
  const e: { reason?: string; note?: string } = {};
  if (!v.reason) e.reason = 'Choose what happened.';
  if (v.note.length > NOTE_MAX) e.note = `Keep the note under ${NOTE_MAX} characters.`;
  return e;
}

/** The requests one report sends, in order: the breakdown first, then the help asked for. */
export function plannedRequests(help: HelpNeeded): RequestType[] {
  return [
    'breakdown',
    ...(help.rsa ? ['rsa' as const] : []),
    ...(help.replacement ? ['replacement' as const] : []),
  ];
}

/** Requests created within this window of an incident's first one belong to it. */
export const INCIDENT_WINDOW_MS = 30 * 60_000;

/** One problem as the driver sees it: a breakdown and the help requested for it (D-109). */
export interface Incident {
  /** The first request's id. */
  id: string;
  requests: DriverRequest[];
  breakdown: DriverRequest | null;
  rsa: DriverRequest | null;
  replacement: DriverRequest | null;
  open: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Groups requests into incidents (F11 has no incident id): a request joins the latest incident
 * that has no request of its type yet, started within `INCIDENT_WINDOW_MS`, and is still open
 * (or was created alongside it). Otherwise it starts a new one.
 */
export function groupIncidents(list: readonly DriverRequest[]): Incident[] {
  const byOld = [...list].sort((a, b) => a.createdAt - b.createdAt);
  const groups: DriverRequest[][] = [];
  for (const r of byOld) {
    const g = groups.at(-1);
    const fits =
      g &&
      !g.some((x) => x.type === r.type) &&
      r.createdAt - g[0]!.createdAt <= INCIDENT_WINDOW_MS &&
      (g.some(isOpen) || r.createdAt - g[0]!.createdAt <= 60_000);
    if (fits) g.push(r);
    else groups.push([r]);
  }
  return groups.map((requests) => {
    const of = (t: RequestType) => requests.find((r) => r.type === t) ?? null;
    return {
      id: requests[0]!.id,
      requests,
      breakdown: of('breakdown'),
      rsa: of('rsa'),
      replacement: of('replacement'),
      open: requests.some(isOpen),
      createdAt: requests[0]!.createdAt,
      updatedAt: Math.max(...requests.map((r) => r.updatedAt)),
    };
  });
}

/** Open incidents first (newest first), then the last `CLOSED_SHOWN` closed ones. */
export function orderIncidents(list: readonly DriverRequest[]): Incident[] {
  const all = groupIncidents(list).sort((a, b) => b.updatedAt - a.updatedAt);
  return [...all.filter((i) => i.open), ...all.filter((i) => !i.open).slice(0, CLOSED_SHOWN)];
}

export interface IncidentStep {
  key: string;
  at: number;
  type: RequestType;
  status: RequestStatus;
  text: string;
  note?: string;
}

const PART: Record<RequestType, string> = {
  breakdown: 'Problem',
  rsa: 'Roadside help',
  replacement: 'Replacement',
};

/** Every request's steps on one timeline, oldest first, each line naming its part. */
export function incidentSteps(incident: Incident): IncidentStep[] {
  const steps: IncidentStep[] = [];
  for (const r of incident.requests)
    r.timeline.forEach((e, k) => {
      let text = stepText(r, e);
      if (e.status === 'open')
        text = r.type === 'breakdown' ? 'Problem reported' : `${PART[r.type]} requested`;
      else if (['acknowledged', 'resolved', 'closed', 'rejected'].includes(e.status))
        text = `${PART[r.type]} ${STATUS_LABEL[e.status].toLowerCase()}`;
      steps.push({
        key: `${r.id}-${k}`,
        at: e.at,
        type: r.type,
        status: e.status,
        text,
        ...(e.note && !(k === 0 && e.note === r.note) && { note: e.note }),
      });
    });
  return steps.sort((a, b) => a.at - b.at);
}

/** One-line state for the incident header. */
export function incidentSummary(i: Incident): string {
  if (!i.open) return 'Resolved';
  if (i.replacement?.status === 'assigned') return 'Replacement vehicle assigned';
  if (i.rsa?.status === 'dispatched' && i.rsa.rsa)
    return `Help on the way · ETA ${i.rsa.rsa.etaMinutes} min`;
  if (i.replacement && ['suggested', 'approved'].includes(i.replacement.status))
    return 'Replacement vehicle found';
  if (i.requests.some((r) => r.status === 'acknowledged')) return 'Operator is on it';
  if (i.replacement?.status === 'waiting') return 'Looking for a replacement vehicle';
  return 'Waiting for your operator';
}

/** Browser position, or `null` on denial / timeout / no support (D-100: the server then uses the vehicle's fix). */
export function currentPosition(timeoutMs = 8000): Promise<GeoPoint | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
