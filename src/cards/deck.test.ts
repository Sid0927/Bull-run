import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, configProblems, keepKeyCardsDealt, shuffle, splitGroups } from "./deck.ts";
import { BLUE_GOAL, BOMBER_ROLE, PRESIDENT_ROLE, RED_GOAL, hasLovers, hasSpyEach, setLovers, setSpyEach, withCore } from "./core.ts";
import { PRESETS, cleanConfig } from "./presets.ts";
import { LIBRARY, roleFrom } from "./library.ts";
import type { Config } from "./types.ts";

const classic = () => structuredClone(PRESETS.find((p) => p.id === "president-bomber")!.config);
const deck = (c: Config, n: number) => {
  const d = buildDeck(c, n);
  assert.ok("cards" in d, "error" in d ? d.error : "");
  return d.cards;
};
const count = (cards: { teamId: string }[], team: string) => cards.filter((c) => c.teamId === team).length;

test("every ready-made setup is usable and has Blue with the President and Red with the Bomber", () => {
  for (const p of PRESETS) {
    assert.deepEqual(configProblems(p.config), [], p.name);
    const ids = p.config.teams.map((t) => t.id);
    assert.deepEqual(ids.slice(0, 2), ["blue", "red"], p.name);
    assert.ok(p.config.groups, `${p.name} has two rooms`);
    const cards = deck(p.config, 8);
    assert.equal(cards.filter((c) => c.roleId === PRESIDENT_ROLE && c.teamId === "blue").length, 1, p.name);
    assert.equal(cards.filter((c) => c.roleId === BOMBER_ROLE && c.teamId === "red").length, 1, p.name);
  }
});

test("Blue and Red's goals are about the President and the Bomber, and printed on every side card", () => {
  const cards = deck(classic(), 11);
  for (const c of cards.filter((c) => c.teamId === "blue")) assert.equal(c.goal, BLUE_GOAL);
  for (const c of cards.filter((c) => c.teamId === "red")) assert.equal(c.goal, RED_GOAL);
  assert.match(BLUE_GOAL, /^Blue wins if, when the last round ends, the President is not in the same room as the Bomber/);
  assert.match(RED_GOAL, /^Red wins if, when the last round ends, the Bomber is in the same room as the President/);
  assert.ok(cards.filter((c) => c.teamId === "loners").every((c) => c.goal === "" && c.description.length > 20), "a loner plays for the goal on its own card");
});

test("an even table splits evenly", () => {
  const cards = deck(classic(), 10);
  assert.equal(cards.length, 10);
  assert.equal(count(cards, "blue"), 5);
  assert.equal(count(cards, "red"), 5);
});

test("an odd table takes the odd-player role instead of tipping one team ahead", () => {
  const cards = deck(classic(), 11);
  assert.equal(count(cards, "blue"), 5);
  assert.equal(count(cards, "red"), 5);
  assert.equal(cards.filter((c) => c.roleId === "gambler-loners").length, 1, "the Gambler is the odd player");
});

test("without an odd-player role the extra card goes to a side", () => {
  const c = classic();
  c.oddRoleId = "";
  const cards = deck(c, 11);
  assert.equal(count(cards, "blue") + count(cards, "red"), 11);
});

test("setting a card aside deals one more than the players, and it is never the President or the Bomber", () => {
  const c = classic();
  c.setAside = true;
  const cards = deck(c, 8);
  assert.equal(cards.length, 9);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i++) {
    const dealt = keepKeyCardsDealt(shuffle(cards, rnd), 8, rnd);
    assert.equal(dealt.length, 9);
    assert.ok(dealt[8].roleId !== PRESIDENT_ROLE && dealt[8].roleId !== BOMBER_ROLE);
    assert.ok(dealt.slice(0, 8).some((x) => x.roleId === PRESIDENT_ROLE));
    assert.ok(dealt.slice(0, 8).some((x) => x.roleId === BOMBER_ROLE));
  }
});

test("too many roles for the table is refused with the numbers", () => {
  const c = withCore({ ...classic(), roles: [...classic().roles, roleFrom("scout", "blue", { count: 5 })] });
  const d = buildDeck(c, 4);
  assert.ok("error" in d);
  assert.match(d.error, /7 cards.*4 to deal/);
});

