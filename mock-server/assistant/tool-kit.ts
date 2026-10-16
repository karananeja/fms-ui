import type {
  ChatEvent,
  EntityRef,
  Permission,
  ToolChip,
  User,
  WidgetPreview,
} from '@shared/contract/index.ts';
import type { z } from 'zod';
import type { MockContext } from '../context.ts';
import type { VehicleSim } from '../generator/vehicle-sim.ts';
import type { ReportStore } from './reports.ts';

/**
 * Shared pieces of the assistant tools (F17 read tools, F19 dashboard tools): the host a tool
 * runs in, model-visible failures and the in-scope lookups.
 */

/** A model-visible tool failure ("not found", "not permitted", bad input). */
export class ToolFailure extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'not_permitted' | 'invalid' = 'invalid',
  ) {
    super(message);
  }
}
export const notFound = (what: string) =>
  new ToolFailure(`${what} was not found among the data you can access.`, 'not_found');
export const notPermitted = (what: string) =>
  new ToolFailure(`Not permitted: your role does not allow ${what}.`, 'not_permitted');

export interface ApiResult {
  status: number;
  body: unknown;
}

/** F19: which chat a tool runs in (the tool definitions are the same for both). */
export type ChatMode = { kind: 'global' } | { kind: 'dashboard'; dashboardId: string };

/** F19: what the tools of one turn did (chips, the turn's change set, created dashboards). */
export interface TurnState {
  /** Every tool call of the turn, in order (stored with the assistant message, ≤ 50). */
  chips: ToolChip[];
  /** The turn's latest change set (dashboard chat). */
  changeId?: string;
  /** Labels of the current change set (its summary). */
  labels: string[];
  /** Successful mutating calls this turn. */
  mutations: number;
  /** Dashboards made by `create_dashboard`. */
  created: { id: string; chip: ToolChip }[];
  /** D-135: previews made by `preview_widget` (stored on the assistant message). */
  previews: WidgetPreview[];
}

export const newTurnState = (): TurnState => ({
  chips: [],
  labels: [],
  mutations: 0,
  created: [],
  previews: [],
});

/** What a tool run may touch: the caller, in-process API access and the event stream. */
export interface ToolHost {
  ctx: MockContext;
  user: User;
  permissions: readonly Permission[];
  /** `GET` an API path in-process as the user (session cookie). */
  api: (path: string) => Promise<ApiResult>;
  reports: ReportStore;
  emit: (event: ChatEvent) => void;
  /** Vehicles/drivers seen in tool results, linked if their label shows up in the answer. */
  entities: Map<string, EntityRef>;
  logError: (err: unknown) => void;
  /** F19: defaults to the global chat. */
  mode?: ChatMode;
  /** F28/F29: the saved global conversation of this turn (action cards link to it). */
  threadId?: string;
  /** F19: defaults to a fresh state per `buildTools`. */
  turn?: TurnState;
}

export const has = (host: ToolHost, ...perms: Permission[]) =>
  perms.some((p) => host.permissions.includes(p));

const regnoIndex = new WeakMap<VehicleSim, Map<string, number>>();
export const normRegno = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');

export function vehicleByRegno(sim: VehicleSim, regno: string): number {
  let index = regnoIndex.get(sim);
  if (!index) {
    index = new Map();
    for (let i = 0; i < sim.count; i++) index.set(sim.regno(i), i);
    regnoIndex.set(sim, index);
  }
  return index.get(normRegno(regno)) ?? -1;
}

/** Vehicle index by regno or id, in the user's scope (out of scope = not found). */
export function resolveVehicle(
  host: ToolHost,
  ref: { regno?: string; vehicleId?: string },
): number {
  const { sim, tree } = host.ctx;
  const label = ref.regno ?? ref.vehicleId;
  if (!label) throw new ToolFailure('Give a regno or a vehicleId.');
  const i =
    ref.regno !== undefined ? vehicleByRegno(sim, ref.regno) : sim.indexOf(ref.vehicleId ?? '');
  if (i < 0 || !tree.inScope(sim.fleetId(i), host.user.fleetIds))
    throw notFound(`Vehicle ${label}`);
  return i;
}

/** Fleet id by name or id, in the user's scope. */
export function resolveFleet(host: ToolHost, fleet: string | undefined): string | undefined {
  if (fleet === undefined || fleet.trim() === '') return undefined;
  const { tree } = host.ctx;
  const q = fleet.trim().toLowerCase();
  for (const node of tree.nodes) {
    if (!node || (node.id.toLowerCase() !== q && node.name.toLowerCase() !== q)) continue;
    if (tree.inScope(node.id, host.user.fleetIds)) return node.id;
  }
  throw notFound(`Fleet "${fleet}"`);
}

export interface ToolOutput {
  result: unknown;
  summary: string;
  /** Chip text when it differs from the start label (F19 change chips). */
  chip?: string;
}

export interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  label: (input: z.infer<S>) => string;
  run: (host: ToolHost, input: z.infer<S>) => Promise<ToolOutput>;
  /**
   * F19: validate the input inside `run` (so a bad widget becomes a chip + `is_error` result
   * with the zod paths) and send a strict-mode-safe JSON schema.
   */
  validateInRun?: boolean;
}

export const spec = <S extends z.ZodType>(s: ToolSpec<S>) => s;
