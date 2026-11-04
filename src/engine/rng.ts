/**
 * The game's random draws, reproducible from the state kept in the game so saved moves replay.
 *
 * Two generators. A game started on the server keeps a 256-bit secret and draws from ChaCha20
 * keyed with it: the state is "<64 hex digits>:<counter>". Games from before that (and practice
 * games, which hold no secrets from the one person playing) use mulberry32 with a 32-bit state:
 * fine for shuffling, but every one of its 2^32 seeds can be tried in seconds, and a player's own
 * hand and the face-up cards were enough to find which one a game used, and so every hand.
 */
export function nextRandom(state: number): [value: number, next: number] {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

const SECRET = /^[0-9a-f]{64}$/;
export const isSecret = (x: unknown): x is string => typeof x === "string" && SECRET.test(x);

/** The ChaCha20 block for a 256-bit key (hex) and a block counter, nonce 0 (RFC 8439). */
function chachaBlock(key: number[], counter: number): Uint32Array {
  const init = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...key, counter >>> 0, Math.floor(counter / 2 ** 32) >>> 0, 0, 0]);
  const x = init.slice();
  const r = (a: number, b: number) => (a << b) | (a >>> (32 - b));
  const q = (a: number, b: number, c: number, d: number) => {
    x[a] += x[b]; x[d] = r(x[d] ^ x[a], 16);
    x[c] += x[d]; x[b] = r(x[b] ^ x[c], 12);
    x[a] += x[b]; x[d] = r(x[d] ^ x[a], 8);
    x[c] += x[d]; x[b] = r(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    q(0, 4, 8, 12); q(1, 5, 9, 13); q(2, 6, 10, 14); q(3, 7, 11, 15);
    q(0, 5, 10, 15); q(1, 6, 11, 12); q(2, 7, 8, 13); q(3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) x[i] += init[i];
  return x;
}

function keyWords(hex: string): number[] {
  // Little-endian 32-bit words, as RFC 8439 reads the key bytes.
  return Array.from({ length: 8 }, (_, i) => {
    const b = (j: number) => parseInt(hex.slice(8 * i + 2 * j, 8 * i + 2 * j + 2), 16);
    return (b(0) | (b(1) << 8) | (b(2) << 16) | (b(3) << 24)) >>> 0;
  });
}

/** One draw in [0, 1) from a ChaCha20 state "<secret>:<counter>", and the state after it. */
export function nextSecretRandom(state: string): [value: number, next: string] {
  const [secret, n] = state.split(":");
  const counter = Number(n);
  if (!isSecret(secret) || !Number.isSafeInteger(counter) || counter < 0) throw new Error("Bad random state.");
  const w = chachaBlock(keyWords(secret), counter);
  // 53 random bits: every double in [0, 1) a draw can be.
  return [((w[0] >>> 5) * 2 ** 26 + (w[1] >>> 6)) / 2 ** 53, `${secret}:${counter + 1}`];
}

/** A mutable wrapper for use inside a single reducer step. */
export class Rng {
  constructor(public state: number | string) {}
  next(): number {
    if (typeof this.state === "string") {
      const [v, s] = nextSecretRandom(this.state);
      this.state = s;
      return v;
    }
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  shuffle<T>(xs: T[]): T[] {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export function seedFrom(input: number | string): number {
  if (typeof input === "number") return input | 0;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return h | 0;
}
