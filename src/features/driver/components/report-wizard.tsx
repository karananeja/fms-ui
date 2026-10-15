import {
  BREAKDOWN_REASONS,
  type BreakdownReason,
  type GeoPoint,
  type RequestType,
} from '@shared/contract/index.ts';
import {
  CarFront,
  Check,
  CircleAlert,
  LifeBuoy,
  LoaderCircle,
  LocateFixed,
  Megaphone,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/shared/api/api-client';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';
import type { NewRequest } from '../api/driver-api';
import type { RecognitionFactory } from '../use-dictation';
import { VoiceNoteField } from './voice-note-field';
import {
  currentPosition,
  plannedRequests,
  REASON_LABEL,
  SUGGESTED_HELP,
  validateReport,
  type HelpNeeded,
} from '../driver-model';

type Step = 'what' | 'help' | 'confirm' | 'sending';
type ItemState = 'pending' | 'sent' | 'already' | 'failed';

const ITEM_LABEL: Record<RequestType, string> = {
  breakdown: 'Report the problem',
  rsa: 'Roadside help where I am',
  replacement: 'Another vehicle',
};

export interface ReportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sends one request; rejects with `ApiError` (409 = one of that type is already open). */
  onSubmit: (body: NewRequest) => Promise<unknown>;
  locate?: () => Promise<GeoPoint | null>;
  /** Voice input; tests inject a fake (`undefined` = the browser's). */
  recognition?: RecognitionFactory | null;
}

/**
 * F13 / D-109: one guided report instead of three separate requests. 1) what happened (reason +
 * note), 2) what help is needed (roadside help, another vehicle, both or neither; suggested from
 * the reason), 3) confirm with location. It sends the breakdown, then the help requested.
 */
export function ReportWizard({ open, onOpenChange, ...rest }: ReportWizardProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-[480px] gap-0 overflow-y-auto rounded-t-[var(--radius-panel)] border-glass-border bg-surface-solid p-4 pb-6"
      >
        {open && <Wizard onDone={() => onOpenChange(false)} {...rest} />}
      </SheetContent>
    </Sheet>
  );
}

const STEPS: { id: Step; label: string }[] = [
  { id: 'what', label: 'Problem' },
  { id: 'help', label: 'Help' },
  { id: 'confirm', label: 'Send' },
];

