import type {
  DriverRequest,
  ReplacementCandidate,
  RequestStatus,
  RequestType,
} from '@shared/contract/index.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { RequestDrawer, type RequestDrawerProps } from './components/request-drawer';

const T0 = 1_760_000_000_000;

const req = (
  type: RequestType,
  status: RequestStatus,
  over: Partial<DriverRequest> = {},
): DriverRequest => ({
  id: 'req-1',
  type,
  vehicleId: 'v1',
  driverId: 'd1',
  fleetId: 'f1',
  status,
  ...(type === 'breakdown' ? { reason: 'tyre' as const } : {}),
  note: '',
  location: null,
  createdAt: T0,
  updatedAt: T0,
  timeline: [{ at: T0, status: 'open', by: 'u-d1' }],
  ...(type === 'replacement' ? { replacement: {} } : {}),
  ...over,
});

const cand = (n: number): ReplacementCandidate => ({
  vehicleId: `c${n}`,
  regno: `MH12CC000${n}`,
  status: 'stopped',
  distanceKm: n * 1.5,
  soc: 80,
  rangeKm: 150,
});

/** Renders inside a memory router (the drawer has links). */
async function renderInRouter(ui: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('dialog');
}

function drawer(r: DriverRequest, over: Partial<RequestDrawerProps> = {}) {
  const props: RequestDrawerProps = {
    request: r,
    onClose: vi.fn(),
    onUpdated: vi.fn(),
    regnoOf: (id) => (id === 'v1' ? 'MH12AB0001' : null),
    driver: { name: 'Ravi Kumar', phone: '+91 98765 43210' },
    act: vi.fn(async () => ({ ...r, status: 'acknowledged' as const })),
    refresh: vi.fn(async () => r),
    loadSuggestions: vi.fn(async () => [cand(1), cand(2)]),
    search: vi.fn(async () => [{ vehicleId: 'v9', regno: 'MH12ZZ0009' }]),
    ...over,
  };
  return { props, ui: <RequestDrawer {...props} /> };
}

const buttons = () =>
  within(screen.getByRole('dialog'))
    .queryAllByRole('button')
    .map((b) => b.textContent?.trim())
    .filter((t) => t && t !== '');

describe('F14-T2: drawer actions follow the state machine', () => {
  it.each<[RequestType, RequestStatus, string[], string[]]>([
    ['breakdown', 'open', ['Acknowledge'], ['Resolve', 'Close', 'Dispatch RSA']],
    ['breakdown', 'acknowledged', ['Resolve', 'Close'], ['Acknowledge']],
    ['rsa', 'acknowledged', ['Dispatch RSA'], ['Resolve', 'Acknowledge']],
    ['rsa', 'dispatched', ['Resolve', 'Close'], ['Dispatch RSA']],
    ['replacement', 'suggested', ['Reject', 'Close', 'Approve', 'Override'], ['Acknowledge']],
    ['breakdown', 'resolved', [], ['Acknowledge', 'Resolve', 'Close']],
  ])('%s %s shows %j only', async (type, status, shown, hidden) => {
    const over = type === 'replacement' ? { replacement: { suggestedVehicleId: 'c1' } } : {};
    await renderInRouter(drawer(req(type, status, over)).ui);
    const all = buttons();
    for (const b of shown) expect(all).toContain(b);
    for (const b of hidden) expect(all).not.toContain(b);
  });

  it('an action takes an optional note; a 409 refreshes and says so', async () => {
    const user = userEvent.setup();
    const r = req('breakdown', 'open');
    const act = vi.fn(async () => {
      throw new ApiError(409, 'invalid_transition', 'Cannot acknowledge');
    });
    const { props, ui } = drawer(r, { act });
    await renderInRouter(ui);
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await user.type(screen.getByLabelText('Note (optional)'), 'On it');
    await user.click(screen.getByRole('button', { name: 'Confirm acknowledge' }));
    expect(act).toHaveBeenCalledWith('req-1', { action: 'acknowledge', note: 'On it' });
    expect(await screen.findByTestId('action-error')).toHaveTextContent(
      'This request changed meanwhile',
    );
    expect(props.refresh).toHaveBeenCalledWith('req-1');
    expect(props.onUpdated).toHaveBeenCalledWith(r);
  });
});

