import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRooms, RoomError } from "./cards.ts";
import { MemoryStore } from "./store.ts";

const ann = { id: 1, username: "ann" };
const ben = { id: 2, username: "ben" };
const cy = { id: 3, username: "cy" };

async function table(n = 3) {
  const store = new MemoryStore();
  const rooms = new CardRooms(store);
  const code = rooms.create(ann);
  for (const u of [ben, cy].slice(0, n - 1)) rooms.join(code, u);
  return { store, rooms, code };
}

test("each phone sees its own card and nobody else's until the reveal", async () => {
  const { rooms, code } = await table();
  rooms.deal(code, ann);
  const v = rooms.view(code, ben);
  assert.ok(v.myCard);
  assert.ok(v.players.every((p) => p.card === undefined));
  rooms.reveal(code, ann, true);
  assert.ok(rooms.view(code, ben).players.every((p) => p.card));
});

test("only the host deals, sets up or runs the timer", async () => {
  const { rooms, code } = await table();
  for (const f of [() => rooms.deal(code, ben), () => rooms.setConfig(code, ben, {}), () => rooms.timer(code, ben, "start")]) {
    assert.throws(f, (e: unknown) => e instanceof RoomError && e.status === 403);
  }
});

test("a stranger cannot read a room, and joining twice is one seat", async () => {
  const { rooms, code } = await table(2);
  assert.throws(() => rooms.view(code, cy), (e: unknown) => e instanceof RoomError && e.status === 403);
  rooms.join(code, ben);
  assert.equal(rooms.view(code, ann).players.length, 2);
});

test("nobody joins a dealt room, and the setup is locked while cards are out", async () => {
  const { rooms, code } = await table(2);
  rooms.deal(code, ann);
  assert.throws(() => rooms.join(code, cy), /already dealt/);
  assert.throws(() => rooms.setConfig(code, ann, {}), /Collect the cards/);
  rooms.collect(code, ann);
  rooms.join(code, cy);
  assert.equal(rooms.view(code, cy).myCard, null);
});

test("the timer counts down from the round's length and pauses where it was", async () => {
  let now = 1_000_000;
  const rooms = new CardRooms(new MemoryStore(), () => {}, () => now);
  const code = rooms.create(ann);
  rooms.timer(code, ann, "start");
  now += 30_000;
  rooms.timer(code, ann, "pause");
  assert.equal(rooms.view(code, ann).timer.remaining, 150_000);
  rooms.timer(code, ann, "next");
  assert.equal(rooms.view(code, ann).timer.round, 1);
  assert.equal(rooms.view(code, ann).timer.remaining, 120_000);
});

test("a room survives a restart", async () => {
  const { store, rooms, code } = await table();
  rooms.deal(code, ann);
  const card = rooms.view(code, cy).myCard;
  await rooms.flush();
  const again = new CardRooms(store);
  await again.init();
  assert.deepEqual(again.view(code, cy).myCard, card);
});

test("the last one out closes the room, and a host who leaves hands it on", async () => {
  const { rooms, code } = await table(2);
  rooms.leave(code, ann);
  assert.equal(rooms.view(code, ben).host, true);
  rooms.leave(code, ben);
  assert.throws(() => rooms.view(code, ben), (e: unknown) => e instanceof RoomError && e.status === 404);
});
