import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, configProblems, shuffle, splitGroups } from "./deck.ts";
import { PRESETS, cleanConfig } from "./presets.ts";
import type { Config } from "./types.ts";

const twoTeams = () => structuredClone(PRESETS[0].config);
const deck = (c: Config, n: number) => {
  const d = buildDeck(c, n);
  assert.ok("cards" in d, "error" in d ? d.error : "");
  return d.cards;
};
const count = (cards: { teamId: string }[], team: string) => cards.filter((c) => c.teamId === team).length;

test("every preset is a usable setup", () => {
  for (const p of PRESETS) assert.deepEqual(configProblems(p.config), [], p.name);
});

test("an even table splits evenly, with each key card once", () => {
  const cards = deck(twoTeams(), 10);
  assert.equal(cards.length, 10);
  assert.equal(count(cards, "sun"), 5);
  assert.equal(count(cards, "moon"), 5);
  assert.equal(cards.filter((c) => c.roleId === "sun-lead").length, 1);
  assert.equal(cards.filter((c) => c.roleId === "moon-lead").length, 1);
});

test("an odd table takes the odd-player role instead of tipping one team ahead", () => {
  const cards = deck(twoTeams(), 11);
  assert.equal(count(cards, "sun"), 5);
  assert.equal(count(cards, "moon"), 5);
  assert.equal(cards.filter((c) => c.roleId === "drifter").length, 1);
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
  const c = structuredClone(PRESETS[1].config); // 3 infiltrators + captain, crew fills
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
  const c = cleanConfig({ teams: [{ id: "a", name: "A", color: "nope", fills: "yes" }], roles: [{ id: "r", name: "R", teamId: "a", count: 999, show: "sometimes" }], rounds: [{ minutes: -5, swap: 3.7 }], extra: 1 });
  assert.equal(c.teams[0].color, "grey");
  assert.equal(c.teams[0].fills, false);
  assert.equal(c.roles[0].count, 60);
  assert.equal(c.roles[0].show, "any");
  assert.equal(c.rounds[0].minutes, 0.25);
  assert.equal(c.rounds[0].swap, 4);
  assert.equal("extra" in c, false);
});
