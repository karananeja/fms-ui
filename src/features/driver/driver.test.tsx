import type { DriverRequest } from '@shared/contract/index.ts';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { IncidentCard } from './components/incident-card';
import { MyVehicleCard } from './components/my-vehicle-card';
import { ReportWizard } from './components/report-wizard';
import { groupIncidents, incidentSteps, incidentSummary, orderIncidents } from './driver-model';
import { DriverStore } from './driver-store';
import { appendPhrase, type RecognitionLike } from '@/shared/hooks/use-dictation';

const NOW = Date.now();
const req = (over: Partial<DriverRequest> = {}): DriverRequest => ({
  id: 'r1',
  type: 'rsa',
  vehicleId: 'v1',
  driverId: 'd1',
  fleetId: 'f1',
  status: 'open',
  note: '',
  location: null,
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
  timeline: [{ at: NOW - 60_000, status: 'open', by: 'u-driver' }],
  ...over,
});

/** A fake recognizer the test drives. */
function fakeRecognition() {
  const made: RecognitionLike[] = [];
  const create = () => {
    const r: RecognitionLike = {
      lang: '',
      continuous: false,
      interimResults: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(() => r.onend?.()),
    };
    made.push(r);
    return r;
  };
  const say = (text: string, isFinal: boolean) =>
    act(() =>
      made.at(-1)!.onresult!({
        resultIndex: 0,
        results: [Object.assign([{ transcript: text }], { isFinal })],
      }),
    );
  return { create, made, say };
}

describe('F13-T1 / D-109: integrated report', () => {
  it('reason → suggested help → sends the breakdown, then RSA', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <ReportWizard
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        locate={async () => ({ lat: 12.9, lng: 77.6 })}
        recognition={null}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Choose what happened.')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Tyre/));
    await user.type(screen.getByLabelText(/Describe the problem/), 'flat front tyre');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // A tyre suggests roadside help only.
    expect(screen.getByRole('checkbox', { name: /Roadside help/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Another vehicle/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('report-summary')).toHaveTextContent('Roadside help where I am');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls.map((c) => (c as unknown as [{ type: string }])[0].type)).toEqual([
      'breakdown',
      'rsa',
    ]);
    expect(onSubmit.mock.calls[0]).toEqual([
      {
        type: 'breakdown',
        reason: 'tyre',
        note: 'flat front tyre',
        location: { lat: 12.9, lng: 77.6 },
      },
    ]);
    expect(await screen.findByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('a failed report stops the help requests; Retry resends; 409 is "Already requested"', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'network', "Couldn't reach the server"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'open'))
      .mockResolvedValueOnce(undefined);
    render(
      <ReportWizard
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        locate={async () => null}
        recognition={null}
      />,
    );
    await user.click(screen.getByLabelText(/Accident/));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach the server");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(4));
    expect(screen.getByTestId('report-item-rsa')).toHaveAttribute('data-state', 'already');
    expect(screen.getByTestId('report-item-replacement')).toHaveAttribute('data-state', 'sent');
  });
});

describe('F13 / D-110: voice note', () => {
  it('dictates into the note in the chosen language', async () => {
    const user = userEvent.setup();
    const voice = fakeRecognition();
    render(
      <ReportWizard open onOpenChange={vi.fn()} onSubmit={vi.fn()} recognition={voice.create} />,
    );
    await user.click(screen.getByRole('radio', { name: 'हिन्दी' }));
    await user.click(screen.getByRole('button', { name: 'Speak your note' }));
    expect(voice.made[0]!.lang).toBe('hi-IN');
    voice.say('टायर पंचर', false);
    expect(screen.getByTestId('dictation-status')).toHaveTextContent('Listening… टायर पंचर');
    voice.say('टायर पंचर हो गया', true);
    expect(screen.getByLabelText(/Describe the problem/)).toHaveValue('टायर पंचर हो गया');
    await user.click(screen.getByRole('button', { name: 'Stop voice input' }));
    expect(screen.getByRole('button', { name: 'Speak your note' })).toBeInTheDocument();
  });

  it('no browser support: a plain note box', () => {
    render(<ReportWizard open onOpenChange={vi.fn()} onSubmit={vi.fn()} recognition={null} />);
    expect(screen.queryByRole('button', { name: 'Speak your note' })).not.toBeInTheDocument();
  });

  it('appends phrases with a space and capitalises new sentences', () => {
    expect(appendPhrase('', 'tyre burst')).toBe('Tyre burst');
    expect(appendPhrase('Tyre burst.', 'near the toll')).toBe('Tyre burst. Near the toll');
    expect(appendPhrase('Tyre burst', 'near the toll')).toBe('Tyre burst near the toll');
  });
});

