import type { Combinfo } from '@shared/contract/index.ts';
import { describe, expect, it } from 'vitest';
import combinfoSample from '../../../../mock-server/fixtures/combinfo-sample.json';
import { SelectedHistory } from './selected-history.ts';

const base = combinfoSample as Combinfo;
const MIN = 60_000;
const at = (t: number, soc = 50): Combinfo => ({
  ...base,
  utctime: t,
  parsedcandata: { ...base.parsedcandata, soc: { ...base.parsedcandata.soc!, pidvalue: soc } },
});

describe('F07-T4: selected-history', () => {
  it('caps the sample buffer at 2 h and ignores repeated payloads', () => {
    const h = new SelectedHistory(120 * MIN);
    const t0 = base.utctime;
    for (let k = 0; k <= 180; k++) h.addPayload(at(t0 + k * MIN), 'running');
    h.addPayload(at(t0 + 180 * MIN), 'running');
    const { samples } = h.view();
    expect(samples).toHaveLength(121);
    expect(samples.at(-1)!.t - samples[0]!.t).toBe(120 * MIN);
  });

  it('records each status transition once, de-duplicates ignition events, resets', () => {
    const h = new SelectedHistory(120 * MIN);
    h.addPayload(at(base.utctime), 'stopped');
    h.addPayload(at(base.utctime + MIN), 'stopped');
    expect(h.observeStatus('stopped', 1)).toBe(false);
    expect(h.observeStatus('stopped', 2)).toBe(false);
    expect(h.observeStatus('pullout', base.utctime + 2 * MIN)).toBe(true);
    expect(h.observeStatus('pullout', base.utctime + 3 * MIN)).toBe(false);
    const kinds = h.view().events.map((e) => e.kind);
    expect(kinds).toEqual(['ignition-on', 'ignition-off', 'status']);
    expect(h.view().events[2]).toMatchObject({ status: 'pullout', from: 'stopped' });
    h.reset();
    expect(h.view()).toEqual({ samples: [], events: [] });
  });
});
