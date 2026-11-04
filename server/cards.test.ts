import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRooms, HOST_AWAY_MS, RoomError } from "./cards.ts";
import { MemoryStore } from "./store.ts";

const ann = { id: 1, username: "ann", isAdmin: true };
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

test("a stranger cannot read a room (told it does not exist), and joining twice is one seat", async () => {
  const { rooms, code } = await table(2);
  assert.throws(() => rooms.view(code, cy), (e: unknown) => e instanceof RoomError && e.status === 404);
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

test("test players fill a room for one person, and only the host sees their cards", async () => {
  const { rooms, code } = await table(2);
  rooms.addTestPlayers(code, ann, 4);
  assert.equal(rooms.view(code, ann).players.length, 6);
  assert.throws(() => rooms.addTestPlayers(code, ben, 1), (e: unknown) => e instanceof RoomError && e.status === 403);
  rooms.deal(code, ann);
  const host = rooms.view(code, ann).players.filter((p) => p.test);
  assert.equal(host.length, 4);
  assert.ok(host.every((p) => p.testCard), "the host holds the test players' cards");
  assert.ok(rooms.view(code, ben).players.every((p) => !p.testCard), "nobody else does");
  assert.throws(() => rooms.makeHost(code, ann, host[0].id), /can't host/);
});

test("test players are numbered on, never reuse an id, and go when asked", async () => {
  const { rooms, code } = await table(1);
  rooms.addTestPlayers(code, ann, 2);
  rooms.kick(code, ann, rooms.view(code, ann).players.find((p) => p.name === "Test player 1")!.id);
  rooms.addTestPlayers(code, ann, 1);
  const names = rooms.view(code, ann).players.filter((p) => p.test).map((p) => p.name);
  assert.deepEqual(names, ["Test player 2", "Test player 3"]);
  const ids = rooms.view(code, ann).players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  rooms.removeTestPlayers(code, ann);
  assert.equal(rooms.view(code, ann).players.length, 1);
});

test("when the last person leaves a room of test players, the room closes", async () => {
  const { rooms, code } = await table(1);
  rooms.addTestPlayers(code, ann, 3);
  rooms.leave(code, ann);
  assert.throws(() => rooms.view(code, ann), (e: unknown) => e instanceof RoomError && e.status === 404);
});

test("a removed player can't come straight back in through the link", async () => {
  const { rooms, code } = await table(2);
  rooms.kick(code, ann, ben.id);
  assert.throws(() => rooms.join(code, ben), (e: unknown) => e instanceof RoomError && e.status === 403);
  rooms.unkick(code, ann, ben.id);
  rooms.join(code, ben);
  assert.equal(rooms.view(code, ben).players.length, 2);
});

test("a second Deal does not reshuffle cards already out unless it says so", async () => {
  const { rooms, code } = await table(3);
  rooms.deal(code, ann);
  assert.throws(() => rooms.deal(code, ann), /already out/);
  rooms.deal(code, ann, true);
  assert.equal(rooms.view(code, ann).deal, 2);
});

test("anyone may take over from a host who has gone quiet, and not before", async () => {
  let now = 5_000_000;
  const rooms = new CardRooms(new MemoryStore(), () => {}, () => now);
  const code = rooms.create(ann);
  rooms.join(code, ben);
  rooms.view(code, ann);
  assert.throws(() => rooms.claimHost(code, ben), /still here/);
  assert.equal(rooms.view(code, ben).hostAway, false);
  now += HOST_AWAY_MS + 1;
  assert.equal(rooms.view(code, ben).hostAway, true);
  rooms.claimHost(code, ben);
  assert.equal(rooms.view(code, ben).host, true);
});

test("only an admin hosting the room can add test players", async () => {
  const { rooms, code } = await table(2);
  rooms.makeHost(code, ann, ben.id);
  assert.throws(() => rooms.addTestPlayers(code, ben, 2), /Only an admin/);
  assert.equal(rooms.view(code, ben).canTest, false);
});

test("nobody is sent which group anyone else is in", async () => {
  const { rooms, code } = await table(3);
  rooms.deal(code, ann);
  const v = rooms.view(code, ben);
  assert.notEqual(v.myGroup, null);
  assert.ok(v.players.every((p) => !("group" in p)));
});

test("only an admin reveals everyone's cards, host or not", async () => {
  const { rooms, code } = await table(3);
  rooms.makeHost(code, ann, ben.id);
  rooms.deal(code, ben);
  assert.throws(() => rooms.reveal(code, ben, true), /Only an admin/);
  assert.equal(rooms.view(code, ben).canReveal, false);
  rooms.reveal(code, ann, true);
  assert.ok(rooms.view(code, cy).players.every((p) => p.card));
});

test("the host sees who they removed and can let them back in", async () => {
  const { rooms, code } = await table(2);
  rooms.kick(code, ann, ben.id);
  assert.deepEqual(rooms.view(code, ann).removed, [{ id: ben.id, name: "ben" }]);
  rooms.unkick(code, ann, ben.id);
  assert.deepEqual(rooms.view(code, ann).removed, []);
});

test("one account can host only a few rooms at once", async () => {
  const rooms = new CardRooms(new MemoryStore());
  for (let i = 0; i < 5; i++) rooms.create(ben);
  assert.throws(() => rooms.create(ben), (e: unknown) => e instanceof RoomError && e.status === 429);
});

test("a host who is not an admin is never sent test players' cards", async () => {
  const { rooms, code } = await table(2);
  rooms.addTestPlayers(code, ann, 2);
  rooms.makeHost(code, ann, ben.id);
  rooms.deal(code, ben);
  assert.ok(rooms.view(code, ben).players.every((p) => !p.testCard));
});

test("the Gambler bets on Blue or Red in secret, can change it until round 1 starts, and it shows at the reveal", async () => {
  const { rooms, code } = await table(3);
  const setup = rooms.view(code, ann).config;
  rooms.setConfig(code, ann, { ...setup, roles: [...setup.roles, { id: "g", libId: "gambler", teamId: "loners", count: 1 }], oddRoleId: "", rounds: [{ minutes: 2, swap: 1 }] });
  rooms.deal(code, ann);
  const people = [ann, ben, cy];
  const gambler = people.find((u) => rooms.view(code, u).myCard?.roleId === "g")!;
  const other = people.find((u) => u !== gambler)!;
  const refused = (f: () => void, status: number) => assert.throws(f, (e: unknown) => e instanceof RoomError && e.status === status);

  refused(() => rooms.bet(code, other, "blue"), 403); // only the Gambler bets
  refused(() => rooms.bet(code, gambler, "green"), 400);
  assert.equal(rooms.view(code, gambler).betsOpen, true);
  rooms.bet(code, gambler, "blue");
  assert.equal(rooms.view(code, gambler).myBet, "blue");
  // Nobody else is told, in their own bet or in the player list.
  const theirs = rooms.view(code, other);
  assert.equal(theirs.myBet, null);
  assert.ok(theirs.players.every((p) => p.bet === undefined));
  rooms.bet(code, gambler, "red"); // a change of mind, before the first round
  assert.equal(rooms.view(code, gambler).myBet, "red");

  rooms.timer(code, ann, "start");
  assert.equal(rooms.view(code, gambler).betsOpen, false);
  refused(() => rooms.bet(code, gambler, "blue"), 409);
  assert.equal(rooms.view(code, gambler).myBet, "red", "the bet is locked as it was");

  rooms.reveal(code, ann, true);
  assert.equal(rooms.view(code, other).players.find((p) => p.id === gambler.id)?.bet, "red");
  rooms.deal(code, ann, true);
  assert.equal(rooms.view(code, gambler).myBet, null, "a new deal clears the bet");
});

test("each Lover is told the other's name and side, and nobody else is told anything", async () => {
  const store = new MemoryStore();
  const rooms = new CardRooms(store);
  const code = rooms.create(ann);
  const dee = { id: 4, username: "dee" };
  for (const u of [ben, cy, dee]) rooms.join(code, u);
  const setup = rooms.view(code, ann).config;
  rooms.setConfig(code, ann, { ...setup, roles: [...setup.roles, { id: "x", libId: "lover", teamId: "blue" }, { id: "y", libId: "lover", teamId: "red" }], oddRoleId: "" });
  rooms.deal(code, ann);
  const people = [ann, ben, cy, dee];
  const lovers = people.filter((u) => rooms.view(code, u).myCard?.roleId.startsWith("lover-"));
  assert.equal(lovers.length, 2, "4 players: President, Bomber and the two Lovers");
  const [a, b] = lovers;
  assert.deepEqual(rooms.view(code, a).myLover, { name: b.username, teamId: rooms.view(code, b).myCard!.teamId });
  assert.deepEqual(rooms.view(code, b).myLover, { name: a.username, teamId: rooms.view(code, a).myCard!.teamId });
  assert.notEqual(rooms.view(code, a).myCard!.teamId, rooms.view(code, b).myCard!.teamId, "one Blue, one Red");
  for (const u of people.filter((x) => !lovers.includes(x))) assert.equal(rooms.view(code, u).myLover, null);
});

test("bets stay closed once round 1 has started or the cards were seen, until the next deal", async () => {
  const { rooms, code } = await table(3);
  const setup = rooms.view(code, ann).config;
  rooms.setConfig(code, ann, { ...setup, roles: [...setup.roles, { id: "g", libId: "gambler", teamId: "loners", count: 1 }], oddRoleId: "", rounds: [{ minutes: 2, swap: 1 }, { minutes: 1, swap: 1 }] });
  const gamblerOf = () => [ann, ben, cy].find((u) => rooms.view(code, u).myCard?.roleId === "g")!;
  const closed = (u: { id: number; username: string }) => assert.throws(() => rooms.bet(code, u, "blue"), (e: unknown) => e instanceof RoomError && e.status === 409);

  // Started, then restarted: still closed.
  rooms.deal(code, ann);
  rooms.timer(code, ann, "start");
  rooms.timer(code, ann, "reset");
  closed(gamblerOf());
  rooms.timer(code, ann, "next");
  rooms.timer(code, ann, "prev");
  closed(gamblerOf());

  // Skipping round 1 starts the game too.
  rooms.deal(code, ann, true);
  rooms.bet(code, gamblerOf(), "red");
  rooms.timer(code, ann, "next");
  closed(gamblerOf());

  // Revealed and hidden again: closed.
  rooms.deal(code, ann, true);
  rooms.reveal(code, ann, true);
  rooms.reveal(code, ann, false);
  closed(gamblerOf());

  // A new deal opens them again.
  rooms.deal(code, ann, true);
  rooms.bet(code, gamblerOf(), "blue");
  assert.equal(rooms.view(code, gamblerOf()).myBet, "blue");
});

test("after the reveal the host says how it ended, everyone sees it, and a new deal clears it", async () => {
  const { rooms, code } = await table(3);
  rooms.deal(code, ann);
  assert.throws(() => rooms.setOutcome(code, ann, { sameRoom: true }), (e: unknown) => e instanceof RoomError && e.status === 400); // not revealed
  assert.equal(rooms.view(code, ben).outcome, null);
  rooms.reveal(code, ann, true);
  assert.throws(() => rooms.setOutcome(code, ben, { sameRoom: true }), (e: unknown) => e instanceof RoomError && e.status === 403); // not the host
  rooms.setOutcome(code, ann, { sameRoom: true });
  rooms.setOutcome(code, ann, { loversTogether: false });
  assert.deepEqual(rooms.view(code, ben).outcome, { sameRoom: true, loversTogether: false });
  rooms.setOutcome(code, ann, { sameRoom: false });
  assert.equal(rooms.view(code, cy).outcome!.sameRoom, false, "an answer can be changed");
  rooms.deal(code, ann, true);
  rooms.reveal(code, ann, true);
  assert.deepEqual(rooms.view(code, ben).outcome, { sameRoom: null, loversTogether: null });
});
