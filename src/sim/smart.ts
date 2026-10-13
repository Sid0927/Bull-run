/**
 * A computer player that plays to win. Instead of a rule of thumb, it tries every move it could
 * make, plays each one out on a copy of the game, and scores where that leaves it:
 *
 *   cash + shares and shorts at the price they are expected to reach + dividends still to come
 *
 * "Expected to reach" counts the news it knows about: the card it is about to place (certain to
 * land next lap, if there is a next lap) and the rest of its hand (likely to be played later),
 * and nothing it can't know. Dividends count the payouts still left in the game, with the
 * chairman's bonus when a holding is big enough. Cards are also judged by who else they help:
 * a card that lifts the leader as much as it lifts the bot is a worse card.
 *
 * It decides only from what its own seat may see (the server hands it its player view), so it
 * cannot peek at hands or the deck.
 */
import {
  CHAIRMAN_MULTIPLIER,
  CHAIRMAN_SHARES,
  COMPANY_IDS,
  DIVIDEND_ROUNDS,
  IPO_COMPANY,
  OPENING_MAX_SHARES,
  TOP,
  TRACK,
  apply,
  card,
  coChairmanMultiplierOf,
  dividendPerShare,
  ipoBandOf,
  ipoMaxBidOf,
  isLive,
  netWorth,
  openShorts,
  price,
  startPrice,
  tradeRoom,
  type Action,
  type CompanyId,
  type GameState,
  type Holdings,
  type Seat,
  type TradeKind,
} from "../engine/index.ts";
import type { Strategy } from "./strategies.ts";

/** How much a card in hand (not yet played) is worth against one about to be placed. */
const HAND_WEIGHT = 0.45;
/** How much a payout further off is trusted (prices move before then). */
const DIVIDEND_WEIGHT = 0.85;
/** How much it cares about a card helping the player doing best. */
const SPITE = 0.4;

type Steps = Partial<Record<CompanyId, number>>;

/** The price a company would be at after moving some steps (a fall to the bottom is bankruptcy). */
function priceAfter(s: GameState, c: CompanyId, steps: number): number {
  const i = s.companies[c].priceIndex;
  return TRACK[Math.max(0, Math.min(TOP, Math.round(i + steps)))];
}

function cardSteps(id: number, s: GameState): Steps {
  const out: Steps = {};
  for (const [c, v] of Object.entries(card(id).effects) as [CompanyId, number][]) if (isLive(s, c)) out[c] = (out[c] ?? 0) + v;
  return out;
}

function addSteps(into: Steps, add: Steps, w: number) {
  for (const [c, v] of Object.entries(add) as [CompanyId, number][]) into[c] = (into[c] ?? 0) + v * w;
}

/** How many more turns this seat gets after the current point in the game. */
function turnsAfterThis(s: GameState): number {
  return Math.max(0, s.config.rounds - Math.max(1, s.round));
}

/** Dividend rounds still to be paid, counting this round's if it hasn't been paid yet. */
function payoutsLeft(s: GameState): number {
  return (DIVIDEND_ROUNDS as readonly number[]).filter((r) => r >= Math.max(1, s.round) && r <= s.config.rounds).length;
}

/** The seat's expected worth at the end, given the news it expects (in steps per company). */
function worth(s: GameState, seat: Seat, steps: Steps): number {
  const p = s.players[seat];
  let v = p.cash;
  const payouts = payoutsLeft(s);
  for (const c of COMPANY_IDS) {
    if (!s.companies[c].listed) continue;
    const shorts = openShorts(s, c, seat).length;
    if (!p.shares[c] && !shorts) continue;
    const exp = s.companies[c].bankrupt ? 0 : priceAfter(s, c, steps[c] ?? 0);
    v += (p.shares[c] - shorts) * exp;
    if (!payouts || s.companies[c].bankrupt) continue;
    const d = dividendPerShare(c, exp, s.config.dividendBands, s.config.ipoPaysDividend === true && c === IPO_COMPANY);
    if (!d) continue;
    let perPayout = d * (p.shares[c] - shorts);
    if (p.shares[c] >= CHAIRMAN_SHARES) {
      const rivals = s.players.filter((x, i) => i !== seat && x.shares[c] >= CHAIRMAN_SHARES).length;
      perPayout += d * (rivals === 0 ? (s.config.chairmanMultiplier ?? CHAIRMAN_MULTIPLIER) : rivals === 1 ? coChairmanMultiplierOf(s.config) : 0);
    }
    v += perPayout * payouts * DIVIDEND_WEIGHT;
  }
  // Running out of cash with shorts open means selling at a bad moment: keep a little back.
  const owing = COMPANY_IDS.reduce((n, c) => n + openShorts(s, c, seat).length * 40, 0);
  if (p.cash < owing) v -= (owing - p.cash) * 1.5;
  return v;
}

