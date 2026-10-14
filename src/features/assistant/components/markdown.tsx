import { Fragment, type ReactNode } from 'react';
import type { EntityRef } from '@shared/contract/assistant.ts';

export type RenderEntity = (ref: EntityRef, text: string, key: string) => ReactNode;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regex over every entity label (longest first), matched as whole words. */
function entityMatcher(entities: readonly EntityRef[]) {
  const byLabel = new Map<string, EntityRef>();
  for (const e of entities) if (e.label.trim() && !byLabel.has(e.label)) byLabel.set(e.label, e);
  if (!byLabel.size) return null;
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  return { re: new RegExp(`(?<![\\w])(${labels.join('|')})(?![\\w])`, 'g'), byLabel };
}

type Matcher = ReturnType<typeof entityMatcher>;

function linkEntities(text: string, m: Matcher, render: RenderEntity, key: string): ReactNode[] {
  if (!m) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const hit of text.matchAll(m.re)) {
    const at = hit.index;
    if (at > last) out.push(text.slice(last, at));
    out.push(render(m.byLabel.get(hit[1]!)!, hit[1]!, `${key}e${at}`));
    last = at + hit[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `code`, **bold** and entity links; everything else is plain text (no HTML is ever parsed). */
function inline(text: string, m: Matcher, render: RenderEntity, key: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    const k = `${key}.${i}`;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={k} className="rounded bg-tile px-1 py-0.5 text-[0.9em] text-accent">
          {part.slice(1, -1)}
        </code>
      );
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**'))
      return (
        <strong key={k} className="font-extrabold text-text">
          {linkEntities(part.slice(2, -2), m, render, k)}
        </strong>
      );
    return <Fragment key={k}>{linkEntities(part, m, render, k)}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * F17-R2: the small markdown subset answers use (paragraphs, headings, bullet and numbered
 * lists, tables, code fences, bold, inline code), rendered as React elements. Partial input
 * (mid-stream) renders as far as it goes.
 */
export function Markdown({
  text,
  entities = [],
  renderEntity,
}: {
  text: string;
  entities?: readonly EntityRef[];
  renderEntity: RenderEntity;
}) {
  const m = entityMatcher(entities);
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${i}`;
    if (!line.trim()) {
      i++;
    } else if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith('```'); i++)
        body.push(lines[i]!);
      i++;
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-md bg-tile p-2 text-xs">
          {body.join('\n')}
        </pre>,
      );
    } else if (line.trimStart().startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trimStart().startsWith('|'); i++)
        rows.push(cells(lines[i]!));
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-md border border-tile-border">
          <table className="w-full text-xs">
            <thead className="bg-tile text-text-muted">
              <tr>
                {head.map((c, j) => (
                  <th key={j} className="px-2 py-1.5 text-left font-extrabold">
                    {inline(c, m, renderEntity, `${key}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-tile-border">
                  {head.map((_, j) => (
                    <td key={j} className="px-2 py-1.5 tabular-nums">
                      {inline(r[j] ?? '', m, renderEntity, `${key}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line);
      const re = ordered ? ORDERED : BULLET;
      const items: string[] = [];
      for (; i < lines.length && re.test(lines[i]!); i++) items.push(lines[i]!.replace(re, ''));
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={key} className={`space-y-0.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, m, renderEntity, `${key}i${j}`)}</li>
          ))}
        </Tag>,
      );
    } else if (/^#{1,6}\s+/.test(line)) {
      blocks.push(
        <p key={key} className="font-extrabold text-text">
          {inline(line.replace(/^#{1,6}\s+/, ''), m, renderEntity, key)}
        </p>,
      );
      i++;
    } else {
      const para: string[] = [];
      for (
        ;
        i < lines.length &&
        lines[i]!.trim() &&
        !BULLET.test(lines[i]!) &&
        !ORDERED.test(lines[i]!) &&
        !lines[i]!.trimStart().startsWith('|') &&
        !lines[i]!.trimStart().startsWith('```') &&
        !/^#{1,6}\s+/.test(lines[i]!);
        i++
      )
        para.push(lines[i]!);
      if (!para.length) {
        // A lone `|` line that isn't a table: plain text.
        para.push(line);
        i++;
      }
      blocks.push(
        <p key={key}>
          {para.map((p, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(p, m, renderEntity, `${key}p${j}`)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return <div className="space-y-2 break-words">{blocks}</div>;
}