test("a shuffle keeps every card and a split is as even as it can be", () => {
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const items = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual([...shuffle(items, rnd)].sort((a, b) => a - b), items);
  const g = splitGroups(7, rnd);
  assert.equal(g.filter((x) => x === 0).length, 4);
});

test("cleaning a setup clamps what arrives, drops what doesn't belong, and puts the core back", () => {
  const c = cleanConfig({
    teams: [{ id: "a", name: "A", color: "nope", fills: true }, { id: "l", name: "Loners", color: "grey", fills: false }],
    roles: [{ id: "r", libId: "scout", name: "Typed in", teamId: "a", count: 999, show: "none" }, { id: "x", libId: "made-up", teamId: "a" }, { id: "d", libId: "drifter", teamId: "l", count: 999 }],
    rounds: [{ minutes: -5, swap: 3.7 }],
    groups: false,
    extra: 1,
  });
  // A side that isn't Blue or Red is dropped with its roles; loners stay.
  assert.deepEqual(c.teams.map((t) => t.id), ["blue", "red", "l"]);
  assert.deepEqual(c.roles.map((r) => r.libId), ["president", "bomber", "drifter"]);
  assert.equal(c.roles[2].count, 60);
  assert.equal(c.roles[2].name, "Drifter");
  assert.equal(c.groups, true, "two rooms in every game");
  assert.equal(c.rounds[0].minutes, 0.25);
  assert.equal(c.rounds[0].swap, 4);
  assert.equal("extra" in c, false);
});

test("an old setup with Leaders, its own sides or a second President comes back to the core", () => {
  const c = cleanConfig({
    teams: [
      { id: "sun", name: "Sun", color: "gold", fills: true, goal: "Old goal" },
      { id: "moon", name: "Moon", color: "purple", fills: true, goal: "Old goal" },
      { id: "blue", name: "Renamed", color: "pink", fills: false, goal: "Hijacked" },
    ],
    roles: [
      { id: "l", libId: "leader", teamId: "sun" },
      { id: "p", libId: "president", teamId: "moon", count: 4 },
      { id: "s", libId: "scout", teamId: "blue" },
      { id: "m", libId: "mole", teamId: "red", showsAsTeamId: "moon" },
    ],
  });
  assert.deepEqual(c.teams.map((t) => [t.id, t.name, t.color, t.goal]), [
    ["blue", "Blue", "blue", BLUE_GOAL],
    ["red", "Red", "red", RED_GOAL],
  ]);
  assert.deepEqual(c.roles.map((r) => [r.libId, r.teamId, r.count]), [
    ["president", "blue", 1],
    ["bomber", "red", 1],
    ["scout", "blue", 1],
    ["spy", "red", 1],
  ]);
  assert.equal(c.roles[3].showsAsTeamId, "blue", "an old Mole on Red is now a Spy that shows as Blue");
  assert.equal(c.roles[3].name, "Spy");
});

test("a Spy needs a team to show as", () => {
  const c = structuredClone(PRESETS.find((p) => p.id === "tricky")!.config);
  assert.deepEqual(configProblems(c), []);
  c.roles.find((r) => r.libId === "spy")!.showsAsTeamId = "";
  assert.match(configProblems(c)[0], /Spy needs a team to show as/);
});

test("every library role is a usable role on its own, on top of the core", () => {
  for (const lib of LIBRARY) {
    const c = withCore({ ...classic(), roles: [roleFrom(lib.id, lib.group === "loner" ? "loners" : "blue", { showsAsTeamId: "red" })] });
    assert.ok("cards" in buildDeck(c, 8), lib.id);
  }
  assert.ok(!LIBRARY.some((r) => r.id === "leader" || r.id === "deputy"), "the President and Bomber replace the Leader and Deputy");
});

test("a pasted setup that repeats an id gets unique ids", () => {
  const c = cleanConfig({
    teams: [{ id: "l", name: "Loners", color: "grey", fills: false }, { id: "l", name: "Loners 2", color: "grey", fills: false }],
    roles: [{ id: "r", libId: "scout", teamId: "blue" }, { id: "r", libId: "herald", teamId: "red" }],
  });
  assert.equal(new Set(c.teams.map((t) => t.id)).size, c.teams.length);
  assert.equal(new Set(c.roles.map((r) => r.id)).size, c.roles.length);
});

