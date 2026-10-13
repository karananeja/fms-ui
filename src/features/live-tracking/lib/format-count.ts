const grouped = new Intl.NumberFormat('en-IN');
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

/** `100000` → `1,00,000` (Indian grouping). */
export const formatCount = (n: number): string => grouped.format(n);

/** `34646` → `34.6K`, `100000` → `1L` (mobile pills, D-062). */
export const formatCompact = (n: number): string => compact.format(n);
