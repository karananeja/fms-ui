/** "Ops User" → "OU"; a single word → its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words.at(-1)![0]!;
  return letters.toUpperCase();
}
