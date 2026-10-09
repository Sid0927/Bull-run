import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, newGame, type GameState } from "../engine/index.ts";
import { HIDDEN_CARD, eventsFor, viewFor, waitingOn } from "./view.ts";

function opened(): GameState {
  let { state } = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 99 });
  const r = apply(state, { type: "openingOrder", player: 0, orders: { HUL: 2 }, card: state.players[0].hand[0] });
  assert.ok(r.ok);
  return r.ok ? r.state : state;
}

test("a player sees their own cash and hand, nobody else's, and no seed or deck order", () => {
  const s = opened();
  const v = viewFor(s, 1);
  assert.equal(v.players[1].cash, s.players[1].cash);
  assert.deepEqual(v.players[1].hand, s.players[1].hand);
  assert.equal(v.players[0].cash, 0);
  assert.ok(v.players[0].hand.every((x) => x === HIDDEN_CARD));
  assert.equal(v.players[0].hand.length, s.players[0].hand.length);
  assert.equal(v.config.seed, 0);
  assert.equal(v.rng, 0);
  assert.ok(v.deck.every((x) => x === HIDDEN_CARD));
  assert.equal(v.deck.length, s.deck.length);
});

test("sealed opening orders show only that someone has submitted", () => {
  const s = opened();
  const v = viewFor(s, 1);
  assert.ok(v.phase.kind === "opening");
  if (v.phase.kind === "opening") {
    assert.deepEqual(v.phase.submissions[0], { orders: {}, card: HIDDEN_CARD });
    assert.equal(v.phase.submissions[1], null);
  }
  const own = viewFor(s, 0);
  if (own.phase.kind === "opening") assert.deepEqual(own.phase.submissions[0]?.orders, { HUL: 2 });
  assert.deepEqual(waitingOn(s), [1, 2]);
});

test("blind draws are hidden from everyone but the drawer", () => {
  const ev = [{ kind: "draw" as const, player: 2, from: "deck" as const, card: 17, text: "C draws blind from the deck" }];
  assert.equal((eventsFor(ev, 0)[0] as { card: number }).card, HIDDEN_CARD);
  assert.equal((eventsFor(ev, 2)[0] as { card: number }).card, 17);
});
