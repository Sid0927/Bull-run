/**
 * Computer players. Each returns an ordered list of candidate actions; the driver applies
 * the first one the engine accepts. Every list ends in something always legal (play a card,
 * draw from somewhere), so a strategy never has to know every rule to stay legal — the
 * engine is the only judge.
 */
import {
  COMPANY_IDS,
  OPENING_MAX_SHARES,
  card,
  openShorts,
  price,
  type Action,
  type CompanyId,
  type GameState,
  type Holdings,
  type Seat,
  type TradeKind,
} from "../engine/index.ts";
import { Rng } from "../engine/rng.ts";

export interface Strategy {
  name: string;
  candidates(s: GameState, seat: Seat, rng: Rng): Action[];
}

// ─── Shared helpers ─────────────────────────────────────────────────────────────────────

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
      for (let i = 0; i < n; i++) {
        const c = COMPANY_IDS[rng.int(COMPANY_IDS.length)];
        orders[c] = (orders[c] ?? 0) + 1;
      }
      return [{ type: "openingOrder", player: seat, orders, card: p.hand[rng.int(p.hand.length)] }];
    }
    if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return rng.shuffle(drawChoices(s, seat, false));
    if (ph.kind !== "turn") return [];
    const out: Action[] = [];
    if (ph.actionsUsed < 2 && rng.next() < 0.6) {
      const kinds: TradeKind[] = ["buy", "sell", "short", "cover"];
      for (let i = 0; i < 12; i++) out.push(trade(seat, kinds[rng.int(4)], COMPANY_IDS[rng.int(6)], 1 + rng.int(3)));
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
    const ranked = [...COMPANY_IDS].sort((a, b) => bias[b] - bias[a]);
    if (s.debt) return forcedSells(s, seat, [...ranked].reverse());
    const ph = s.phase;
    if (ph.kind === "opening") {
      const top = ranked.filter((c) => bias[c] > 0);
      const picks = top.length ? top.slice(0, 2) : [ranked[0]];
      const orders: Partial<Holdings> = {};
      picks.forEach((c, i) => (orders[c] = picks.length === 1 ? 6 : i === 0 ? 3 : 3));
      return [{ type: "openingOrder", player: seat, orders, card: bestCard(s, seat, orders) }];
    }
    if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return drawChoices(s, seat, true);
    if (ph.kind !== "turn") return [];
    const out: Action[] = [];
    if (ph.actionsUsed < 2) {
      // Cover a short the hand is about to push up.
      for (const c of COMPANY_IDS) {
        const mine = openShorts(s, c, seat).length;
        if (mine && bias[c] > 0) for (let q = Math.min(3, mine); q >= 1; q--) out.push(trade(seat, "cover", c, q));
      }
      // Sell what the hand is against.
      for (const c of COMPANY_IDS) if (p.shares[c] && bias[c] < 0) for (let q = Math.min(3, p.shares[c]); q >= 1; q--) out.push(trade(seat, "sell", c, q));
      // Buy what it favours, keeping a little cash back.
      for (const c of ranked.filter((c) => bias[c] > 0)) {
        for (let q = 3; q >= 1; q--) if (p.cash - q * price(s, c) * 1.2 > 100) out.push(trade(seat, "buy", c, q));
      }
      // Short what it is strongly against.
      for (const c of [...ranked].reverse().filter((c) => bias[c] <= -2)) for (let q = 2; q >= 1; q--) out.push(trade(seat, "short", c, q));
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
      return [{ type: "openingOrder", player: seat, orders, card: bestCard(s, seat, orders) }];
    }
    if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return drawChoices(s, seat, true);
    if (ph.kind !== "turn") return [];
    const out: Action[] = [];
    if (ph.actionsUsed < 2) {
      // Cover any short it was left with; never opens one.
      for (const c of COMPANY_IDS) {
        const mine = openShorts(s, c, seat).length;
        if (mine) out.push(trade(seat, "cover", c, Math.min(3, mine)));
      }
      // Build towards a chairmanship in the double-dividend pair, keeping a reserve.
      const order = [...SAFE].sort((a, b) => p.shares[b] - p.shares[a] || price(s, a) - price(s, b));
      for (const c of order) for (let q = 3; q >= 1; q--) if (p.cash - q * price(s, c) * 1.2 > 300) out.push(trade(seat, "buy", c, q));
    }
    out.push(playNews(s, seat, bestCard(s, seat)));
    return out;
  },
};

export const STRATEGIES: Record<string, Strategy> = {
  random: randomPlayer,
  favour: favourPlayer,
  dividend: dividendPlayer,
};
