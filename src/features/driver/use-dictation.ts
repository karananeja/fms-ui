import { useCallback, useEffect, useRef, useState } from 'react';

/** The parts of the Web Speech API's `SpeechRecognition` the dictation uses. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
export type RecognitionFactory = () => RecognitionLike;

/** The browser's recognizer (Chrome/Edge/Safari prefix it), or `null` where unsupported. */
export function browserRecognition(): RecognitionFactory | null {
  const w = globalThis as unknown as Record<string, (new () => RecognitionLike) | undefined>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? () => new Ctor() : null;
}

export const DICTATION_LANGS = [
  { id: 'en-IN', label: 'English' },
  { id: 'hi-IN', label: 'हिन्दी' },
] as const;
export type DictationLang = (typeof DICTATION_LANGS)[number]['id'];

const ERRORS: Record<string, string> = {
  'not-allowed': 'Allow the microphone to speak your note.',
  'service-not-allowed': 'Allow the microphone to speak your note.',
  'no-speech': 'Didn’t hear anything. Try again.',
  'audio-capture': 'No microphone found.',
  network: 'Voice needs a network connection.',
};

/**
 * F13 / D-110: speech-to-text for the problem note. `onText(final)` gets each finished phrase;
 * `interim` holds the words still being recognised. Stops by itself after a pause.
 */
export function useDictation(
  onText: (text: string) => void,
  create: RecognitionFactory | null = browserRecognition(),
) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(
    (lang: DictationLang) => {
      if (!create || rec.current) return;
      const r = create();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        // One `onText` per event, so phrases finished together append in order.
        let done = '';
        let pending = '';
        for (let k = e.resultIndex; k < e.results.length; k++) {
          const res = e.results[k]!;
          const text = res[0]?.transcript ?? '';
          if (res.isFinal) done += text;
          else pending += text;
        }
        if (done.trim()) onTextRef.current(done.trim());
        setInterim(pending.trim());
      };
      r.onerror = (e) => {
        if (e.error !== 'aborted') setError(ERRORS[e.error] ?? 'Voice input stopped.');
      };
      r.onend = () => {
        rec.current = null;
        setListening(false);
        setInterim('');
      };
      setError(null);
      rec.current = r;
      try {
        r.start();
        setListening(true);
      } catch {
        rec.current = null;
        setError('Voice input isn’t available right now.');
      }
    },
    [create],
  );

  useEffect(() => () => rec.current?.stop(), []);

  return { supported: create !== null, listening, interim, error, start, stop };
}

/** Appends a dictated phrase to the note with one space, capitalising a new sentence. */
export function appendPhrase(note: string, phrase: string): string {
  if (!phrase) return note;
  const base = note.trimEnd();
  const text =
    !base || /[.!?।]$/.test(base) ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
  return base ? `${base} ${text}` : text;
}