describe('F13 / D-109: incidents', () => {
  const breakdown = req({
    id: 'b',
    type: 'breakdown',
    reason: 'tyre',
    createdAt: NOW - 120_000,
    timeline: [{ at: NOW - 120_000, status: 'open', by: 'u-driver' }],
  });
  const rsa = req({
    id: 'r',
    status: 'dispatched',
    rsa: { assignee: 'Suresh', etaMinutes: 30 },
    createdAt: NOW - 119_000,
    timeline: [
      { at: NOW - 119_000, status: 'open', by: 'u-driver' },
      { at: NOW - 30_000, status: 'acknowledged', by: 'u-ops', note: 'On it' },
      { at: NOW, status: 'dispatched', by: 'u-ops' },
    ],
  });

  it('groups a breakdown with its help and merges the timeline', () => {
    const [i] = groupIncidents([rsa, breakdown]);
    expect(i!.requests.map((r) => r.id)).toEqual(['b', 'r']);
    expect(incidentSteps(i!).map((s) => s.text)).toEqual([
      'Problem reported',
      'Roadside help requested',
      'Roadside help acknowledged',
      'RSA dispatched: Suresh, ETA 30 min',
    ]);
    expect(incidentSummary(i!)).toBe('Help on the way · ETA 30 min');
  });

  it('a later, unrelated report starts a new incident; closed ones are capped at 10', () => {
    const old = req({
      id: 'old',
      type: 'breakdown',
      status: 'resolved',
      createdAt: NOW - 86_400_000,
    });
    expect(groupIncidents([old, breakdown])).toHaveLength(2);
    const closed = Array.from({ length: 12 }, (_, k) =>
      req({
        id: `c${k}`,
        type: 'breakdown',
        status: 'resolved',
        createdAt: NOW - (k + 1) * 3_600_000,
        updatedAt: NOW - k,
      }),
    );
    expect(orderIncidents(closed)).toHaveLength(10);
  });

  it('the card offers the help not asked for yet', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(async () => undefined);
    const [i] = groupIncidents([breakdown, rsa]);
    render(<IncidentCard incident={i!} now={NOW} canAdd={['replacement']} onAdd={onAdd} />);
    expect(screen.getByTestId('part-rsa')).toHaveTextContent('Dispatched');
    await user.click(screen.getByRole('button', { name: /Also need another vehicle/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAdd).toHaveBeenCalledWith('replacement');
  });

  it('no vehicle: the contact-your-operator state', () => {
    render(<MyVehicleCard vehicle={null} now={NOW} />);
    expect(screen.getByTestId('my-vehicle-none')).toHaveTextContent('No vehicle assigned');
  });
});

describe('F13-R4: driver store', () => {
  it('merges live events and raises the banner when a replacement is assigned', async () => {
    const handlers: Record<string, (d: unknown) => void> = {};
    const me = (regno: string) => ({
      driver: { id: 'd1', name: 'Karan' },
      vehicle: { meta: { regno } },
      openRequests: [],
    });
    const fetchMe = vi.fn().mockResolvedValueOnce(me('OLD1')).mockResolvedValue(me('NEW1'));
    const store = new DriverStore({
      fetchMe: fetchMe as never,
      fetchRequests: async () => ({
        items: [req({ type: 'replacement', status: 'suggested' })],
        nextCursor: null,
      }),
      socket: {
        onEvent: ((kind: string, h: (d: unknown) => void) => {
          handlers[kind] = h;
          return () => {};
        }) as never,
        onSync: () => () => {},
      },
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const stop = store.start();
    await waitFor(() => expect(store.getSnapshot().me).not.toBeNull());
    handlers.request!(req({ type: 'replacement', status: 'assigned', updatedAt: NOW }));
    expect(store.getSnapshot().requests[0]!.status).toBe('assigned');
    await waitFor(() => expect(store.getSnapshot().banner).toBe('Replacement assigned: NEW1'));
    stop();
  });
});
