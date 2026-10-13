import type { ClientMessage, ServerMessage } from '@shared/contract/index.ts';
import { COMBINFO_DELTA_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import type { SocketLike } from '../ws-client.ts';

/** In-memory socket driven by the test (server side = the test). */
export class FakeSocket implements SocketLike {
  readonly sent: ClientMessage[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  message(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number): void {
    this.onclose?.({ code });
  }
}

export function fakeSockets() {
  const sockets: FakeSocket[] = [];
  const create = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return { sockets, create, last: () => sockets.at(-1)! };
}

const BASE_T = 1_760_000_000_000;

/** A fleet `combinfo` snapshot row for vehicle `n`, in `COMBINFO_SNAPSHOT_FIELDS` order. */
export function snapshotRow(n: number, over: Record<string, unknown> = {}): unknown[] {
  const v: Record<string, unknown> = {
    vehicleId: `v${n}`,
    deviceId: `d${n}`,
    regno: `KA01AB${String(n).padStart(4, '0')}`,
    vin: `VIN${n}`,
    fleetId: `f${n % 2}`,
    assetType: 'Bus',
    fuelType: 'Electric',
    make: 'Make',
    model: 'Model',
    variant: 'V1',
    lat: 12 + n / 1000,
    lng: 77 + n / 1000,
    speed: 10,
    heading: 90,
    ignstatus: 1,
    carbattery: 12.5,
    devbattery: 4.1,
    fixquality: 1,
    utctime: BASE_T,
    gpstime: BASE_T,
    canutctime: BASE_T,
    soc: 80,
    dte: 120,
    odometer: 1000,
    immobilization_status: 0,
    ...over,
  };
  return COMBINFO_SNAPSHOT_FIELDS.map((f) => v[f]);
}

/** A fleet `combinfo` live-field delta row for vehicle `n`. */
export function deltaRow(n: number, over: Record<string, unknown> = {}): unknown[] {
  const full = snapshotRow(n, over);
  return COMBINFO_DELTA_FIELDS.map(
    (f) => full[(COMBINFO_SNAPSHOT_FIELDS as readonly string[]).indexOf(f)],
  );
}

export { BASE_T };
