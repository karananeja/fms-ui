import {
  TERMINAL_REQUEST_STATUSES,
  type BreakdownReason,
  type DriverRequest,
  type RequestAction,
  type RequestStatus,
  type RequestType,
} from '@shared/contract/index.ts';

/** F14 display model: labels, colours and the F11 §2 state machine on the client. */

const TERMINAL = new Set<RequestStatus>(TERMINAL_REQUEST_STATUSES);
export const isOpenRequest = (r: Pick<DriverRequest, 'status'>) => !TERMINAL.has(r.status);

export const TYPE_LABEL: Record<RequestType, string> = {
  breakdown: 'Breakdown',
  replacement: 'Replacement',
  rsa: 'Roadside assistance',
};

export const REASON_LABEL: Record<BreakdownReason, string> = {
  'no-gps-device': 'GPS device not working',
  'battery-charging': 'Battery or charging problem',
  tyre: 'Tyre problem',
  accident: 'Accident',
  mechanical: 'Mechanical fault',
  other: 'Other problem',
};

export const STATUS_META: Record<RequestStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--danger)' },
  acknowledged: { label: 'Acknowledged', color: 'var(--warn)' },
  dispatched: { label: 'Dispatched', color: 'var(--accent)' },
  waiting: { label: 'Waiting', color: 'var(--warn)' },
  suggested: { label: 'Suggested', color: 'var(--accent)' },
  approved: { label: 'Approved', color: 'var(--accent)' },
  assigned: { label: 'Assigned', color: 'var(--ok)' },
  resolved: { label: 'Resolved', color: 'var(--ok)' },
  closed: { label: 'Closed', color: 'var(--text-muted)' },
  rejected: { label: 'Rejected', color: 'var(--text-faint)' },
};

/** "What": the breakdown reason, else the note, else the type. */
export function reasonText(r: DriverRequest): string {
  if (r.reason) return REASON_LABEL[r.reason];
  return r.note || TYPE_LABEL[r.type];
}

/** Staff actions per type (mirrors the server's F11 §2 flows; the server stays the judge). */
const FLOWS: Record<RequestType, Partial<Record<RequestAction, readonly RequestStatus[]>>> = {
  breakdown: { acknowledge: ['open'], resolve: ['acknowledged'], close: ['acknowledged'] },
  rsa: {
    acknowledge: ['open'],
    dispatch: ['acknowledged'],
    resolve: ['dispatched'],
    close: ['dispatched'],
  },
  replacement: {
    approve: ['suggested'],
    override: ['open', 'waiting', 'suggested'],
    reject: ['open', 'waiting', 'suggested', 'approved'],
    close: ['open', 'waiting', 'suggested', 'approved'],
  },
};

/** The actions valid for `r` now, in display order. */
export function availableActions(r: Pick<DriverRequest, 'type' | 'status'>): RequestAction[] {
  const flow = FLOWS[r.type];
  return (Object.keys(flow) as RequestAction[]).filter((a) => flow[a]!.includes(r.status));
}

export const ACTION_LABEL: Record<RequestAction, string> = {
  acknowledge: 'Acknowledge',
  dispatch: 'Dispatch RSA',
  resolve: 'Resolve',
  close: 'Close',
  approve: 'Approve',
  override: 'Override',
  reject: 'Reject',
};

/** RSA dispatch form (F14-R2): assignee + ETA minutes (1…1440, the contract's bounds). */
export interface DispatchErrors {
  assignee?: string;
  eta?: string;
}
export function validateDispatch(assignee: string, eta: string): DispatchErrors {
  const errors: DispatchErrors = {};
  if (!assignee.trim()) errors.assignee = 'Enter who is going.';
  const n = Number(eta);
  if (!eta.trim()) errors.eta = 'Enter the ETA in minutes.';
  else if (!Number.isInteger(n) || n < 1 || n > 24 * 60)
    errors.eta = 'ETA must be a whole number of minutes, 1 to 1440.';
  return errors;
}

/** True when the request was assigned by the system (auto-assign, F14-R4). */
export const autoAssigned = (r: DriverRequest) =>
  r.timeline.some((t) => t.status === 'assigned' && t.by === 'system');

/** Timeline entry text: who and what. */
export function timelineText(
  r: DriverRequest,
  i: number,
  meId: string | null,
): { title: string; by: string } {
  const t = r.timeline[i]!;
  const title =
    t.status === 'assigned' && t.by === 'system'
      ? 'Assigned automatically'
      : i === 0
        ? `${TYPE_LABEL[r.type]} reported`
        : STATUS_META[t.status].label;
  const by = t.by === 'system' ? 'System' : t.by === meId ? 'You' : i === 0 ? 'Driver' : 'Operator';
  return { title, by };
}
