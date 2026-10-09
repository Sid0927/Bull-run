/**
 * What one player may see. The server sends each phone only this, so hidden information (other
 * players' cash and cards, sealed orders and bids, the deck order, the seed) never leaves it.
 *
 * The view keeps the GameState shape so the same screens render it: hidden numbers become 0 and
 * hidden cards become 0 (an id no card has), which keeps counts like "4 cards" right.
 */
import type { Action, GameEvent, GameState, Seat } from "../engine/index.ts";

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

/**
 * Events as one player may see them: a card drawn blind is known only to whoever drew it, and
 * the cash in a round-end snapshot only to its owner until the game is over. Any mention of the
 * seed is stripped (it would let anyone rebuild every hand and the deck).
 */
export function eventsFor(events: GameEvent[], seat: Seat | null, ended = false): GameEvent[] {
  return events.map((e) => {
    let out = e;
    if (e.kind === "draw" && e.from === "deck" && e.player !== seat) out = { ...e, card: HIDDEN_CARD };
    if (e.kind === "roundEnd" && !ended) out = { ...e, cash: e.cash.map((c, i) => (i === seat ? c : 0)) };
    if (/seed\s*\d/i.test(out.text)) out = { ...out, text: out.text.replace(/\s*·?\s*seed\s*-?\d+/gi, "") };
    return out;
  });
}

/** An action rebuilt from only the fields its type has, so nothing else is applied or stored. */
export function cleanAction(raw: unknown, seat: Seat): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);
  const str = (v: unknown) => (typeof v === "string" && v.length <= 16 ? v : "");
  switch (a.type) {
    case "openingOrder": {
      const orders: Record<string, number> = {};
      if (a.orders && typeof a.orders === "object") for (const [k, v] of Object.entries(a.orders).slice(0, 12)) orders[str(k)] = int(v);
      return { type: "openingOrder", player: seat, orders, card: int(a.card) } as Action;
    }
    case "draw":
      return a.from === "market" ? { type: "draw", player: seat, from: "market", slot: int(a.slot) } : { type: "draw", player: seat, from: "deck" };
    case "trade": {
      const t: Record<string, unknown> = { type: "trade", player: seat, kind: str(a.kind), company: str(a.company), qty: int(a.qty) };
      if (Array.isArray(a.shortIds)) t.shortIds = a.shortIds.slice(0, 3).map(int);
      return t as unknown as Action;
    }
    case "playNews":
      return { type: "playNews", player: seat, card: int(a.card) };
    case "ipoBid":
      return { type: "ipoBid", player: seat, qty: int(a.qty), price: int(a.price) };
    case "forcedSell":
      return { type: "forcedSell", player: seat, company: str(a.company) as never, qty: int(a.qty) };
    default:
      return null;
  }
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
