import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, configProblems, keepKeyCardsDealt, shuffle, splitGroups } from "./deck.ts";
import { BLUE_GOAL, BOMBER_ROLE, PRESIDENT_ROLE, RED_GOAL, withCore } from "./core.ts";
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
  assert.ok(cards.filter((c) => c.teamId === "loners").every((c) => c.goal === "" && c.description.startsWith("You win")));
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
  assert.equal(cards.filter((c) => c.roleId === "drifter-loners").length, 1);
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
    const dealt = keepKeyCardsDealt(shuffle(cards, rnd), 8);
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
    ["mole", "red", 1],
  ]);
  assert.equal(c.roles[3].showsAsTeamId, "blue", "a Mole on Red shows as Blue");
});

test("a Mole needs a team to show as", () => {
  const c = structuredClone(PRESETS.find((p) => p.id === "tricky")!.config);
  assert.deepEqual(configProblems(c), []);
  c.roles.find((r) => r.libId === "mole")!.showsAsTeamId = "";
  assert.match(configProblems(c)[0], /Mole needs a team to show as/);
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