function Progress({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="mb-4 flex gap-1.5" aria-label="Steps">
      {STEPS.map((s, k) => (
        <li
          key={s.id}
          aria-current={k === at ? 'step' : undefined}
          className="flex-1 text-[10px] font-semibold tracking-[0.1em] text-text-muted uppercase"
        >
          <span
            className={cn(
              'mb-1 block h-1 rounded-full bg-tile-border',
              (k <= at || step === 'sending') && 'bg-accent',
            )}
          />
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function HelpCard({
  on,
  onToggle,
  icon,
  title,
  hint,
}: {
  on: boolean;
  onToggle: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-16 cursor-pointer items-center gap-3 rounded-tile border border-tile-border bg-tile px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        on && 'border-accent bg-accent-soft',
      )}
    >
      <span className={cn('text-text-muted', on && 'text-accent')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-text-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={onToggle}
        className="size-5 accent-[var(--accent)]"
      />
    </label>
  );
}

function Wizard({
  onSubmit,
  onDone,
  locate = currentPosition,
  recognition,
}: Omit<ReportWizardProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const [step, setStep] = useState<Step>('what');
  const [reason, setReason] = useState<BreakdownReason | null>(null);
  const [note, setNote] = useState('');
  const [help, setHelp] = useState<HelpNeeded>({ rsa: false, replacement: false });
  const [share, setShare] = useState(true);
  const [errors, setErrors] = useState<{ reason?: string; note?: string }>({});
  const [items, setItems] = useState<Partial<Record<RequestType, ItemState>>>({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  const pick = (r: BreakdownReason) => {
    setReason(r);
    setHelp(SUGGESTED_HELP[r]);
    setErrors((e) => ({ ...e, reason: undefined }));
  };

  const next = () => {
    const found = validateReport({ reason, note });
    setErrors(found);
    if (!Object.keys(found).length) setStep('help');
  };

  /** Sends the planned requests not sent yet (all of them the first time, the failed ones on retry). */
  const send = async () => {
    setStep('sending');
    setErrorText(null);
    const location = share ? await locate() : null;
    setUsedFallback(share && !location);
    const todo = plannedRequests(help).filter((t) => items[t] !== 'sent' && items[t] !== 'already');
    let state = { ...items };
    for (const t of todo) setItems((s) => ({ ...s, [t]: 'pending' }));
    for (const type of todo) {
      let result: ItemState;
      try {
        await onSubmit({
          type,
          ...(type === 'breakdown' && { reason: reason! }),
          note:
            type === 'breakdown'
              ? note.trim()
              : `For my ${REASON_LABEL[reason!].label.toLowerCase()} report`,
          ...(location && { location }),
        });
        result = 'sent';
      } catch (err) {
        result = err instanceof ApiError && err.status === 409 ? 'already' : 'failed';
        if (result === 'failed')
          setErrorText(
            err instanceof ApiError ? err.message : 'Couldn’t send. Check your connection.',
          );
      }
      state = { ...state, [type]: result };
      setItems(state);
      // Help is only asked for alongside a report: stop if the report itself didn't go out.
      if (type === 'breakdown' && result === 'failed') {
        for (const t of todo.slice(1)) state = { ...state, [t]: 'failed' };
        setItems(state);
        break;
      }
    }
  };

  const planned = plannedRequests(help);
  const failed = planned.some((t) => items[t] === 'failed');
  const busy = planned.some((t) => items[t] === 'pending');

  return (
    <>
      <SheetTitle className="text-lg font-semibold">
        {step === 'sending'
          ? busy
            ? 'Sending…'
            : failed
              ? 'Not everything was sent'
              : 'Report sent'
          : 'Report a problem'}
      </SheetTitle>
      <SheetDescription className="mb-3 text-sm text-text-muted">
        {step === 'what'
          ? 'What happened to your vehicle?'
          : step === 'help'
            ? 'What do you need from your operator?'
            : step === 'confirm'
              ? 'Check and send.'
              : 'Your operator sees this now. Updates appear on the incident.'}
      </SheetDescription>
      <Progress step={step} />

      {step === 'what' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <div
            className="mb-3 grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="What happened?"
          >
            {BREAKDOWN_REASONS.map((r) => (
              <label
                key={r}
                className={cn(
                  'flex min-h-16 cursor-pointer flex-col justify-center rounded-tile border border-tile-border bg-tile px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  reason === r && 'border-accent bg-accent-soft',
                )}
              >
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => pick(r)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">{REASON_LABEL[r].label}</span>
                <span className="text-[11px] text-text-muted">{REASON_LABEL[r].hint}</span>
              </label>
            ))}
          </div>
          {errors.reason && <p className="-mt-1 mb-3 text-xs text-danger">{errors.reason}</p>}
          <VoiceNoteField
            value={note}
            onChange={setNote}
            error={errors.note}
            recognition={recognition}
          />
          <Button type="submit" className="h-14 w-full text-base">
            Next
          </Button>
        </form>
      )}

      {step === 'help' && (
        <div className="flex flex-col gap-2">
          <HelpCard
            on={help.rsa}
            onToggle={() => setHelp((h) => ({ ...h, rsa: !h.rsa }))}
            icon={<LifeBuoy className="size-5" />}
            title="Roadside help"
            hint="Someone comes to fix it where you are"
          />
          <HelpCard
            on={help.replacement}
            onToggle={() => setHelp((h) => ({ ...h, replacement: !h.replacement }))}
            icon={<CarFront className="size-5" />}
            title="Another vehicle"
            hint="Get a replacement to continue your work"
          />
          <p className="flex items-center gap-2 px-1 text-xs text-text-muted">
            <Megaphone className="size-3.5" aria-hidden />
            {help.rsa || help.replacement
              ? 'Suggested for this problem. Change it if needed.'
              : 'Nothing selected: we only inform your operator.'}
          </p>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" className="h-14" onClick={() => setStep('what')}>
              Back
            </Button>
            <Button className="h-14 text-base" onClick={() => setStep('confirm')}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-3">
          <div
            className="rounded-tile border border-tile-border bg-tile p-3 text-sm"
            data-testid="report-summary"
          >
            <p className="font-semibold">{REASON_LABEL[reason!].label}</p>
            {note.trim() && <p className="text-xs text-text-muted">“{note.trim()}”</p>}
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {planned.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="size-3.5 text-accent" aria-hidden />
                  {ITEM_LABEL[t]}
                </li>
              ))}
            </ul>
          </div>
          <label className="flex min-h-12 items-center gap-3 rounded-tile border border-tile-border bg-tile px-3 text-sm">
            <LocateFixed className="size-4 text-accent" aria-hidden />
            <span className="flex-1">Share my location</span>
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
              className="size-5 accent-[var(--accent)]"
            />
          </label>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" className="h-14" onClick={() => setStep('help')}>
              Back
            </Button>
            <Button className="h-14 text-base" onClick={() => void send()}>
              Send report
            </Button>
          </div>
        </div>
      )}

      {step === 'sending' && (
        <div className="flex flex-col gap-3" data-testid="report-result">
          <ul className="flex flex-col gap-2">
            {planned.map((t) => {
              const s = items[t] ?? 'pending';
              return (
                <li
                  key={t}
                  data-testid={`report-item-${t}`}
                  data-state={s}
                  className="flex items-center gap-3 rounded-tile border border-tile-border bg-tile px-3 py-2.5 text-sm"
                >
                  {s === 'pending' ? (
                    <LoaderCircle className="size-5 animate-spin text-text-muted" aria-hidden />
                  ) : s === 'failed' ? (
                    <CircleAlert className="size-5 text-danger" aria-hidden />
                  ) : (
                    <Check className="size-5 text-ok" aria-hidden />
                  )}
                  <span className="flex-1 font-semibold">{ITEM_LABEL[t]}</span>
                  <span className="text-xs text-text-muted">
                    {s === 'pending'
                      ? 'Sending'
                      : s === 'sent'
                        ? 'Sent'
                        : s === 'already'
                          ? 'Already requested'
                          : 'Failed'}
                  </span>
                </li>
              );
            })}
          </ul>
          {errorText && (
            <p role="alert" className="text-sm text-danger">
              {errorText}
            </p>
          )}
          {usedFallback && !busy && (
            <p className="text-xs text-text-muted">We used your vehicle’s last location.</p>
          )}
          {failed && !busy ? (
            <Button className="h-14 text-base" onClick={() => void send()}>
              Retry
            </Button>
          ) : (
            <Button className="h-14 text-base" disabled={busy} onClick={onDone}>
              Done
            </Button>
          )}
        </div>
      )}
    </>
  );
}
