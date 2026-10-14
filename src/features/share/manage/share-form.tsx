import type { ShareLink } from '@shared/contract/index.ts';
import { Check, Copy, ExternalLink, Lock, Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Segmented } from '@/features/access/components/admin-ui';
import { inputClass } from '@/features/auth/components/text-field';
import { ApiError } from '@/shared/api/api-client';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { createShareLink } from '../api/share-api';
import {
  DEFAULT_EXPIRY,
  epochToIstInput,
  EXPIRY_PRESETS,
  formatExpiryIst,
  resolveExpiry,
  type ExpiryPreset,
  type IstInput,
} from '../lib/share-expiry';
import {
  DEFAULT_TRAIL_MINUTES,
  GROUP_LABEL,
  groupDescription,
  TRAIL_WINDOWS,
  type ShareGroup,
} from '../lib/share-link-model';
import { copyText, fullShareUrl } from './use-share-links';

const DAY = 24 * 3_600_000;
const COPIED_MS = 2000;

function FieldLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span
      id={id}
      className="mb-2 block text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase"
    >
      {children}
    </span>
  );
}

/** Checkbox row with a muted description (F10 §4). */
function CheckRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-tile)] border border-tile-border bg-tile p-3',
        disabled ? 'cursor-default' : 'cursor-pointer hover:border-accent/40',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-desc`}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)] disabled:opacity-70"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-extrabold">
          {label}
          {disabled && <Lock aria-hidden className="size-3 text-text-faint" />}
        </span>
        <span id={`${id}-desc`} className="mt-0.5 block text-xs text-text-muted">
          {description}
        </span>
      </span>
    </label>
  );
}

/** Message for a failed create (F10-R5): 422 from the server, 403 out of scope. */
function createErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "You can't share this vehicle.";
    if (err.unreachable) return "Couldn't reach the server. Try again.";
    return err.message;
  }
  return 'Something went wrong. Try again.';
}

/** F10-R5 result: the full URL, Copy ("Copied" for 2 s + toast), Open, Create another. */
function ShareResult({ link, onAnother }: { link: ShareLink; onAnother: () => void }) {
  const url = fullShareUrl(link);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (!(await copyText(url))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="share-result">
      <div>
        <FieldLabel>Link ready</FieldLabel>
        <p className="mb-3 text-xs text-text-muted">
          Anyone with this link can follow the vehicle until{' '}
          <span className="font-extrabold text-text">{formatExpiryIst(link.expiresAt)}</span>.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            aria-label="Share link URL"
            value={url}
            onFocus={(e) => e.target.select()}
            className={cn(inputClass, 'h-10 min-w-0 flex-1 text-xs text-text read-only:text-text')}
          />
          <Button className="h-10 w-28" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onAnother}>
          <Plus /> Create another
        </Button>
        <Button variant="outline" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> Open
          </a>
        </Button>
      </div>
    </div>
  );
}

/**
 * F10-R2…R5: expiry (presets or a custom IST date/time), visible data, trail → create → result.
 */
export function ShareForm({
  vehicleId,
  onCreated,
}: {
  vehicleId: string;
  onCreated: (link: ShareLink) => void;
}) {
  const ids = useId();
  const now = useNow(30_000);
  const [preset, setPreset] = useState<ExpiryPreset>(DEFAULT_EXPIRY);
  const [custom, setCustom] = useState<IstInput>(() => epochToIstInput(Date.now() + DAY));
  const [show, setShow] = useState<Record<ShareGroup, boolean>>({
    drivingEnergy: false,
    device: false,
  });
  const [trailOn, setTrailOn] = useState(false);
  const [trailMinutes, setTrailMinutes] = useState(DEFAULT_TRAIL_MINUTES);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ShareLink | null>(null);

  const resolved = resolveExpiry(preset, custom, now);

  const submit = async () => {
    // Presets count from the moment of the click.
    const at = resolveExpiry(preset, custom, Date.now());
    if (at.expiresAt === null) return;
    setPending(true);
    setError(null);
    try {
      const link = await createShareLink({
        vehicleId,
        expiresAt: at.expiresAt,
        show: { drivingEnergy: show.drivingEnergy, device: show.device },
        trail: { enabled: trailOn, windowMinutes: trailMinutes },
      });
      setCreated(link);
      onCreated(link);
    } catch (err) {
      setError(createErrorText(err));
    } finally {
      setPending(false);
    }
  };

  if (created) {
    return (
      <ShareResult
        link={created}
        onAnother={() => {
          setCreated(null);
          setError(null);
        }}
      />
    );
  }

  const customId = `${ids}-custom`;
  const expiryNote = `${ids}-expiry-note`;
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section>
        <FieldLabel>Link expires</FieldLabel>
        <Segmented<ExpiryPreset>
          label="Expiry"
          value={preset}
          onChange={setPreset}
          options={EXPIRY_PRESETS}
        />
        {preset === 'custom' && (
          <fieldset id={customId} className="mt-3 grid grid-cols-2 gap-2">
            <legend className="sr-only">Custom expiry (IST)</legend>
            <label className="text-xs text-text-muted">
              Date (IST)
              <input
                type="date"
                aria-label="Expiry date (IST)"
                value={custom.date}
                aria-invalid={resolved.error ? true : undefined}
                aria-describedby={expiryNote}
                onChange={(e) => setCustom((c) => ({ ...c, date: e.target.value }))}
                className={cn(inputClass, 'mt-1 h-10 [color-scheme:dark]')}
              />
            </label>
            <label className="text-xs text-text-muted">
              Time (IST)
              <input
                type="time"
                aria-label="Expiry time (IST)"
                value={custom.time}
                aria-invalid={resolved.error ? true : undefined}
                aria-describedby={expiryNote}
                onChange={(e) => setCustom((c) => ({ ...c, time: e.target.value }))}
                className={cn(inputClass, 'mt-1 h-10 [color-scheme:dark]')}
              />
            </label>
          </fieldset>
        )}
        <p
          id={expiryNote}
          data-testid="share-expiry-note"
          className={cn('mt-2 text-xs', resolved.error ? 'text-danger' : 'text-text-muted')}
          role={resolved.error ? 'alert' : undefined}
        >
          {resolved.error !== null
            ? resolved.error
            : `Expires ${formatExpiryIst(resolved.expiresAt)}`}
        </p>
      </section>

      <section>
        <FieldLabel>Visible data</FieldLabel>
        <div className="flex flex-col gap-2">
          <CheckRow
            id={`${ids}-location`}
            label="Location"
            description="Live position, ignition and moving / stopped. Always shared."
            checked
            disabled
          />
          {(['drivingEnergy', 'device'] as const).map((g) => (
            <CheckRow
              key={g}
              id={`${ids}-${g}`}
              label={GROUP_LABEL[g]}
              description={groupDescription(g)}
              checked={show[g]}
              onChange={(checked) => setShow((s) => ({ ...s, [g]: checked }))}
            />
          ))}
        </div>
      </section>

      <section>
        <FieldLabel>Trail</FieldLabel>
        <CheckRow
          id={`${ids}-trail`}
          label="Show trail"
          description="The path driven in a recent window, extended live."
          checked={trailOn}
          onChange={setTrailOn}
        />
        {trailOn && (
          <div className="mt-2">
            <Segmented<string>
              label="Trail window"
              value={String(trailMinutes)}
              onChange={(v) => setTrailMinutes(Number(v))}
              options={TRAIL_WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))}
            />
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending || resolved.error !== null}>
        {pending ? 'Creating…' : 'Create link'}
      </Button>
    </form>
  );
}
