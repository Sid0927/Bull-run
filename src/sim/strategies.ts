/**
 * Computer players. Each returns an ordered list of candidate actions; the driver applies
 * the first one the engine accepts. Every list ends in something always legal (play a card,
 * draw from somewhere), so a strategy never has to know every rule to stay legal — the
 * engine is the only judge.
 */
import {
  COMPANY_IDS,
  IPO_COMPANY,
  ipoBandOf,
  ipoMaxBidOf,
  OPENING_MAX_SHARES,
  card,
  isLive,
  openShorts,
  price,
  type Action,
  type CompanyId,
  type GameState,
  type Holdings,
  type Seat,
  type TradeKind,
  tradeRoom,
} from "../engine/index.ts";
import { Rng } from "../engine/rng.ts";

export interface Strategy {
  name: string;
  candidates(s: GameState, seat: Seat, rng: Rng): Action[];
}

// ─── Shared helpers ─────────────────────────────────────────────────────────────────────

/** Trim opening orders, dearest share first, until the seat can pay for them all. */
function affordable(s: GameState, seat: Seat, orders: Partial<Holdings>): Partial<Holdings> {
  const out = { ...orders };
  const cost = () => Object.entries(out).reduce((n, [c, q]) => n + (q ?? 0) * price(s, c as CompanyId), 0);
  while (cost() > s.players[seat].cash) {
    const dearest = (Object.keys(out) as CompanyId[]).filter((c) => (out[c] ?? 0) > 0).sort((a, b) => price(s, b) - price(s, a))[0];
    out[dearest] = (out[dearest] ?? 0) - 1;
  }
  return out;
}

/** Companies that can be traded now. */
const live = (s: GameState) => COMPANY_IDS.filter((c) => isLive(s, c));

/** An IPO bid the seat can afford: the most shares up to `qty` at `price`. */
/** `level` 0–1 picks a price from the band, low to high; `qty` is capped by the game's limit and cash. */
function ipoBid(s: GameState, seat: Seat, qty: number, level: number): Action {
  const band = [...ipoBandOf(s.config)].sort((a, b) => a - b);
  const price = band[Math.min(band.length - 1, Math.round(level * (band.length - 1)))];
  const cash = s.players[seat].cash;
  const q = Math.max(0, Math.min(qty, ipoMaxBidOf(s.config), Math.floor(cash / price)));
  return { type: "ipoBid", player: seat, qty: q, price };
}

/** Net steps the cards in a hand would move each company. */
export function handBias(hand: number[]): Record<CompanyId, number> {
  const b = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
  for (const id of hand) for (const [c, v] of Object.entries(card(id).effects) as [CompanyId, number][]) b[c] += v;
  return b;
}

/** Rough rupee effect of a card on a seat's position: steps × (long − short) × price. */
function cardValue(s: GameState, seat: Seat, id: number, exposure?: Partial<Holdings>): number {
  let v = 0;
  for (const [c, steps] of Object.entries(card(id).effects) as [CompanyId, number][]) {
    if (s.companies[c].bankrupt) continue;
    const net = exposure ? (exposure[c] ?? 0) : s.players[seat].shares[c] - openShorts(s, c, seat).length;
    v += steps * net * Math.max(10, price(s, c) * 0.1);
  }
  return v;
}

function bestCard(s: GameState, seat: Seat, exposure?: Partial<Holdings>): number {
  const hand = s.players[seat].hand;
  return [...hand].sort((a, b) => cardValue(s, seat, b, exposure) - cardValue(s, seat, a, exposure))[0];
}

function playNews(s: GameState, seat: Seat, id: number): Action {
  return { type: "playNews", player: seat, card: id };
}

function drawChoices(s: GameState, seat: Seat, preferMarket: boolean): Action[] {
  const market = s.market
    .map((id, slot) => ({ id, slot }))
    .filter((x): x is { id: number; slot: number } => x.id !== null)
    .sort((a, b) => cardValue(s, seat, b.id) - cardValue(s, seat, a.id));
  const deck: Action = { type: "draw", player: seat, from: "deck" };
  const fromMarket = market.map((m) => ({ type: "draw", player: seat, from: "market", slot: m.slot }) as Action);
  const good = market.length && cardValue(s, seat, market[0].id) > 0;
  return preferMarket && good ? [...fromMarket, deck] : [deck, ...fromMarket];
}

