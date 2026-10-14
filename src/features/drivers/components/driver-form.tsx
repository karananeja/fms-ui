import type { Driver, DriverStatus, Fleet } from '@shared/contract/index.ts';
import { useState } from 'react';
import { toast } from 'sonner';
import { Segmented } from '@/features/access/components/admin-ui';
import { FleetPicker } from '@/features/access/fleets/fleet-picker';
import { errorText } from '@/features/access/lib/access-format';
import { TextField } from '@/features/auth/components/text-field';
import { Button } from '@/shared/ui/button';
import { createDriver, updateDriver } from '../api/drivers-api';
import {
  normalizePhone,
  PHONE_HINT,
  validateDriver,
  type DriverFormErrors as Errors,
} from '../lib/driver-format';

/**
 * F12-R2: create or edit a driver. Name, phone (`+91`), fleet (in scope), status; on create,
 * "Send app invite" (needs an email) also sends the F03 invite with role Driver.
 */
export function DriverForm({
  driver,
  fleets,
  onSaved,
  onCancel,
}: {
  driver: Driver | null;
  fleets: readonly Fleet[];
  onSaved: (driver: Driver, invited: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(driver?.name ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [fleetId, setFleetId] = useState<string | null>(
    driver?.fleetId ?? (fleets.length === 1 ? fleets[0]!.id : null),
  );
  const [status, setStatus] = useState<DriverStatus>(driver?.status ?? 'active');
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const found = validateDriver({ name, phone, fleetId, invite, email });
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setError(null);
    const body = { name: name.trim(), phone: normalizePhone(phone), fleetId: fleetId!, status };
    try {
      const saved = driver
        ? await updateDriver(driver.id, body)
        : await createDriver({ ...body, invite, ...(invite && { email: email.trim() }) });
      toast.success(driver ? `Saved ${saved.name}` : `Added ${saved.name}`);
      onSaved(saved, !driver && invite);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      data-testid="driver-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextField
        id="driver-name"
        label="Name"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <TextField
        id="driver-phone"
        label="Phone"
        type="tel"
        inputMode="tel"
        placeholder={PHONE_HINT}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onBlur={() => setPhone((p) => normalizePhone(p))}
        error={errors.phone}
      />
      <div className="mb-4">
        <span className="mb-1.5 block text-xs font-bold text-text-muted">Fleet</span>
        <FleetPicker
          mode="single"
          aria-label="Fleet"
          fleets={fleets}
          value={fleetId}
          onChange={(id) => {
            setFleetId(id);
            setErrors((e) => ({ ...e, fleet: undefined }));
          }}
        />
        {errors.fleet && <p className="mt-1.5 text-xs text-danger">{errors.fleet}</p>}
      </div>
      <div className="mb-4">
        <span className="mb-1.5 block text-xs font-bold text-text-muted">Status</span>
        <Segmented<DriverStatus>
          label="Driver status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'off-duty', label: 'Off duty' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
      </div>
      {!driver && (
        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={invite}
              onChange={(e) => setInvite(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Send app invite
          </label>
          {invite && (
            <TextField
              id="driver-email"
              label="Invite email"
              type="email"
              className="mt-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
            />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : driver ? 'Save changes' : 'Add driver'}
        </Button>
      </div>
    </form>
  );
}
