/**
 * What one player may see. The server sends each phone only this, so hidden information (other
 * players' cash and cards, sealed orders and bids, the deck order, the seed) never leaves it.
 *
 * The view keeps the GameState shape so the same screens render it: hidden numbers become 0 and
 * hidden cards become 0 (an id no card has), which keeps counts like "4 cards" right.
 */
import type { GameEvent, GameState, Seat } from "../engine/index.ts";

export const HIDDEN_CARD = 0;

export function viewFor(s: GameState, seat: Seat | null): GameState {
  const v = structuredClone(s);
  const ended = s.phase.kind === "ended";
  v.rng = 0;
  v.config = { ...v.config, seed: 0 };
  v.deck = v.deck.map(() => HIDDEN_CARD);
  v.players = v.players.map((p, i) =>
    i === seat || ended ? p : { ...p, cash: 0, hand: p.hand.map(() => HIDDEN_CARD) },
  );
  v.pendingNews = v.pendingNews.map((id, i) => (id === null || i === seat ? id : HIDDEN_CARD));
  if (v.phase.kind === "opening") {
    v.phase = { ...v.phase, submissions: v.phase.submissions.map((x, i) => (x === null || i === seat ? x : { orders: {}, card: HIDDEN_CARD })) };
  }
  if (v.phase.kind === "ipo") {
    v.phase = { ...v.phase, bids: v.phase.bids.map((x, i) => (x === null || i === seat ? x : { qty: 0, price: 0 })) };
  }
  return v;
}

/** Events as one player may see them: a card drawn blind is known only to whoever drew it. */
export function eventsFor(events: GameEvent[], seat: Seat | null): GameEvent[] {
  return events.map((e) => (e.kind === "draw" && e.from === "deck" && e.player !== seat ? { ...e, card: HIDDEN_CARD } : e));
}

/** Whether the game is waiting on this seat (several seats at once in the opening and the IPO). */
export function waitingOn(s: GameState): Seat[] {
  if (s.debt) return [s.debt.player];
  switch (s.phase.kind) {
    case "opening":
      return s.phase.submissions.flatMap((x, i) => (x === null ? [i] : []));
    case "ipo":
      return s.phase.bids.flatMap((x, i) => (x === null ? [i] : []));
    case "openingDraw":
      return [s.phase.next];
    case "turn":
      return [s.phase.player];
    case "ended":
      return [];
  }
}