describe('F14-T2: RSA dispatch form', () => {
  it('needs an assignee and a whole-minute ETA, then dispatches', async () => {
    const user = userEvent.setup();
    const { props, ui } = drawer(req('rsa', 'acknowledged'));
    await renderInRouter(ui);
    await user.click(screen.getByRole('button', { name: 'Dispatch RSA' }));
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(screen.getByText('Enter who is going.')).toBeInTheDocument();
    expect(screen.getByText('Enter the ETA in minutes.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Assignee'), 'Tow team 4');
    await user.type(screen.getByLabelText('ETA (minutes)'), '0');
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(screen.getByText(/1 to 1440/)).toBeInTheDocument();
    expect(props.act).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('ETA (minutes)'));
    await user.type(screen.getByLabelText('ETA (minutes)'), '35');
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(props.act).toHaveBeenCalledWith('req-1', {
      action: 'dispatch',
      assignee: 'Tow team 4',
      etaMinutes: 35,
    });
  });
});

describe('F14-T2: replacement panel states', () => {
  it('suggested: lists candidates with the suggestion; Approve assigns it', async () => {
    const user = userEvent.setup();
    const { props, ui } = drawer(
      req('replacement', 'suggested', { replacement: { suggestedVehicleId: 'c1' } }),
    );
    await renderInRouter(ui);
    const list = await screen.findByRole('list', { name: 'Replacement candidates' });
    expect(within(list).getAllByTestId('candidate')).toHaveLength(2);
    expect(within(list).getAllByTestId('candidate')[0]).toHaveTextContent('Suggested');
    expect(within(list).getAllByTestId('candidate')[0]).toHaveTextContent('80%');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(props.act).toHaveBeenCalledWith('req-1', { action: 'approve' });
  });

  it('waiting: says we will notify; override picks a searched vehicle; server reason shows', async () => {
    const user = userEvent.setup();
    const act = vi.fn(async () => {
      throw new ApiError(409, 'conflict', 'Vehicle is not available');
    });
    const { ui } = drawer(req('replacement', 'waiting'), {
      act,
      loadSuggestions: vi.fn(async () => []),
    });
    await renderInRouter(ui);
    expect(await screen.findByTestId('replacement-waiting')).toHaveTextContent(
      "No eligible vehicle yet. We'll notify you.",
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Override' }));
    await user.type(screen.getByLabelText('Search a replacement vehicle'), 'MH12ZZ');
    await user.click(await screen.findByRole('button', { name: 'MH12ZZ0009' }));
    await user.click(screen.getByRole('button', { name: 'Assign MH12ZZ0009' }));
    expect(act).toHaveBeenCalledWith('req-1', { action: 'override', vehicleId: 'v9' });
    expect(await screen.findByTestId('replacement-error')).toHaveTextContent(
      'Vehicle is not available',
    );
  });

  it('override from the candidate list; assigned shows the vehicle and "Assigned automatically"', async () => {
    const user = userEvent.setup();
    const { props, ui } = drawer(
      req('replacement', 'suggested', { replacement: { suggestedVehicleId: 'c1' } }),
    );
    await renderInRouter(ui);
    await screen.findByRole('list', { name: 'Replacement candidates' });
    await user.click(screen.getByRole('button', { name: 'Override' }));
    await user.click(screen.getByRole('button', { name: /MH12CC0002/ }));
    await user.click(screen.getByRole('button', { name: 'Assign MH12CC0002' }));
    expect(props.act).toHaveBeenCalledWith('req-1', { action: 'override', vehicleId: 'c2' });
  });

  it('assigned automatically: timeline and panel say so', async () => {
    const r = req('replacement', 'assigned', {
      replacement: { assignedVehicleId: 'c1' },
      timeline: [
        { at: T0, status: 'open', by: 'u-d1' },
        { at: T0 + 1, status: 'assigned', by: 'system' },
      ],
    });
    await renderInRouter(drawer(r, { regnoOf: (id) => (id === 'c1' ? 'MH12CC0001' : null) }).ui);
    expect(await screen.findByTestId('replacement-assigned')).toHaveTextContent(
      'MH12CC0001Assigned automatically',
    );
    expect(screen.getByTestId('timeline')).toHaveTextContent('Assigned automatically · System');
  });
});