/** Rupees a card would make (or cost) a seat at today's holdings and prices. */
function cardGain(s: GameState, seat: Seat, id: number): number {
  const p = s.players[seat];
  let v = 0;
  for (const [c, n] of Object.entries(cardSteps(id, s)) as [CompanyId, number][]) {
    const net = p.shares[c] - openShorts(s, c, seat).length;
    v += net * (priceAfter(s, c, n) - price(s, c));
  }
  return v;
}

/** The other player doing best, by what is public: their shares at today's prices. */
function leader(s: GameState, seat: Seat): Seat | null {
  let best: Seat | null = null;
  let bestV = -Infinity;
  s.players.forEach((_, i) => {
    if (i === seat) return;
    const v = netWorth(s, i).sharesValue - netWorth(s, i).shortsCost;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  });
  return best;
}

/** How good a card is to play now: what it does for the seat, less what it does for the leader. */
function playValue(s: GameState, seat: Seat, id: number): number {
  const lead = leader(s, seat);
  return cardGain(s, seat, id) - (lead === null ? 0 : SPITE * Math.max(0, cardGain(s, lead, id)));
}

/** The steps the seat expects: the card being placed now, plus the rest of the hand, weighted. */
function expected(s: GameState, seat: Seat, placing: number | null, hand: number[]): Steps {
  const steps: Steps = {};
  const left = turnsAfterThis(s);
  if (placing !== null && left >= 1) addSteps(steps, cardSteps(placing, s), 1);
  const handW = left >= 2 ? HAND_WEIGHT * Math.min(1, (left - 1) / 3) : 0;
  for (const id of hand) if (id !== placing) addSteps(steps, cardSteps(id, s), handW);
  return steps;
}

/** A copy to try moves on. Others' cash is hidden from this seat, so assume they can pay. */
function sandbox(s: GameState, seat: Seat): GameState {
  const t = structuredClone(s);
  t.players.forEach((p, i) => {
    if (i !== seat) p.cash = 1_000_000;
  });
  return t;
}

function trade(seat: Seat, kind: TradeKind, company: CompanyId, qty: number): Action {
  return { type: "trade", player: seat, kind, company, qty };
}

// ─── Each kind of decision ──────────────────────────────────────────────────────────────

function turnMoves(s: GameState, seat: Seat): Action[] {
  const hand = s.players[seat].hand;
  const box = sandbox(s, seat);
  // Score a position with the best card to place from it.
  const score = (t: GameState) => {
    let best = -Infinity;
    let pick = hand[0];
    for (const id of hand) {
      const v = worth(t, seat, expected(t, seat, id, hand)) + (playValue(t, seat, id) - cardGain(t, seat, id)) * 0.5;
      if (v > best) {
        best = v;
        pick = id;
      }
    }
    return { v: best, pick };
  };
  const stay = score(box);
  const options: { a: Action; v: number }[] = [];
  const room = tradeRoom(s);
  if (room > 0) {
    for (const c of COMPANY_IDS) {
      if (!isLive(s, c)) continue;
      for (const kind of ["buy", "sell", "short", "cover"] as TradeKind[]) {
        for (let q = 1; q <= room; q++) {
          const a = trade(seat, kind, c, q);
          const r = apply(box, a);
          if (!r.ok || r.state.debt) continue;
          options.push({ a, v: score(r.state).v });
        }
      }
    }
  }
  options.sort((x, y) => y.v - x.v);
  // Trade only when it beats standing pat by a margin; otherwise place the best card.
  const worthIt = options.filter((o) => o.v > stay.v + 8).map((o) => o.a);
  return [...worthIt, { type: "playNews", player: seat, card: stay.pick }, ...hand.map((id) => ({ type: "playNews", player: seat, card: id }) as Action)];
}

