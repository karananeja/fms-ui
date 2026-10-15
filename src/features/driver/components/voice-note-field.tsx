import { Mic, Square } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { NOTE_MAX } from '../driver-model';
import {
  appendPhrase,
  DICTATION_LANGS,
  useDictation,
  type DictationLang,
  type RecognitionFactory,
} from '@/shared/hooks/use-dictation';

/**
 * F13 / D-110: the problem note, typed or spoken. The mic dictates into the note (English or
 * Hindi); words still being recognised show live under the box. Without browser support it is a
 * plain text box.
 */
export function VoiceNoteField({
  value,
  onChange,
  error,
  recognition,
}: {
  value: string;
  onChange: (note: string) => void;
  error?: string;
  /** Tests inject a fake recognizer; `undefined` uses the browser's. */
  recognition?: RecognitionFactory | null;
}) {
  const [lang, setLang] = useState<DictationLang>('en-IN');
  const dictation = useDictation(
    (phrase) => onChange(appendPhrase(value, phrase).slice(0, NOTE_MAX)),
    ...(recognition === undefined ? [] : [recognition]),
  );

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-2">
        <label className="flex-1 text-xs font-bold text-text-muted" htmlFor="report-note">
          Describe the problem (optional)
        </label>
        {dictation.supported && (
          <span role="radiogroup" aria-label="Voice language" className="flex gap-1">
            {DICTATION_LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={lang === l.id}
                disabled={dictation.listening}
                onClick={() => setLang(l.id)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-semibold text-text-muted',
                  lang === l.id && 'bg-accent-soft text-accent',
                )}
              >
                {l.label}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="relative">
        <textarea
          id="report-note"
          value={value}
          maxLength={NOTE_MAX + 20}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          aria-invalid={error ? true : undefined}
          className={cn(
            'w-full rounded-tile border border-tile-border bg-surface-solid px-3.5 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30',
            dictation.supported && 'pr-16',
            dictation.listening && 'border-danger',
          )}
          placeholder={
            dictation.supported
              ? 'Type, or tap the mic and speak'
              : 'Anything the operator should know'
          }
        />
        {dictation.supported && (
          <button
            type="button"
            aria-label={dictation.listening ? 'Stop voice input' : 'Speak your note'}
            aria-pressed={dictation.listening}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang))}
            className={cn(
              'absolute right-2 bottom-3 grid size-12 place-items-center rounded-full bg-accent text-bg shadow-[0_8px_24px_var(--shadow)]',
              dictation.listening && 'animate-pulse bg-danger motion-reduce:animate-none',
            )}
          >
            {dictation.listening ? <Square className="size-5" /> : <Mic className="size-5" />}
          </button>
        )}
      </div>
      <div className="flex items-start gap-2 text-[11px]">
        <p className="min-w-0 flex-1" aria-live="polite" data-testid="dictation-status">
          {dictation.listening ? (
            <span className="text-danger">
              Listening… <span className="text-text-muted italic">{dictation.interim}</span>
            </span>
          ) : dictation.error ? (
            <span className="text-danger">{dictation.error}</span>
          ) : null}
        </p>
        <span
          className={cn(
            'tabular-nums',
            value.length > NOTE_MAX ? 'text-danger' : 'text-text-faint',
          )}
        >
          {value.length}/{NOTE_MAX}
        </span>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
