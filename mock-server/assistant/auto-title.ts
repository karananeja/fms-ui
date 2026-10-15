import { DEFAULT_DASHBOARD_TITLE, type ThreadMessage } from '@shared/contract/index.ts';

/**
 * F19 auto-title: a new dashboard that still has its default title gets a meaningful one on its
 * first chat turn. The model is asked to call `rename_dashboard` through a hint in the
 * per-request `<dashboard>` block (never the system prompt: F24, D-141); if the turn ends and the
 * title is still the default, the server renames it from the user's first message.
 */

export const AUTO_TITLE_MAX = 40;

/** Sent inside the `<dashboard>` block of the latest user turn while the title is the default. */
export const AUTO_TITLE_HINT = `The dashboard still has its default title ("${DEFAULT_DASHBOARD_TITLE}"). As part of this turn, also call rename_dashboard with a short, specific title (2-5 words, Title Case, no quotes or emoji) that reflects the user's request.`;

export const isDefaultTitle = (title: string) => title.trim() === DEFAULT_DASHBOARD_TITLE;

/** Whether an earlier chat turn already renamed the dashboard (even if the user undid it). */
export const renamedBefore = (thread: readonly ThreadMessage[]) =>
  thread.some((m) => m.change?.summary.includes('Renamed dashboard') ?? false);

/** The dashboard should be auto-titled this turn: default title and never renamed by the chat. */
export const wantsAutoTitle = (title: string, thread: readonly ThreadMessage[]) =>
  isDefaultTitle(title) && !renamedBefore(thread);

const FILLER =
  /^(?:(?:please|pls|hey|hi|can you|could you|would you|i want|i need|i'd like|i would like|help me|let's|lets)\s+)*(?:(?:create|show|build|make|give|set up|setup|design|generate|prepare|add)\s+)?(?:(?:me|us)\s+)?(?:(?:a|an|the|my|this|new)\s+)*(?:dashboard|board|view|page|screen)?\s*(?:(?:with|of|for|showing|that shows|to show|about|on|:|-)\s+)?/i;

const DROP = new Set(
  (
    'a an the and or of for with me my our us to please this that these those some all i we want ' +
    'need would like can could you show showing shows see view display dashboard dashboards board ' +
    'widget widgets new just also it its is are be let lets give build create make add set up ' +
    'put include including there here about'
  ).split(' '),
);
const MINOR = new Set(['vs', 'by', 'per', 'in', 'at', 'over']);
const UPPER = new Set(['gps', 'kpi', 'ev', 'soc', 'rsa', 'csv', 'pdf', 'id']);

const cap = (w: string) =>
  w
    .split('-')
    .map((p) =>
      UPPER.has(p)
        ? p.toUpperCase()
        : p.endsWith('s') && UPPER.has(p.slice(0, -1))
          ? `${p.slice(0, -1).toUpperCase()}s`
          : p
            ? p[0]!.toUpperCase() + p.slice(1)
            : p,
    )
    .join('-');

/**
 * A deterministic title from a prompt: filler ("create me a dashboard with …") and stop words
 * stripped, key words in Title Case, at most 6 words and `AUTO_TITLE_MAX` characters.
 */
export function titleFromPrompt(text: string, fallback = 'Fleet Dashboard'): string {
  const plain = text
    .replace(/\[fake:[a-z-]+\]/gi, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(FILLER, '');
  const words = plain
    .toLowerCase()
    .split(' ')
    .map((w) => w.replace(/^[-']+|[-']+$/g, '').replace(/'s$/, ''))
    .filter((w) => w && !DROP.has(w));
  // No leading or trailing minor word ("by", "vs", …).
  while (words.length && MINOR.has(words[0]!)) words.shift();
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= 6) break;
    const word = MINOR.has(w) ? w : cap(w);
    if ([...out, word].join(' ').length > AUTO_TITLE_MAX) break;
    out.push(word);
  }
  while (out.length && MINOR.has(out.at(-1)!)) out.pop();
  return out.join(' ') || fallback;
}
