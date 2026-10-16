// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildTools, toolDefinitions, type ToolHost } from '../assistant/assistant-tools.ts';

/**
 * User report 2026-10-16: every Anthropic turn answered 400 "tools.5.custom: For 'integer' type,
 * properties maximum, minimum are not supported". Strict tools must not carry the bounds the
 * strict grammar rejects; zod still enforces them when the tool runs.
 */

const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'oneOf',
  '$schema',
];

/** Every schema keyword used (property names excluded), with the tools that use it. */
function keywords(schema: unknown, tool: string, out: Map<string, Set<string>>) {
  if (Array.isArray(schema)) return schema.forEach((s) => keywords(s, tool, out));
  if (!schema || typeof schema !== 'object') return;
  for (const [k, v] of Object.entries(schema)) {
    out.set(k, (out.get(k) ?? new Set()).add(tool));
    if (k === 'properties') Object.values(v as object).forEach((s) => keywords(s, tool, out));
    else keywords(v, tool, out);
  }
}

describe('strict tool schemas', () => {
  const defs = toolDefinitions(buildTools({} as ToolHost)) as {
    name: string;
    strict?: boolean;
    input_schema: unknown;
  }[];

  it('no tool sends a keyword the strict grammar rejects', () => {
    const used = new Map<string, Set<string>>();
    for (const d of defs) keywords(d.input_schema, d.name, used);
    const bad = UNSUPPORTED.filter((k) => used.has(k)).map(
      (k) => `${k}: ${[...used.get(k)!].join(', ')}`,
    );
    expect(bad).toEqual([]);
    expect(defs.every((d) => d.strict)).toBe(true);
  });

  it('bounds are still enforced: an out-of-range input fails zod parse', () => {
    const tools = buildTools({} as ToolHost) as unknown as {
      name: string;
      parse?: (x: unknown) => unknown;
    }[];
    // A bounded integer from the zod schema of each non-`validateInRun` tool (e.g. `limit`).
    const bounded = tools.filter((t) => {
      try {
        t.parse?.({ limit: 1_000_000 });
        return false;
      } catch {
        return true;
      }
    });
    expect(bounded.length).toBeGreaterThan(0);
  });
});
