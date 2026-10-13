import {
  SHARE_GROUP_KEYS,
  type Combinfo,
  type Lafparsed,
  type RedactedCombinfo,
  type RedactedLafparsed,
  type ShareOptions,
} from '@shared/contract/index.ts';

type Show = ShareOptions['show'];

/** Removes the groups a share link hides. `show` undefined = signed-in user, nothing removed. */
export function redactCombinfo(data: Combinfo, show?: Show): RedactedCombinfo {
  if (!show) return data;
  const out: Record<string, unknown> = { ...data };
  const can: Record<string, unknown> = { ...data.parsedcandata };
  for (const group of ['drivingEnergy', 'device'] as const) {
    if (show[group]) continue;
    for (const k of SHARE_GROUP_KEYS[group].combinfo) delete out[k];
    for (const k of SHARE_GROUP_KEYS[group].parsedcandata) delete can[k];
  }
  out.parsedcandata = can;
  return out as RedactedCombinfo;
}

export function redactLafparsed(data: Lafparsed, show?: Show): RedactedLafparsed {
  if (!show || show.device) return data;
  const out: RedactedLafparsed = { ...data };
  delete out.deviceid;
  return out;
}
