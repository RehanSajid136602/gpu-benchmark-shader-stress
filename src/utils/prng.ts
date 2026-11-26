/**
 * Deterministic 32-bit PRNG (Mulberry32).
 * Returns a function yielding floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Parses a numeric/hex seed string or generates a fresh 32-bit unsigned seed.
 */
export function parseOrGenerateSeed(raw?: string | null): number {
  if (raw !== undefined && raw !== null && raw.trim() !== '') {
    const trimmed = raw.trim();
    const parsed = trimmed.startsWith('0x')
      ? Number.parseInt(trimmed, 16)
      : Number(trimmed);
    if (Number.isFinite(parsed)) {
      return (parsed >>> 0) || 1;
    }
    // Hash arbitrary string deterministically (FNV-1a 32-bit)
    let hash = 0x811c9dc5;
    for (let i = 0; i < trimmed.length; i++) {
      hash ^= trimmed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) || 1;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! || 1;
  }
  return ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1;
}
