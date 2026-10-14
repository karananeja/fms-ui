import { useState, type FormEvent } from 'react';
import { TextField } from '@/features/auth/components/text-field';
import { Button } from '@/shared/ui/button';
import { validateDispatch, type DispatchErrors } from '../lib/request-model';
import { NoteField } from './note-field';

export interface DispatchInput {
  assignee: string;
  etaMinutes: number;
  note?: string;
}

/** F14-R2: dispatch roadside assistance: who is going and the ETA in minutes, plus a note. */
export function RsaDispatchForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending?: boolean;
  onSubmit: (input: DispatchInput) => void;
  onCancel: () => void;
}) {
  const [assignee, setAssignee] = useState('');
  const [eta, setEta] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<DispatchErrors>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateDispatch(assignee, eta);
    setErrors(found);
    if (found.assignee || found.eta) return;
    onSubmit({
      assignee: assignee.trim(),
      etaMinutes: Number(eta),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Dispatch roadside assistance"
      className="rounded-tile border border-tile-border bg-tile p-3"
    >
      <TextField
        id="rsa-assignee"
        label="Assignee"
        value={assignee}
        onChange={(e) => setAssignee(e.target.value)}
        error={errors.assignee}
        placeholder="Team or person"
        maxLength={100}
      />
      <TextField
        id="rsa-eta"
        label="ETA (minutes)"
        inputMode="numeric"
        value={eta}
        onChange={(e) => setEta(e.target.value)}
        error={errors.eta}
        placeholder="30"
      />
      <NoteField id="rsa-note" value={note} onChange={setNote} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          Dispatch
        </Button>
      </div>
    </form>
  );
}