function trade(seat: Seat, kind: TradeKind, company: CompanyId, qty: number): Action {
  return { type: "trade", player: seat, kind, company, qty };
}

function forcedSells(s: GameState, seat: Seat, order: CompanyId[]): Action[] {
  return order.filter((c) => s.players[seat].shares[c] > 0 && !s.companies[c].bankrupt).map((c) => ({ type: "forcedSell", player: seat, company: c, qty: 1 }) as Action);
}

// ─── Random legal player ────────────────────────────────────────────────────────────────

export const randomPlayer: Strategy = {
  name: "random",
  candidates(s, seat, rng) {
    const p = s.players[seat];
    if (s.debt) return forcedSells(s, seat, rng.shuffle([...COMPANY_IDS]));
    const ph = s.phase;
    if (ph.kind === "opening") {
      const orders: Partial<Holdings> = {};
      const n = rng.int(OPENING_MAX_SHARES + 1);
      const open = live(s);
      for (let i = 0; i < n; i++) {
        const c = open[rng.int(open.length)];
        orders[c] = (orders[c] ?? 0) + 1;
      }
      return [{ type: "openingOrder", player: seat, orders: affordable(s, seat, orders), card: p.hand[rng.int(p.hand.length)] }];
    }
    if (ph.kind === "ipo") return [ipoBid(s, seat, rng.int(ipoMaxBidOf(s.config) + 1), rng.next())];
    if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return rng.shuffle(drawChoices(s, seat, false));
    if (ph.kind !== "turn") return [];
    const out: Action[] = [];
    if (tradeRoom(s) > 0 && rng.next() < 0.6) {
      const room = tradeRoom(s);
      const kinds: TradeKind[] = ["buy", "sell", "short", "cover"];
      for (let i = 0; i < 12; i++) out.push(trade(seat, kinds[rng.int(4)], COMPANY_IDS[rng.int(COMPANY_IDS.length)], 1 + rng.int(room)));
    }
    out.push(playNews(s, seat, p.hand[rng.int(p.hand.length)]));
    return out;
  },
};

// ─── "Buy what my cards favour" ─────────────────────────────────────────────────────────

export const favourPlayer: Strategy = {
  name: "favour",
  candidates(s, seat) {
    const p = s.players[seat];
    const bias = handBias(p.hand);
    const ranked = live(s).sort((a, b) => bias[b] - bias[a]);
    if (s.debt) return forcedSells(s, seat, [...ranked].reverse());
    const ph = s.phase;
    if (ph.kind === "opening") {
      const top = ranked.filter((c) => bias[c] > 0 && s.companies[c].listed);
      const picks = top.length ? top.slice(0, 2) : [ranked[0]];
      const orders: Partial<Holdings> = {};
      picks.forEach((c, i) => (orders[c] = picks.length === 1 ? 6 : i === 0 ? 3 : 3));
      return [{ type: "openingOrder", player: seat, orders: affordable(s, seat, orders), card: bestCard(s, seat, orders) }];
    }
    // The IPO pops on a full book, so it bids for the lot, and pays up when its hand likes Oracle Group.
    if (ph.kind === "ipo") return [ipoBid(s, seat, ipoMaxBidOf(s.config), bias[IPO_COMPANY] > 0 ? 1 : 0.67)];
    if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return drawChoices(s, seat, true);
    if (ph.kind !== "turn") return [];
    const out: Action[] = [];
    if (tradeRoom(s) > 0) {
      const room = tradeRoom(s);
      // Cover a short the hand is about to push up.
      for (const c of COMPANY_IDS) {
        const mine = openShorts(s, c, seat).length;
        if (mine && bias[c] > 0) for (let q = Math.min(room, mine); q >= 1; q--) out.push(trade(seat, "cover", c, q));
      }
      // Sell what the hand is against.
      for (const c of COMPANY_IDS) if (p.shares[c] && bias[c] < 0) for (let q = Math.min(room, p.shares[c]); q >= 1; q--) out.push(trade(seat, "sell", c, q));
      // Buy what it favours, keeping a little cash back.
      for (const c of ranked.filter((c) => bias[c] > 0)) {
        for (let q = room; q >= 1; q--) if (p.cash - q * price(s, c) * 1.2 > 100) out.push(trade(seat, "buy", c, q));
      }
      // Short what it is strongly against.
      for (const c of [...ranked].reverse().filter((c) => bias[c] <= -2)) for (let q = Math.min(2, room); q >= 1; q--) out.push(trade(seat, "short", c, q));
    }
    out.push(playNews(s, seat, bestCard(s, seat)));
    return out;
  },
};

