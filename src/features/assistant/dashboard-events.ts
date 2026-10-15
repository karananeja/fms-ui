/**
 * F19 §7: a tiny in-page bus for "a dashboard was created / changed". The global Ask FMS store
 * and the dashboard chat publish; F20's list page subscribes to refetch.
 */
export interface DashboardEvent {
  kind: 'created' | 'changed';
  dashboardId: string;
}

type Listener = (e: DashboardEvent) => void;

const listeners = new Set<Listener>();

export const dashboardEvents = {
  emit(e: DashboardEvent): void {
    for (const l of [...listeners]) l(e);
  },
  /** Returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
