const indian = new Intl.NumberFormat('en-IN');

/** Short cluster label: `999`, `1.2k`, `12k`, `1.2L` (lakh). */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  if (n < 100_000) return `${Math.floor(n / 1000)}k`;
  return `${(Math.floor(n / 10_000) / 10).toFixed(1)}L`;
}

export const clusterLabel = (count: number) => `${indian.format(count)} vehicles`;

const size = (count: number) => (count < 100 ? 34 : count < 1000 ? 40 : count < 10_000 ? 46 : 52);

/**
 * SVG donut for a cluster: one ring segment per status (in `colors` order, sized by
 * `breakdown`), the short count in the centre. Plain DOM string: hundreds of these update
 * per frame, so no React here.
 */
export function clusterMarkerSvg(
  count: number,
  breakdown: ArrayLike<number>,
  colors: readonly string[],
): string {
  const d = size(count);
  const stroke = 5;
  const r = d / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  let offset = 0;
  let ring = '';
  for (let k = 0; k < colors.length; k++) {
    const n = breakdown[k]!;
    if (!n) continue;
    const len = (n / count) * c;
    ring += `<circle r="${r}" cx="${d / 2}" cy="${d / 2}" fill="none" stroke="${colors[k]}" stroke-width="${stroke}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
  }
  return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" aria-hidden="true"><circle r="${r}" cx="${d / 2}" cy="${d / 2}" fill="rgb(14 14 15 / 0.88)"/><g transform="rotate(-90 ${d / 2} ${d / 2})">${ring}</g><text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="#f2f2f2" font-size="${d < 40 ? 11 : 12}" font-weight="600" font-family="Inter Variable, system-ui, sans-serif">${shortCount(count)}</text></svg>`;
}
