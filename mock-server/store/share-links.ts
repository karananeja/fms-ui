import { randomUUID } from 'node:crypto';
import type { ShareLink } from '@shared/contract/index.ts';
import type { Clock } from '../clock.ts';
import { HttpError } from '../http-error.ts';
import { token } from './accounts.ts';

export type ShareLinkRecord = Omit<ShareLink, 'url'>;

export const shareUrl = (t: string) => `/share/${t}`;

export class ShareLinks {
  readonly links = new Map<string, ShareLinkRecord>();

  constructor(private readonly clock: Clock) {}

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
    link.revokedAt ??= this.clock.now();
  }
}