test("one Spy on each side: on Blue it shows as Red, on Red as Blue, and it can be turned off", () => {
  const off = classic();
  assert.equal(hasSpyEach(off), false);
  const on = setSpyEach(off, true);
  assert.equal(hasSpyEach(on), true);
  assert.deepEqual(configProblems(on), []);
  const cards = deck(on, 10);
  const spies = cards.filter((c) => c.roleId.startsWith("spy-"));
  assert.deepEqual(spies.map((c) => [c.teamId, c.showsAsTeamId]).sort(), [["blue", "red"], ["red", "blue"]]);
  assert.equal(count(cards, "blue"), 5, "a Spy is one of its side's players");
  assert.equal(count(cards, "red"), 5);
  assert.equal(cards.filter((c) => c.roleId === PRESIDENT_ROLE).length, 1);
  // Survives a save, and turns off cleanly.
  assert.equal(hasSpyEach(cleanConfig(on)), true);
  assert.equal(setSpyEach(on, false).roles.some((r) => r.libId === "spy"), false);
  assert.equal(hasSpyEach(setSpyEach(on, true)), true, "turning it on twice still means one each");
});

test("Lovers: one on each side, always a pair, and never the card set aside", () => {
  const on = setLovers(classic(), true);
  assert.equal(hasLovers(on), true);
  assert.deepEqual(configProblems(on), []);
  const cards = deck(on, 8);
  assert.deepEqual(cards.filter((c) => c.roleId.startsWith("lover-")).map((c) => c.teamId).sort(), ["blue", "red"]);
  assert.equal(count(cards, "blue"), 4, "a Lover is one of its side's players");
  // A Lover on one side only, or two on one side, is not a pair: it is dropped on save.
  const stray = cleanConfig({ ...classic(), roles: [...classic().roles, roleFrom("lover", "blue")] });
  assert.equal(stray.roles.some((r) => r.libId === "lover"), false);
  assert.equal(hasLovers(cleanConfig(on)), true);
  assert.equal(setLovers(on, false).roles.some((r) => r.libId === "lover"), false);
  // With a card set aside, neither Lover is ever it.
  const aside = { ...on, setAside: true };
  const all = deck(aside, 6);
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i++) {
    const dealt = keepKeyCardsDealt(shuffle(all, rnd), 6, rnd);
    assert.ok(!dealt[6].roleId.startsWith("lover-") && dealt[6].roleId !== PRESIDENT_ROLE && dealt[6].roleId !== BOMBER_ROLE);
  }
});

test("a Spy can show its team and its whole card: the team share is the other colour, the card its real side", () => {
  const cards = deck(setSpyEach(classic(), true), 8);
  const blueSpy = cards.find((c) => c.roleId === "spy-blue")!;
  const redSpy = cards.find((c) => c.roleId === "spy-red")!;
  assert.equal(blueSpy.show, "any", "team or full card");
  assert.equal(blueSpy.teamId, "blue", "the full card says Blue");
  assert.equal(blueSpy.showsAsTeamId, "red", "a team share shows Red");
  assert.equal(blueSpy.goal, BLUE_GOAL, "and it plays for Blue's goal");
  assert.equal(redSpy.teamId, "red");
  assert.equal(redSpy.showsAsTeamId, "blue");
});

test("the Veil and the Bluffer are gone, and a setup that had them loads without them", () => {
  assert.ok(!LIBRARY.some((r) => r.id === "veil" || r.id === "bluffer"));
  const c = cleanConfig({ ...classic(), roles: [...classic().roles, { id: "v", libId: "veil", teamId: "blue" }, { id: "b", libId: "bluffer", teamId: "red" }] });
  assert.ok(!c.roles.some((r) => r.libId === "veil" || r.libId === "bluffer"));
  assert.deepEqual(configProblems(c), []);
});

test("a Lover is never the odd-player card", () => {
  const c = setLovers(classic(), true);
  const cleaned = cleanConfig({ ...c, oddRoleId: "lover-blue" });
  assert.equal(cleaned.oddRoleId, "");
  const cards = deck(cleaned, 5);
  assert.equal(cards.filter((x) => x.roleId.startsWith("lover-")).length, 2, "two Lovers, never three");
});

