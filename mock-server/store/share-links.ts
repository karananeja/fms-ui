import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ShareLink } from '@shared/contract/index.ts';
import type { Clock } from '../clock.ts';
import { HttpError } from '../http-error.ts';
import { token } from './accounts.ts';

export type ShareLinkRecord = Omit<ShareLink, 'url'>;

export const shareUrl = (t: string) => `/share/${t}`;

interface ShareRow {
  id: string;
  token: string;
  vehicle_id: string;
  created_by: string;
  created_at: number;
  expires_at: number;
  show: string;
  trail: string;
  revoked_at: number | null;
}

/**
 * Share links: a write-through cache over `fms.db` (F22). Tokens stay raw because owners are
 * shown their link URLs again (F10, D-138).
 */
export class ShareLinks {
  readonly links = new Map<string, ShareLinkRecord>();
  private readonly insert: StatementSync;
  private readonly revokeStmt: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    this.insert = db.prepare(
      `INSERT INTO share_links (id, token, vehicle_id, created_by, created_at, expires_at, show, trail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.revokeStmt = db.prepare('UPDATE share_links SET revoked_at = ? WHERE id = ?');
  }

  /** (Re)loads every link from the database, oldest first. */
  hydrate(): void {
    this.links.clear();
    for (const r of this.db
      .prepare('SELECT * FROM share_links ORDER BY rowid')
      .all() as unknown as ShareRow[]) {
      this.links.set(r.id, {
        id: r.id,
        token: r.token,
        createdBy: r.created_by,
        createdAt: r.created_at,
        vehicleId: r.vehicle_id,
        expiresAt: r.expires_at,
        show: JSON.parse(r.show) as ShareLink['show'],
        trail: JSON.parse(r.trail) as ShareLink['trail'],
        ...(r.revoked_at === null ? {} : { revokedAt: r.revoked_at }),
      });
    }
  }

  create(
    input: Pick<ShareLink, 'vehicleId' | 'expiresAt' | 'show' | 'trail'>,
    createdBy: string,
  ): ShareLink {
    const now = this.clock.now();
    if (input.expiresAt <= now)
      throw new HttpError(422, 'validation_failed', 'expiresAt must be in the future');
    const link: ShareLinkRecord = {
      id: `sl-${randomUUID()}`,
      token: token(),
      createdBy,
      createdAt: now,
      ...input,
    };
    this.insert.run(
      link.id,
      link.token,
      link.vehicleId,
      link.createdBy,
      link.createdAt,
      link.expiresAt,
      JSON.stringify(link.show),
      JSON.stringify(link.trail),
    );
    this.links.set(link.id, link);
    return this.toDto(link);
  }

  toDto(link: ShareLinkRecord): ShareLink {
    return { ...link, url: shareUrl(link.token) };
  }

  get(id: string): ShareLinkRecord {
    const link = this.links.get(id);
    if (!link) throw new HttpError(404, 'not_found', `Share link ${id} not found`);
    return link;
  }

  byToken(t: string): ShareLinkRecord | undefined {
    for (const link of this.links.values()) if (link.token === t) return link;
    return undefined;
  }

  isLive(link: ShareLinkRecord): boolean {
    return link.revokedAt === undefined && link.expiresAt > this.clock.now();
  }

  /** A live link by token: `404` if unknown, `410` if expired or revoked. */
  open(t: string): ShareLinkRecord {
    const link = this.byToken(t);
    if (!link) throw new HttpError(404, 'not_found', 'Share link not found');
    if (!this.isLive(link))
      throw new HttpError(410, 'gone', 'This share link has expired or was revoked');
    return link;
  }

  revoke(link: ShareLinkRecord): void {
    if (link.revokedAt !== undefined) return;
    link.revokedAt = this.clock.now();
    this.revokeStmt.run(link.revokedAt, link.id);
  }
}
