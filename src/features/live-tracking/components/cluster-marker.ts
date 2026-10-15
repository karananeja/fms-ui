const indian = new Intl.NumberFormat('en-IN');

/** Short cluster label: `999`, `1.2k`, `12k`, `1.2L` (lakh). */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  if (n < 100_000) return `${Math.floor(n / 1000)}k`;
  return `${(Math.floor(n / 10_000) / 10).toFixed(1)}L`;
}

export const clusterLabel = (count: number) => `${indian.format(count)} vehicles`;

/** DS1-R5 sizes. */
export const clusterSize = (count: number) => (count < 100 ? 38 : count < 1000 ? 46 : 58);

const STROKE = 3.2;

/**
 * Status donut for a cluster (DS1-R5): one ring segment per status (in `colors` order, sized
 * by `breakdown`; `colors` are CSS values such as `var(--st-running)`, so the donut follows the
 * theme with no re-render, DS3 §3) around a glass centre (`.fms-cluster-core`, styled in `index.css`) holding
 * the short count. Plain DOM string: hundreds of these update per frame, so no React here.
 */
export function clusterMarkerSvg(
  count: number,
  breakdown: ArrayLike<number>,
  colors: readonly string[],
): string {
  const d = clusterSize(count);
  const r = d / 2 - STROKE / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  let ring = '';
  for (let k = 0; k < colors.length; k++) {
    const n = breakdown[k]!;
    if (!n) continue;
    const len = (n / count) * c;
    ring += `<circle r="${r}" cx="${d / 2}" cy="${d / 2}" fill="none" style="stroke:${colors[k]}" stroke-width="${STROKE}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
  }
  return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" aria-hidden="true"><g transform="rotate(-90 ${d / 2} ${d / 2})">${ring}</g></svg><span class="fms-cluster-core" aria-hidden="true">${shortCount(count)}</span>`;
}
