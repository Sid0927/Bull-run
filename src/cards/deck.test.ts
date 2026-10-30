import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, configProblems, shuffle, splitGroups } from "./deck.ts";
import { PRESETS, cleanConfig } from "./presets.ts";
import { LIBRARY, roleFrom } from "./library.ts";
import type { Config } from "./types.ts";

const twoTeams = () => structuredClone(PRESETS[0].config);
const deck = (c: Config, n: number) => {
  const d = buildDeck(c, n);
  assert.ok("cards" in d, "error" in d ? d.error : "");
  return d.cards;
};
const count = (cards: { teamId: string }[], team: string) => cards.filter((c) => c.teamId === team).length;

test("every ready-made setup is usable, except the blank one, which asks for goals", () => {
  for (const p of PRESETS.filter((p) => p.id !== "blank")) assert.deepEqual(configProblems(p.config), [], p.name);
  assert.match(configProblems(PRESETS.find((p) => p.id === "blank")!.config)[0], /Write a goal for Team A/);
});

test("every card carries its side's goal; a loner's role is its own", () => {
  const cards = deck(twoTeams(), 11);
  for (const c of cards.filter((c) => c.teamId !== "loners")) assert.ok(c.goal.length > 10, c.name);
  assert.ok(cards.filter((c) => c.teamId === "loners").every((c) => c.goal === "" && c.description.startsWith("You win")));
});

test("an even table splits evenly, with each key card once", () => {
  const cards = deck(twoTeams(), 10);
  assert.equal(cards.length, 10);
  assert.equal(count(cards, "sun"), 5);
  assert.equal(count(cards, "moon"), 5);
  assert.equal(cards.filter((c) => c.roleId === "leader-sun").length, 1);
  assert.equal(cards.filter((c) => c.roleId === "leader-moon").length, 1);
});

test("an odd table takes the odd-player role instead of tipping one team ahead", () => {
  const cards = deck(twoTeams(), 11);
  assert.equal(count(cards, "sun"), 5);
  assert.equal(count(cards, "moon"), 5);
  assert.equal(cards.filter((c) => c.roleId === "drifter-loners").length, 1);
});

test("without an odd-player role the extra card goes to a filling team", () => {
  const c = twoTeams();
  c.oddRoleId = "";
  const cards = deck(c, 11);
  assert.equal(count(cards, "sun") + count(cards, "moon"), 11);
});

test("setting a card aside deals one more than the players", () => {
  const c = twoTeams();
  c.setAside = true;
  assert.equal(deck(c, 8).length, 9);
});

test("too many roles for the table is refused with the numbers", () => {
  const c = twoTeams();
  c.roles[0].count = 6;
  const d = buildDeck(c, 4);
  assert.ok("error" in d);
  assert.match(d.error, /7 cards.*4 to deal/);
});

test("a deck with no filling team and too few roles says so", () => {
  const c = twoTeams();
  for (const t of c.teams) t.fills = false;
  const d = buildDeck(c, 6);
  assert.ok("error" in d);
  assert.match(d.error, /fills the deck/);
});

test("a filling team that already holds more roles gets fewer plain cards", () => {
  const c = structuredClone(PRESETS.find((p) => p.id === "hidden-few")!.config); // 3 infiltrators, crew fills
  const cards = deck(c, 9);
  assert.equal(count(cards, "inf"), 3);
  assert.equal(count(cards, "crew"), 6);
});

test("a shuffle keeps every card and a split is as even as it can be", () => {
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const items = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual([...shuffle(items, rnd)].sort((a, b) => a - b), items);
  const g = splitGroups(7, rnd);
  assert.equal(g.filter((x) => x === 0).length, 4);
});

test("cleaning a setup clamps what arrives and drops what does not belong", () => {
  const c = cleanConfig({ teams: [{ id: "a", name: "A", color: "nope", fills: "yes" }], roles: [{ id: "r", libId: "leader", name: "Typed in", teamId: "a", count: 999, show: "none" }, { id: "x", libId: "made-up", name: "Custom", teamId: "a" }, { id: "y", name: "No library", teamId: "a" }], rounds: [{ minutes: -5, swap: 3.7 }], extra: 1 });
  assert.equal(c.teams[0].color, "grey");
  assert.equal(c.teams[0].fills, false);
  assert.equal(c.roles.length, 1, "only library roles survive");
  assert.equal(c.roles[0].name, "Leader");
  assert.equal(c.roles[0].count, 60);
  assert.equal(c.roles[0].show, "any");
  assert.equal(c.rounds[0].minutes, 0.25);
  assert.equal(c.rounds[0].swap, 4);
  assert.equal("extra" in c, false);
});

test("a Mole needs a team to show as", () => {
  const c = structuredClone(PRESETS.find((p) => p.id === "tricky")!.config);
  assert.deepEqual(configProblems(c), []);
  c.roles.find((r) => r.libId === "mole")!.showsAsTeamId = "";
  assert.match(configProblems(c)[0], /Mole needs a team to show as/);
});

test("every library role is a usable role on its own", () => {
  for (const lib of LIBRARY) {
    const c = structuredClone(PRESETS.find((p) => p.id === "blank")!.config);
    for (const t of c.teams) t.goal = "Win.";
    c.roles = [roleFrom(lib.id, "t1", { showsAsTeamId: "t2" })];
    assert.ok("cards" in buildDeck(c, 8), lib.id);
  }
});

test("a pasted setup that repeats an id gets unique ids", () => {
  const c = cleanConfig({
    teams: [{ id: "a", name: "A", color: "red", fills: true, goal: "x" }, { id: "a", name: "B", color: "blue", fills: true, goal: "y" }],
    roles: [{ id: "r", libId: "leader", teamId: "a" }, { id: "r", libId: "scout", teamId: "a" }],
  });
  assert.equal(new Set(c.teams.map((t) => t.id)).size, 2);
  assert.equal(new Set(c.roles.map((r) => r.id)).size, 2);
});

test("President & Bomber: one of each, on opposite sides, each with its side's goal", () => {
  const c = structuredClone(PRESETS.find((p) => p.id === "president-bomber")!.config);
  for (const n of [5, 8, 11]) {
    const cards = deck(c, n);
    const president = cards.filter((x) => x.roleId === "president-gov");
    const bomber = cards.filter((x) => x.roleId === "bomber-reb");
    assert.equal(president.length, 1);
    assert.equal(bomber.length, 1);
    assert.equal(president[0].teamId, "gov");
    assert.equal(bomber[0].teamId, "reb");
    assert.match(president[0].goal, /different groups/);
    assert.match(bomber[0].goal, /same group as the President/);
    assert.match(president[0].description, /Stay away from the Bomber/);
    assert.match(bomber[0].description, /Get to the President/);
  }
  // Either card can be put on any side by the host, like every library role.
  assert.equal(roleFrom("bomber", "gov").teamId, "gov");
});