test("turning the Spies or Lovers off clears an odd-player choice that pointed at them", () => {
  const spies = { ...setSpyEach(classic(), true), oddRoleId: "spy-blue" };
  const off = setSpyEach(spies, false);
  assert.equal(off.oddRoleId, "");
  assert.deepEqual(configProblems(off), []);
  const lovers = { ...setLovers(classic(), true), oddRoleId: "lover-red" };
  assert.equal(setLovers(lovers, false).oddRoleId, "");
});

test("with a card set aside and only key cards in the deck, the deal is refused rather than setting aside the President or Bomber", () => {
  const c = { ...setLovers(classic(), true), setAside: true, oddRoleId: "" };
  const d = buildDeck(c, 3); // President, Bomber, two Lovers: four cards, all key cards
  assert.ok("error" in d);
  assert.match(d.error, /besides the President, the Bomber and the Lovers/);
  assert.ok("cards" in buildDeck(c, 4), "one more player brings an ordinary card");
});

test("a team role can't sit on Loners, and a loner role can't sit on a side", () => {
  const c = cleanConfig({
    ...classic(),
    roles: [...classic().roles, { id: "s", libId: "scout", teamId: "loners" }, { id: "d", libId: "drifter", teamId: "red" }, { id: "m", libId: "spy", teamId: "loners", showsAsTeamId: "blue" }],
  });
  assert.equal(c.roles.find((r) => r.id === "s")!.teamId, "blue");
  assert.equal(c.roles.find((r) => r.id === "d")!.teamId, "loners");
  const spy = c.roles.find((r) => r.id === "m")!;
  assert.deepEqual([spy.teamId, spy.showsAsTeamId], ["blue", "red"], "a Spy moved to Blue shows as Red, not as its own side");
  assert.deepEqual(configProblems(c), [], "and the setup can be saved");
});

test("turning the Spy switch on never leaves two roles with one id", () => {
  const tricky = structuredClone(PRESETS.find((p) => p.id === "tricky")!.config);
  const moved = { ...tricky, roles: tricky.roles.map((r) => (r.id === "spy-blue" ? { ...r, teamId: "loners" } : r)) };
  const on = setSpyEach(moved, true);
  assert.equal(new Set(on.roles.map((r) => r.id)).size, on.roles.length);
  assert.equal(hasSpyEach(on), true);
});

test("who won: Red with the President and Bomber together, Blue apart; Spies with their real side; Gambler and Lovers", async () => {
  const { result } = await import("./outcome.ts");
  const c = setLovers(setSpyEach({ ...classic(), roles: [...classic().roles, roleFrom("gambler", "loners", { id: "g" }), roleFrom("drifter", "loners", { id: "d" })] }, true), true);
  const cards = deck(c, 9);
  const by = (id: string) => cards.find((x) => x.roleId === id)!;
  const seats = [
    { name: "Pres", card: by(PRESIDENT_ROLE) },
    { name: "Bomb", card: by(BOMBER_ROLE) },
    { name: "BlueSpy", card: by("spy-blue") },
    { name: "LoverB", card: by("lover-blue") },
    { name: "LoverR", card: by("lover-red") },
    { name: "Gam", card: by("g"), bet: "red" },
    { name: "Drift", card: by("d") },
  ];
  const none = result(seats, c, null);
  assert.equal(none.side, null);
  assert.equal(none.gamblers[0].won, null);
  const together = result(seats, c, { sameRoom: true, loversTogether: true });
  assert.equal(together.side, "red");
  assert.ok(together.sideWinners.includes("Bomb") && together.sideWinners.includes("LoverR"));
  assert.ok(!together.sideWinners.includes("BlueSpy"), "a Blue Spy loses with Blue, whatever it showed");
  assert.equal(together.gamblers[0].won, true);
  assert.deepEqual(together.lovers, { names: ["LoverB", "LoverR"], won: true });
  assert.deepEqual(together.checkYourself, [{ name: "Drift", role: "Drifter" }]);
  const apart = result(seats, c, { sameRoom: false, loversTogether: false });
  assert.equal(apart.side, "blue");
  assert.ok(apart.sideWinners.includes("Pres") && apart.sideWinners.includes("BlueSpy"));
  assert.equal(apart.gamblers[0].won, false);
  assert.equal(apart.lovers!.won, false);
});
