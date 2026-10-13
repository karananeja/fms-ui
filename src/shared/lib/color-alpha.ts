/** `#rrggbb` → `rgba(r,g,b,a)`; other formats are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color.trim());
  if (!m) return color;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}
