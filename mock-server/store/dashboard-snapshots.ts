import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MIME_TYPES,
  type DashboardSnapshot,
  type SnapshotTheme,
} from '@shared/contract/index.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../clock.ts';
import { HttpError } from '../http-error.ts';

export type SnapshotMime = (typeof SNAPSHOT_MIME_TYPES)[number];

export interface SnapshotImage {
  mime: SnapshotMime;
  image: Uint8Array;
  theme: SnapshotTheme;
  capturedAt: number;
}

interface Row {
  dashboard_id: string;
  theme: SnapshotTheme;
  mime: SnapshotMime;
  image: Uint8Array;
  captured_at: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when the bytes start like the claimed type (RIFF…WEBP or the PNG signature). */
export function looksLike(mime: SnapshotMime, b: Uint8Array): boolean {
  if (mime === 'image/png') return PNG_SIG.every((x, k) => b[k] === x);
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  return b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}

export const snapshotUrl = (dashboardId: string, capturedAt: number) =>
  `/api/dashboards/${encodeURIComponent(dashboardId)}/snapshot?v=${capturedAt}`;

/**
 * D-142: one list-card snapshot per (dashboard, user). Access checks live in `Dashboards`;
 * rows go with their dashboard (FK cascade) and with a revoked share (`Dashboards.revokeShare`).
 */
export class DashboardSnapshots {
  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
  ) {}

  /** The user's snapshots for these dashboards (one query). */
  metaFor(userId: string, dashboardIds: readonly string[]): Map<string, DashboardSnapshot> {
    const out = new Map<string, DashboardSnapshot>();
    if (!dashboardIds.length) return out;
    const rows = this.db
      .prepare(
        'SELECT dashboard_id, theme, captured_at FROM dashboard_snapshots WHERE user_id = ?',
      )
      .all(userId) as unknown as Pick<Row, 'dashboard_id' | 'theme' | 'captured_at'>[];
    const wanted = new Set(dashboardIds);
    for (const r of rows)
      if (wanted.has(r.dashboard_id))
        out.set(r.dashboard_id, {
          url: snapshotUrl(r.dashboard_id, r.captured_at),
          capturedAt: r.captured_at,
          theme: r.theme,
        });
    return out;
  }

  get(dashboardId: string, userId: string): SnapshotImage | undefined {
    const r = this.db
      .prepare(
        'SELECT dashboard_id, theme, mime, image, captured_at FROM dashboard_snapshots WHERE dashboard_id = ? AND user_id = ?',
      )
      .get(dashboardId, userId) as Row | undefined;
    return r && { mime: r.mime, image: r.image, theme: r.theme, capturedAt: r.captured_at };
  }

  put(
    dashboardId: string,
    userId: string,
    mime: SnapshotMime,
    image: Uint8Array,
    theme: SnapshotTheme,
  ): DashboardSnapshot {
    if (image.byteLength > SNAPSHOT_MAX_BYTES)
      throw new HttpError(413, 'payload_too_large', 'A snapshot can be at most 120 KB');
    if (!looksLike(mime, image))
      throw new HttpError(422, 'validation_failed', `The body is not a ${mime} image`);
    const now = this.clock.now();
    this.db
      .prepare(
        `INSERT INTO dashboard_snapshots (dashboard_id, user_id, theme, mime, image, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (dashboard_id, user_id) DO UPDATE SET
           theme = excluded.theme, mime = excluded.mime, image = excluded.image,
           captured_at = excluded.captured_at`,
      )
      .run(dashboardId, userId, theme, mime, image, now);
    return { url: snapshotUrl(dashboardId, now), capturedAt: now, theme };
  }

  remove(dashboardId: string, userId: string): void {
    this.db
      .prepare('DELETE FROM dashboard_snapshots WHERE dashboard_id = ? AND user_id = ?')
      .run(dashboardId, userId);
  }
}
