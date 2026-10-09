/** The hub's cache and its locks, driven directly with a store that can be slowed down. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Action } from "../src/engine/index.ts";
import { Hub } from "./hub.ts";
import { MemoryStore } from "./store.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SlowStore extends MemoryStore {
  slow = false;
  override async appendAction(g: number, seq: number, a: Action) {
    if (this.slow) await delay(300);
    return super.appendAction(g, seq, a);
  }
}

test("a move survives its game being dropped from the cache while it is saved", async () => {
  const store = new SlowStore();
  const hub = new Hub(store);
  const us = await Promise.all(["ann", "bob", "cat"].map((n) => store.createUser(n, "x", false)));
  const mk = async () => {
    const g = await hub.create(us[0], 6, 3);
    await hub.join(us[1], g.code);
    await hub.join(us[2], g.code);
    await hub.start(us[0], g.id);
    return g;
  };
  const a = await mk();
  const others = [];
  for (let i = 0; i < 101; i++) others.push(await mk());
  // Read through the hub's private cache, as the screens do.
  const h = hub as unknown as { live: Map<number, unknown>; load: (g: unknown) => Promise<{ state: { players: { hand: number[] }[]; phase: { submissions?: unknown[] } } }> };
  const view = async () => (await h.load(await store.gameById(a.id))).state;
  const card = (await view()).players[0].hand[0];
  h.live.delete(others[100].id);
  store.slow = true;
  const move = hub.act(us[0], a.id, { type: "openingOrder", player: 0, orders: {}, card });
  await delay(10);
  // Meanwhile a games list loads every game, which would push this one out of the cache.
  await Promise.all(others.map(async (g) => hub.summary((await store.gameById(g.id))!, us[0].id)));
  await hub.summary((await store.gameById(a.id))!, us[0].id);
  await move;
  store.slow = false;
  assert.equal((await store.actions(a.id)).length, 1);
  assert.notEqual((await view()).phase.submissions![0], null);
  // And the game carries on.
  await hub.act(us[1], a.id, { type: "openingOrder", player: 1, orders: {}, card: (await view()).players[1].hand[0] });
  assert.equal((await store.actions(a.id)).length, 2);
});
