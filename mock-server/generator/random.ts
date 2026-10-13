const fmix = (h: number) => {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** Stateless 32-bit hash of up to three integers. */
export function hash32(seed: number, a: number, b = 0): number {
  let h = fmix((seed + 0x9e3779b9) | 0);
  h = fmix((h ^ a) | 0);
  return fmix((h + Math.imul(b | 0, 0x27d4eb2f)) | 0);
}

/** Stateless uniform in [0, 1). */
export const unit = (seed: number, a: number, b = 0) => hash32(seed, a, b) / 4294967296;

/** Seeded sequential PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
