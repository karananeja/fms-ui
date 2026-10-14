import type { Assignment } from '@shared/contract/index.ts';
import { useEffect, useSyncExternalStore } from 'react';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { driverAssignments } from '../api/drivers-api';
import { subscribeAssignmentEvents } from '../use-assignment-events';

export interface CurrentAssignment {
  assignment: Assignment;
  regno: string;
}

/** Requests in flight at once (rows load as they scroll into view). */
const CONCURRENCY = 6;
const MAX_ENTRIES = 2000;

/**
 * F12-R1 "current vehicle / since": the F11 driver list carries no assignment, so the drivers
 * page asks `GET /api/assignments?driverId` for the rows on screen only, cached per driver and
 * dropped on any `assignment` event for that driver.
 */
export class CurrentAssignments {
  private readonly cache = new Map<string, CurrentAssignment | null>();
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private active = 0;
  private version = 0;
  private offEvents: (() => void) | null = null;

  constructor(
    private readonly load: (driverId: string) => Promise<Assignment[]> = (id) =>
      driverAssignments(id),
    private readonly regnoOf: (vehicleId: string) => Promise<string | null> = async (id) =>
      (await liveTrackingStore.vehicleSummary(id).catch(() => null))?.regno ?? null,
  ) {}

  /** `undefined` while loading; `null` when the driver has no vehicle. */
  get(driverId: string): CurrentAssignment | null | undefined {
    return this.cache.get(driverId);
  }

  /** Queues the drivers not cached yet. */
  request(driverIds: readonly string[]): void {
    for (const id of driverIds) {
      if (this.cache.has(id) || this.queued.has(id)) continue;
      this.queued.add(id);
      this.queue.push(id);
    }
    this.pump();
  }

  /** Drops a driver's entry (and reloads it if it is still on screen). */
  invalidate(driverId: string): void {
    if (!this.cache.delete(driverId)) return;
    this.emit();
  }

  /** Overrides an entry after a local mutation. */
  set(driverId: string, value: CurrentAssignment | null): void {
    this.cache.set(driverId, value);
    this.emit();
  }

  clear(): void {
    this.cache.clear();
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.offEvents ??= subscribeAssignmentEvents((a) => this.invalidate(a.driverId));
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.offEvents?.();
        this.offEvents = null;
      }
    };
  };

  getVersion = (): number => this.version;

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.active++;
      void this.fetch(id).finally(() => {
        this.active--;
        this.queued.delete(id);
        this.pump();
      });
    }
  }

  private async fetch(driverId: string): Promise<void> {
    try {
      const list = await this.load(driverId);
      const open = list.find((a) => a.to === null) ?? null;
      const regno = open ? ((await this.regnoOf(open.vehicleId)) ?? open.vehicleId) : '';
      if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
      this.cache.set(driverId, open && { assignment: open, regno });
    } catch {
      this.cache.set(driverId, null);
    }
    this.emit();
  }

  private emit(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }
}

export const currentAssignments = new CurrentAssignments();

/** Loads the given drivers' current assignments; re-renders as they arrive. */
export function useCurrentAssignments(
  driverIds: readonly string[],
  store: CurrentAssignments = currentAssignments,
): CurrentAssignments {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const key = driverIds.join(',');
  useEffect(() => {
    if (key) store.request(key.split(','));
  });
  return store;
}
