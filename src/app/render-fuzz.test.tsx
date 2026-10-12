/**
 * Draws every part of the game screen for every position of many computer-played games, from each
 * player's view and the admin's, and fails on anything that throws. A render that throws blanks the
 * whole page, so this is the net under "the screen went white".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { apply, newGame, type GameEvent, type GameState, type Seat } from "../engine/index.ts";
import { Rng } from "../engine/rng.ts";
import { eventsFor, viewFor, waitingOn } from "../shared/view.ts";
import { STRATEGIES } from "../sim/strategies.ts";
import { summarize } from "./activity.ts";
import { Activity, Hud, MarketTable, SummaryCard } from "./game-ui.tsx";
import { priceHistory } from "./history.ts";
import { AdminDesks, EndScreen, Log, Market, MyPosition, NewsCardView, Players, Private, RoundTracker, Ticker, cardImpact } from "./parts.tsx";

const noop = () => {};

function drawAll(s: GameState, all: GameEvent[], seat: Seat | null, reveal: boolean) {
  const v = viewFor(s, seat, reveal);
  const evs = eventsFor(all, seat, s.phase.kind === "ended", reveal);
  const times = evs.map(() => new Date(0).toISOString());
  const hist = priceHistory(v, evs);
  const sums = summarize(evs, v, seat);
  const waiting = s.phase.kind === "ended" ? [] : waitingOn(s);
  const parts: ReactElement[] = [
    h(Hud, { s: v, status: "x", sub: "y", mine: seat !== null && waiting.includes(seat), mySeat: seat, waitingOn: waiting }),
    h(MarketTable, { s: v, hist }),
    h(Activity, { sums, s: v, times }),
    h(Players, { s: v, viewer: seat, reveal }),
    h(Market, { s: v }),
    h(RoundTracker, { s: v }),
    h(Ticker, { s: v, hist }),
    h(Log, { events: evs, times }),
    ...sums.slice(0, 3).map((x) => h(SummaryCard, { x, s: v, at: null, latest: true, max: 4 })),
  ];
  if (v.phase.kind === "ended") parts.push(h(EndScreen, { s: v, viewer: seat, onNew: noop }));
  else if (seat === null) parts.push(h(AdminDesks, { s: v }));
  else {
    if (waiting.includes(seat)) parts.push(h(Private, { s: v, seat, play: noop }));
    if (v.phase.kind === "turn") parts.push(h(MyPosition, { s: v, seat }));
    for (const id of v.players[seat].hand) parts.push(h(NewsCardView, { id, impact: cardImpact(v, seat, id) }));
    const pending = v.pendingNews[seat];
    if (pending !== null && pending !== undefined) parts.push(h(NewsCardView, { id: pending }));
  }
  for (const el of parts) renderToString(el);
}

test("every screen part draws at every step of 15 games, for every viewer", () => {
  const styles = Object.values(STRATEGIES);
  for (let g = 0; g < 15; g++) {
    const players = 3 + (g % 3);
    const rounds = ([6, 9, 12] as const)[g % 3];
    let { state, events } = newGame({ players: Array.from({ length: players }, (_, i) => `P${i}`), rounds, seed: 1000 + g, ipoReshuffleAll: g % 4 !== 0 });
    const all = [...events];
    const rng = new Rng(g);
    for (let step = 0; state.phase.kind !== "ended"; step++) {
      assert.ok(step < 5000);
      // Every few steps (and every step near the IPO), draw the screen as everyone sees it.
      if (step % 8 === 0 || state.round === 4) {
        for (const seat of [...Array(players).keys(), null] as (Seat | null)[]) {
          try {
            drawAll(state, all, seat, seat === null);
          } catch (e) {
            assert.fail(`game ${g}, step ${step}, round ${state.round}, ${state.phase.kind}, viewer ${seat}: ${(e as Error).stack}`);
          }
        }
      }
      const seat = waitingOn(state)[0];
      let moved = false;
      for (const a of styles[(seat + g) % styles.length].candidates(state, seat, rng)) {
        const r = apply(state, a);
        if (r.ok) {
          state = r.state;
          all.push(...r.events);
          moved = true;
          break;
        }
      }
      assert.ok(moved);
    }
    for (const seat of [...Array(players).keys(), null] as (Seat | null)[]) drawAll(state, all, seat, seat === null);
  }
});