// ─── Defensive dividend player ──────────────────────────────────────────────────────────

const SAFE: CompanyId[] = ["HUL", "HDFC"];

export const dividendPlayer: Strategy = {
  name: "dividend",
  candidates(s, seat) {
    const p = s.players[seat];
    if (s.debt) return forcedSells(s, seat, [...COMPANY_IDS.filter((c) => !SAFE.includes(c)), ...SAFE]);
    const ph = s.phase;
    if (ph.kind === "opening") {
      const orders = { HUL: 3, HDFC: 3 };
      return [{ type: "openingOrder", player: seat, orders: affordable(s, seat, orders), card: bestCard(s, seat, orders) }];
    }
    // Oracle Group pays no dividend: a small bid at the bottom of the band, for the pop only.
    if (ph.kind === "ipo") return [ipoBid(s, seat, 2, 0)];
    if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return drawChoices(s, seat, true);
    if (ph.kind !== "turn") return [];
    const out: Action[] = [];
    if (tradeRoom(s) > 0) {
      const room = tradeRoom(s);
      // Cover any short it was left with; never opens one.
      for (const c of COMPANY_IDS) {
        const mine = openShorts(s, c, seat).length;
        if (mine) out.push(trade(seat, "cover", c, Math.min(room, mine)));
      }
      // Build towards a chairmanship in the double-dividend pair, keeping a reserve.
      const order = [...SAFE].sort((a, b) => p.shares[b] - p.shares[a] || price(s, a) - price(s, b));
      for (const c of order) for (let q = room; q >= 1; q--) if (p.cash - q * price(s, c) * 1.2 > 300) out.push(trade(seat, "buy", c, q));
    }
    out.push(playNews(s, seat, bestCard(s, seat)));
    return out;
  },
};

// ─── Follower: reads the tape ───────────────────────────────────────────────────────────

/**
 * Copies what the player before it just did: buys what they bought, shorts what they shorted.
 * It stands in for a table reading a player's trades as a clue to the card they hold, which is
 * the reaction the delayed-news rule gives everybody a lap to make.
 */
export const followerPlayer: Strategy = {
  name: "follower",
  candidates(s, seat, rng) {
    const ph = s.phase;
    if (s.debt || ph.kind !== "turn" || ph.step !== "trade") return favourPlayer.candidates(s, seat, rng);
    const p = s.players[seat];
    const n = s.players.length;
    const prev = (seat - 1 + n) % n;
    // The previous seat's latest turn: this round, unless this seat starts the round.
    const theirRound = seat === s.startPlayer ? s.round - 1 : s.round;
    const theirs = s.tape.filter((t) => t.seat === prev && t.round === theirRound);
    const out: Action[] = [];
    if (tradeRoom(s) > 0) {
      const room = tradeRoom(s);
      // Copy their trades in the order they made them, one per action already taken.
      for (const t of theirs.slice(ph.actionsUsed)) {
        if (t.kind === "buy") for (let q = Math.min(room, t.qty); q >= 1; q--) if (p.cash - q * price(s, t.company) * 1.2 > 100) out.push(trade(seat, "buy", t.company, q));
        if (t.kind === "short" || t.kind === "sell") {
          if (p.shares[t.company]) out.push(trade(seat, "sell", t.company, Math.min(room, p.shares[t.company])));
          out.push(trade(seat, "short", t.company, 1));
        }
      }
    }
    // If nothing can be copied (or every copy is refused), trade as the card-led player would.
    return [...out, ...favourPlayer.candidates(s, seat, rng)];
  },
};

export const STRATEGIES: Record<string, Strategy> = {
  random: randomPlayer,
  favour: favourPlayer,
  dividend: dividendPlayer,
  follower: followerPlayer,
};
