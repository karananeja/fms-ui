import { useState } from 'react';
import { DASHBOARD_TITLE_MAX } from '@shared/contract/dashboards.ts';
import { Modal } from '@/features/access/components/admin-ui';
import { inputClass } from '@/features/auth/components/text-field';
import { Button } from '@/shared/ui/button';

/** §3: rename a dashboard (1–80 characters). */
export function RenameDialog({
  open,
  onOpenChange,
  title,
  onSave,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  onSave(title: string): Promise<void> | void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Rename dashboard">
      {open && <RenameForm title={title} onSave={onSave} onCancel={() => onOpenChange(false)} />}
    </Modal>
  );
}

function RenameForm({
  title,
  onSave,
  onCancel,
}: {
  title: string;
  onSave(title: string): Promise<void> | void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= DASHBOARD_TITLE_MAX;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setPending(true);
        try {
          await onSave(trimmed);
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor="rename-dashboard" className="mb-1.5 block text-xs font-bold text-text-muted">
        Title
      </label>
      <input
        id="rename-dashboard"
        autoFocus
        value={value}
        maxLength={DASHBOARD_TITLE_MAX}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={!valid || undefined}
        className={inputClass}
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