function drawMoves(s: GameState, seat: Seat): Action[] {
  const hand = s.players[seat].hand;
  const left = turnsAfterThis(s);
  // A card drawn now is played on a later turn and lands the turn after that.
  const useful = left >= 2 ? 1 : left >= 1 ? 0.3 : 0;
  const lead = leader(s, seat);
  const market = s.market
    .map((id, slot) => ({ id, slot }))
    .filter((x): x is { id: number; slot: number } => x.id !== null)
    .map((x) => {
      const deny = lead === null ? 0 : 0.25 * Math.max(0, cardGain(s, lead, x.id));
      return { ...x, v: useful * playValue(s, seat, x.id) + deny };
    })
    .sort((a, b) => b.v - a.v);
  const deck: Action = { type: "draw", player: seat, from: "deck" };
  const takes = market.map((m) => ({ type: "draw", player: seat, from: "market", slot: m.slot }) as Action);
  // An unseen card is worth a little on average; a face-up one has to beat that.
  const deckValue = 12 + 4 * hand.length;
  return market.length && market[0].v > deckValue ? [...takes, deck] : [deck, ...takes];
}

function openingMoves(s: GameState, seat: Seat): Action[] {
  const p = s.players[seat];
  const live = COMPANY_IDS.filter((c) => isLive(s, c));
  const cost = (o: Partial<Holdings>) => (Object.entries(o) as [CompanyId, number][]).reduce((n, [c, q]) => n + q * startPrice(s.config, c), 0);
  // Candidate books: everything in one company (chairman), two halves, a 4–2, three pairs.
  const books: Partial<Holdings>[] = [{}];
  for (const a of live) {
    books.push({ [a]: OPENING_MAX_SHARES });
    for (const b of live) {
      if (a === b) continue;
      books.push({ [a]: 3, [b]: 3 }, { [a]: 4, [b]: 2 });
      for (const c of live) if (c !== a && c !== b && a < b && b < c) books.push({ [a]: 2, [b]: 2, [c]: 2 });
    }
  }
  let best: { v: number; orders: Partial<Holdings>; card: number } = { v: -Infinity, orders: {}, card: p.hand[0] };
  for (const orders of books) {
    if (cost(orders) > p.cash) continue;
    // Score as if filled at the starting prices, with the placed card landing right away.
    const t = structuredClone(s);
    t.players[seat].cash -= cost(orders);
    for (const [c, q] of Object.entries(orders) as [CompanyId, number][]) t.players[seat].shares[c] += q;
    for (const id of p.hand) {
      const steps: Steps = {};
      addSteps(steps, cardSteps(id, t), 1);
      for (const other of p.hand) if (other !== id) addSteps(steps, cardSteps(other, t), HAND_WEIGHT);
      const v = worth(t, seat, steps);
      if (v > best.v) best = { v, orders, card: id };
    }
  }
  return [{ type: "openingOrder", player: seat, orders: best.orders, card: best.card }];
}

function ipoMoves(s: GameState, seat: Seat): Action[] {
  const band = [...ipoBandOf(s.config)].sort((a, b) => a - b);
  const max = ipoMaxBidOf(s.config);
  const p = s.players[seat];
  let bias = 0;
  for (const id of p.hand) bias += card(id).effects[IPO_COMPANY] ?? 0;
  // The first-day pop usually makes the shares worth more than the band: bid for plenty,
  // higher when its cards favour Oracle, low (or not at all) when they are against it.
  const level = bias > 0 ? band.length - 1 : bias < 0 ? 0 : Math.floor((band.length - 1) / 2);
  const at = band[level];
  const want = bias < -2 ? 0 : bias < 0 ? Math.ceil(max / 3) : max;
  const reserve = 120;
  const q = Math.max(0, Math.min(want, Math.floor((p.cash - reserve) / at)));
  return [
    { type: "ipoBid", player: seat, qty: q, price: q ? at : 0 },
    { type: "ipoBid", player: seat, qty: 0, price: 0 },
  ];
}

function forcedSaleMoves(s: GameState, seat: Seat): Action[] {
  const p = s.players[seat];
  const steps = expected(s, seat, null, p.hand);
  // Sell what it expects least from first.
  return COMPANY_IDS.filter((c) => p.shares[c] > 0 && !s.companies[c].bankrupt)
    .sort((a, b) => priceAfter(s, a, steps[a] ?? 0) - price(s, a) - (priceAfter(s, b, steps[b] ?? 0) - price(s, b)))
    .map((c) => ({ type: "forcedSell", player: seat, company: c, qty: 1 }) as Action);
}

export const smartPlayer: Strategy = {
  name: "smart",
  candidates(s, seat) {
    if (s.debt) return forcedSaleMoves(s, seat);
    const ph = s.phase;
    if (ph.kind === "opening") return openingMoves(s, seat);
    if (ph.kind === "ipo") return ipoMoves(s, seat);
    if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return drawMoves(s, seat);
    if (ph.kind === "turn") return turnMoves(s, seat);
    return [];
  },
};
