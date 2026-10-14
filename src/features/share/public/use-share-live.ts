import type { RedactedCombinfo } from '@shared/contract/payloads.ts';
import type { PublicShare } from '@shared/contract/share-links.ts';
import { useEffect, useState } from 'react';
import { getPublicTrail, type TrailPoint } from './public-share-api';
import { appendTrail, isMoving } from './share-live-model';
import { ShareSocket, type ShareConnection, type ShareSocketOptions } from './share-socket';

export interface ShareLive {
  connection: ShareConnection;
  latest: RedactedCombinfo | null;
  /** `null` until known (location-only links need two positions). */
  moving: boolean | null;
  /** `null` when the link has no trail. */
  trail: TrailPoint[] | null;
  serverOffsetMs: number;
}

const initial = (share: PublicShare): ShareLive => ({
  connection: 'connecting',
  latest: null,
  moving: null,
  trail: share.options.trail.enabled ? [] : null,
  serverOffsetMs: 0,
});

/**
 * F10-R9/R10: the public page's live state. One `ShareSocket` (combinfo only) plus, when the
 * link has a trail, one trail fetch merged with the live points. No trail request otherwise.
 */
export function useShareLive(
  token: string,
  share: PublicShare,
  socketOptions?: Partial<ShareSocketOptions>,
): ShareLive {
  const [live, setLive] = useState(() => initial(share));
  const { vehicleId } = share;
  const { enabled, windowMinutes } = share.options.trail;

  useEffect(() => {
    const windowMs = windowMinutes * 60_000;
    const socket = new ShareSocket({ token, vehicleId, ...socketOptions });
    const abort = new AbortController();
    let state: ShareLive = {
      connection: 'connecting',
      latest: null,
      moving: null,
      trail: enabled ? [] : null,
      serverOffsetMs: 0,
    };
    const emit = (patch: Partial<ShareLive>) => {
      state = { ...state, ...patch };
      setLive(state);
    };

    const off = socket.subscribe(() => {
      const snap = socket.getSnapshot();
      const patch: Partial<ShareLive> = {
        connection: snap.connection,
        serverOffsetMs: snap.serverOffsetMs,
      };
      const next = snap.latest;
      if (next && next !== state.latest) {
        if (!state.latest || next.gpstime !== state.latest.gpstime)
          patch.moving = isMoving(state.latest, next);
        patch.latest = next;
        if (state.trail)
          patch.trail = appendTrail(
            state.trail,
            [next.longitude, next.latitude, next.gpstime],
            windowMs,
          );
      }
      emit(patch);
    });
    socket.start();

    if (enabled) {
      getPublicTrail(token, abort.signal).then(
        (points) => {
          const last = points[points.length - 1]?.[2] ?? -Infinity;
          let merged = points;
          for (const p of state.trail ?? [])
            if (p[2] > last) merged = appendTrail(merged, p, windowMs);
          emit({ trail: merged });
        },
        () => {
          /* 410 or network: the socket's close (or the expiry timer) handles unavailability */
        },
      );
    }

    return () => {
      abort.abort();
      off();
      socket.dispose();
    };
    // socketOptions is a test seam, read once per connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, vehicleId, enabled, windowMinutes]);

  return live;
}
