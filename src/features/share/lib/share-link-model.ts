import { SHARE_GROUP_KEYS, type ShareLink } from '@shared/contract/index.ts';

export type ShareGroup = keyof typeof SHARE_GROUP_KEYS;
export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

type GroupKey = {
  [G in ShareGroup]:
    | (typeof SHARE_GROUP_KEYS)[G]['combinfo'][number]
    | (typeof SHARE_GROUP_KEYS)[G]['parsedcandata'][number];
}[ShareGroup];

/** Readable names of the keys each group reveals (a new contract key fails the type check). */
const KEY_LABEL: Record<GroupKey, string> = {
  speed: 'speed',
  soc: 'SOC',
  dte: 'range',
  odometer: 'odometer',
  current: 'current',
  engine_speed: 'motor speed',
  motor_temperature: 'motor temp',
  vehicle_mode_status: 'drive mode',
  rxdbm: 'signal',
  devbattery: 'device battery',
  carbattery: 'car battery',
  deviceid: 'device ID',
};

/** Display order inside each group's description (most useful first). */
const ORDER: Record<ShareGroup, readonly GroupKey[]> = {
  drivingEnergy: [
    'speed',
    'soc',
    'dte',
    'odometer',
    'current',
    'engine_speed',
    'motor_temperature',
    'vehicle_mode_status',
  ],
  device: ['rxdbm', 'devbattery', 'carbattery', 'deviceid'],
};

export const GROUP_LABEL: Record<ShareGroup, string> = {
  drivingEnergy: 'Driving · energy',
  device: 'Device',
};

/** F10-R3: what a group reveals, from `SHARE_GROUP_KEYS` ("Speed, SOC, range, …"). */
export function groupDescription(group: ShareGroup): string {
  const { combinfo, parsedcandata } = SHARE_GROUP_KEYS[group];
  const keys = new Set<GroupKey>([...combinfo, ...parsedcandata]);
  const ordered = [
    ...ORDER[group].filter((k) => keys.has(k)),
    ...[...keys].filter((k) => !ORDER[group].includes(k)),
  ];
  const text = ordered.map((k) => KEY_LABEL[k]).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** F10-R4: trail windows in minutes (contract max 1440). */
export const TRAIL_WINDOWS: readonly { value: number; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 60, label: '1 h' },
  { value: 360, label: '6 h' },
  { value: 1440, label: '24 h' },
];
export const DEFAULT_TRAIL_MINUTES = 60;

export const trailLabel = (minutes: number) =>
  TRAIL_WINDOWS.find((w) => w.value === minutes)?.label ??
  (minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`);

/** Revoked wins over expired; otherwise expired once `expiresAt` has passed. */
export function shareLinkStatus(link: ShareLink, now: number): ShareLinkStatus {
  if (link.revokedAt !== undefined) return 'revoked';
  return link.expiresAt <= now ? 'expired' : 'active';
}

/** F10-R6 option chips: Location · Driving · Device · Trail 1 h. */
export function optionChips(link: Pick<ShareLink, 'show' | 'trail'>): string[] {
  return [
    'Location',
    ...(link.show.drivingEnergy ? ['Driving'] : []),
    ...(link.show.device ? ['Device'] : []),
    ...(link.trail.enabled ? [`Trail ${trailLabel(link.trail.windowMinutes)}`] : []),
  ];
}

/** Newest first. */
export const newestFirst = (a: ShareLink, b: ShareLink) => b.createdAt - a.createdAt;

/** Whether `meId` may revoke `link` (the server allows the creator, or anyone with `share.revoke`). */
export const canRevokeLink = (link: ShareLink, meId: string | undefined, canRevokeAny: boolean) =>
  canRevokeAny || (meId !== undefined && link.createdBy === meId);

/** How many of `links` are active at `now`. */
export const countActive = (links: readonly ShareLink[], now = Date.now()) =>
  links.filter((l) => shareLinkStatus(l, now) === 'active').length;
