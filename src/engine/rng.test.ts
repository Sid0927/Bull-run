import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { Rng, nextRandom, nextSecretRandom } from "./rng.ts";
import { newGame } from "./engine.ts";
import { viewFor } from "../shared/view.ts";

test("the secret generator is ChaCha20, checked against node:crypto", () => {
  // Key 00 01 02 … 1f, block counter 1, nonce 0: the same block node's own ChaCha20 produces.
  const key = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(1, 0); // node's chacha20 takes the 32-bit counter, then the 96-bit nonce
  const block = createCipheriv("chacha20", Buffer.from(key, "hex"), iv).update(Buffer.alloc(64));
  const w0 = block.readUInt32LE(0), w1 = block.readUInt32LE(4);
  const [v, next] = nextSecretRandom(`${key}:1`);
  assert.equal(v, ((w0 >>> 5) * 2 ** 26 + (w1 >>> 6)) / 2 ** 53);
  assert.equal(next, `${key}:2`);
});

test("old games still draw exactly as before (mulberry32 from the number)", () => {
  assert.deepEqual(nextRandom(42), [nextRandom(42)[0], (42 + 0x6d2b79f5) | 0]);
  const a = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 99 }).state;
  const b = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 99 }).state;
  assert.deepEqual(a, b);
  assert.equal(typeof a.rng, "number");
});

test("with a secret, the deal follows the secret and not the seed, and no player is sent it", () => {
  const secret = "ab".repeat(32);
  const one = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 1, secret }).state;
  const two = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 2, secret }).state;
  assert.deepEqual(one.players.map((p) => p.hand), two.players.map((p) => p.hand));
  assert.equal(typeof one.rng, "string");
  for (const seat of [0, 1, 2, null] as const) {
    const json = JSON.stringify(viewFor(one, seat, seat === null));
    assert.ok(!json.includes(secret.slice(0, 16)), "a view carries the secret");
  }
});

test("draws from the secret generator spread evenly", () => {
  const r = new Rng(`${"5e".repeat(32)}:0`);
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) bins[r.int(10)]++;
  for (const n of bins) assert.ok(n > 1800 && n < 2200, `uneven: ${bins.join(" ")}`);
});
