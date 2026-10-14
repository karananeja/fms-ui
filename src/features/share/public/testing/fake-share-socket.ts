import type { ShareSocketLike } from '../share-socket';

export interface FakeShareSocket extends ShareSocketLike {
  url: string;
  sent: unknown[];
  closed: boolean;
  /** Server side: open, push a message, close with a code. */
  open(): void;
  push(msg: unknown): void;
  serverClose(code: number): void;
}

/** In-memory sockets for share-socket / page tests. */
export function fakeShareSockets() {
  const sockets: FakeShareSocket[] = [];
  const create = (url: string): ShareSocketLike => {
    const s: FakeShareSocket = {
      url,
      sent: [],
      closed: false,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data) {
        s.sent.push(JSON.parse(data));
      },
      close() {
        s.closed = true;
      },
      open() {
        s.onopen?.();
      },
      push(msg) {
        s.onmessage?.({ data: JSON.stringify(msg) });
      },
      serverClose(code) {
        s.closed = true;
        s.onclose?.({ code });
      },
    };
    sockets.push(s);
    return s;
  };
  return { sockets, create, last: () => sockets[sockets.length - 1]! };
}

/** A minimal redacted `combinfo` payload (location-only shape unless extras are given). */
export function combinfo(gpstime: number, extra: Record<string, unknown> = {}) {
  return {
    vehicleid: 'v_in_1',
    regno: 'KA01AB1234',
    latitude: 12.97 + gpstime / 1e9,
    longitude: 77.59,
    gpstime,
    heading: 90,
    ignstatus: 1,
    parsedcandata: { immobilization_status: { pidvalue: 0, valtype: 0, timestamp: gpstime } },
    ...extra,
  };
}
