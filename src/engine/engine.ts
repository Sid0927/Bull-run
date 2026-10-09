/**
 * The Bull Run rules engine. Pure and UI-free: `apply(state, action)` returns a new state
 * and the events it produced, or an error saying why the action is illegal. All randomness
 * comes from the seeded generator held in the state, so a game is reproducible from its
 * config and action log (see record.ts).
 */
import {
  ACTIONS_PER_TURN,
  CHAIRMAN_MULTIPLIER,
  CO_CHAIRMAN_MULTIPLIER,
  CHAIRMAN_SHARES,
  COMPANIES,
  COMPANY_IDS,
  DIVIDEND_ROUNDS,
  GAME_LENGTHS,
  IPO_BAND,
  IPO_CARDS,
  IPO_COMPANY,
  IPO_MAX_BID,
  IPO_MAX_BID_3P,
  IPO_ROUND,
  HAND_SIZE,
  MARKET_SIZE,
  MAX_QTY_PER_ACTION,
  NEWS_CARDS,
  OPENING_MAX_SHARES,
  RELIST_INDEX,
  SHARES_PER_COMPANY,
  SHORT_CAP_STEPS,
  SHORTS_PER_COMPANY,
  STARTING_CASH,
  THRESHOLDS,
  TOP,
  TRACK,
  card,
  dividendPerShare,
  indexOfPrice,
  type CompanyId,
} from "./data.ts";
import { Rng } from "./rng.ts";
import type {
  Action,
  GameConfig,
  GameEvent,
  GameState,
  Holdings,
  IpoBid,
  Result,
  Seat,
  ShortToken,
  Standing,
  TradeKind,
} from "./types.ts";

export class IllegalAction extends Error {}

interface Ctx {
  s: GameState;
  rng: Rng;
  events: GameEvent[];
}

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const zeroHoldings = (): Holdings => Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Holdings;
const cname = (c: CompanyId) => COMPANIES[c].short;

// ─── Queries ────────────────────────────────────────────────────────────────────────────

export function price(s: GameState, c: CompanyId): number {
  return TRACK[s.companies[c].priceIndex];
}

export function sharesHeld(s: GameState, c: CompanyId): number {
  return s.players.reduce((n, p) => n + p.shares[c], 0);
}

export function bankShares(s: GameState, c: CompanyId): number {
  return SHARES_PER_COMPANY - sharesHeld(s, c);
}

export function openShorts(s: GameState, c: CompanyId, owner?: Seat): ShortToken[] {
  return s.shorts.filter((t) => t.company === c && (owner === undefined || t.owner === owner));
}

/** Shares held by players minus open short tokens. */
export function outstanding(s: GameState, c: CompanyId): number {
  return sharesHeld(s, c) - openShorts(s, c).length;
}

/** Track index at which a short opened on `openIndex` is forced closed, or null if never. */
export function capIndex(openIndex: number): number | null {
  const i = openIndex + SHORT_CAP_STEPS;
  return i <= TOP ? i : null;
}

export function netWorth(s: GameState, seat: Seat): Omit<Standing, "rank"> {
  const p = s.players[seat];
  let sharesValue = 0;
  for (const c of COMPANY_IDS) sharesValue += p.shares[c] * price(s, c);
  const shortsCost = s.shorts.filter((t) => t.owner === seat).reduce((n, t) => n + price(s, t.company), 0);
  return { seat, name: p.name, cash: p.cash, sharesValue, shortsCost, netWorth: p.cash + sharesValue - shortsCost };
}

/** Listed and not bankrupt: the companies that can be traded and moved by news right now. */
export function isLive(s: GameState, c: CompanyId): boolean {
  return s.companies[c].listed && !s.companies[c].bankrupt;
}

export function ipoEnabled(config: GameConfig): boolean {
  return config.ipo !== false;
}

export function ipoBandOf(config: GameConfig): readonly number[] {
  return config.ipoBand ?? IPO_BAND;
}

export function ipoMaxBidOf(config: GameConfig): number {
  return config.ipoMaxBid ?? (config.players.length === 3 ? IPO_MAX_BID_3P : IPO_MAX_BID);
}

/** Whose input the game is waiting for, or null when it has ended. */
export function actor(s: GameState): Seat | null {
  if (s.debt) return s.debt.player;
  switch (s.phase.kind) {
    case "opening": {
      const i = s.phase.submissions.findIndex((x) => x === null);
      return i < 0 ? null : i;
    }
    case "openingDraw":
      return s.phase.next;
    case "ipo": {
      const i = s.phase.bids.findIndex((x) => x === null);
      return i < 0 ? null : i;
    }
    case "turn":
      return s.phase.player;
    case "ended":
      return null;
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────────────────

export function startPrice(config: GameConfig, c: CompanyId): number {
  return config.startPrices?.[c] ?? COMPANIES[c].startPrice;
}

export function newGame(config: GameConfig): { state: GameState; events: GameEvent[] } {
  if (config.players.length < 3 || config.players.length > 5) throw new IllegalAction("Bull Run is for 3–5 players.");
  if (!GAME_LENGTHS.includes(config.rounds)) throw new IllegalAction("The game length must be 6, 9 or 12 rounds.");
  if (config.startingCash !== undefined && !(Number.isInteger(config.startingCash) && config.startingCash > 0)) throw new IllegalAction("Starting cash must be a whole number above 0.");
  if (config.ipoBand !== undefined && (config.ipoBand.length === 0 || !config.ipoBand.every((p) => p > 0 && (TRACK as readonly number[]).includes(p))))
    throw new IllegalAction("The IPO band must be one or more spaces on the price track above ₹0.");
  if (!Number.isInteger(config.seed)) throw new IllegalAction("The seed must be a whole number.");
  if (new Set(config.players).size !== config.players.length) throw new IllegalAction("Give every player a different name.");
  if (config.dividendBands !== undefined) {
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
    if (config.dividendBands.length === 0 || !config.dividendBands.every((b) => ok(b.from) && ok(b.pays)))
      throw new IllegalAction("A dividend table needs at least one band, each a whole-rupee price and a whole-rupee amount of ₹0 or more.");
  }
  if (config.driftAtOrBelow !== undefined && !Number.isInteger(config.driftAtOrBelow)) throw new IllegalAction("The drift level must be a whole number.");
  if (config.driftMode !== undefined && config.driftMode !== "down" && config.driftMode !== "toStart") throw new IllegalAction('The drift mode must be "down" or "toStart".');
  if (config.chairmanMultiplier !== undefined && !(Number.isInteger(config.chairmanMultiplier) && config.chairmanMultiplier >= 0)) throw new IllegalAction("The chairman multiplier must be a whole number.");
  if (config.coChairmanMultiplier !== undefined && !(Number.isInteger(config.coChairmanMultiplier) && config.coChairmanMultiplier >= 0)) throw new IllegalAction("The co-chairman multiplier must be a whole number.");
  if (config.ipoMaxBid !== undefined && !(Number.isInteger(config.ipoMaxBid) && config.ipoMaxBid >= 0)) throw new IllegalAction("The IPO bid limit must be a whole number.");
  for (const [c, p] of Object.entries(config.startPrices ?? {})) {
    if (!COMPANY_IDS.includes(c as CompanyId)) throw new IllegalAction(`No company ${c}.`);
    if (!(TRACK as readonly number[]).includes(p!) || p === 0) throw new IllegalAction(`${c} cannot start at ₹${p}: not a space on the track.`);
  }
  const rng = new Rng(config.seed);
  const deck = rng.shuffle(NEWS_CARDS.map((c) => c.id));
  const players = config.players.map((name) => ({
    name,
    cash: config.startingCash ?? STARTING_CASH,
    shares: zeroHoldings(),
    hand: [] as number[],
    shortBanned: false,
  }));
  for (const p of players) for (let i = 0; i < HAND_SIZE; i++) p.hand.push(deck.pop()!);
  const market: (number | null)[] = [];
  for (let i = 0; i < MARKET_SIZE; i++) market.push(deck.pop()!);

  const state: GameState = {
    config: { ...config, players: [...config.players] },
    rng: rng.state,
    round: 0,
    phase: { kind: "opening", submissions: players.map(() => null) },
    players,
    companies: Object.fromEntries(
      COMPANY_IDS.map((c) => [c, { priceIndex: indexOfPrice(startPrice(config, c)), bankrupt: false, listed: !COMPANIES[c].ipo }]),
    ) as GameState["companies"],
    chairmen: Object.fromEntries(COMPANY_IDS.map((c) => [c, null])) as GameState["chairmen"],
    shorts: [],
    nextShortId: 1,
    deck,
    market,
    discard: [],
    startPlayer: null,
    debt: null,
    standings: null,
    pendingNews: players.map(() => null),
    tape: [],
    homeIndex: Object.fromEntries(COMPANY_IDS.map((c) => [c, indexOfPrice(startPrice(config, c))])) as Record<CompanyId, number>,
  };
  return {
    state,
    events: [{ kind: "setup", text: `New game: ${config.players.join(", ")} · ${config.rounds} rounds` }],
  };
}

// ─── Apply ──────────────────────────────────────────────────────────────────────────────

export function apply(state: GameState, action: Action): Result {
  const ctx: Ctx = { s: structuredClone(state), rng: new Rng(state.rng), events: [] };
  try {
    reduce(ctx, action);
  } catch (e) {
    if (e instanceof IllegalAction) return { ok: false, error: e.message };
    throw e;
  }
  ctx.s.rng = ctx.rng.state;
  return { ok: true, state: ctx.s, events: ctx.events };
}

function reduce(ctx: Ctx, a: Action) {
  const { s } = ctx;
  if (s.phase.kind === "ended") throw new IllegalAction("The game is over.");
  if (!Number.isInteger(a.player) || a.player < 0 || a.player >= s.players.length) throw new IllegalAction("No such player.");

  if (s.debt) {
    if (a.type !== "forcedSell") throw new IllegalAction(`${s.players[s.debt.player].name} must first sell shares to pay ${fmt(s.debt.amount)}.`);
    if (a.player !== s.debt.player) throw new IllegalAction(`It is ${s.players[s.debt.player].name} who must sell.`);
    return forcedSell(ctx, a.company, a.qty);
  }

  switch (a.type) {
    case "openingOrder":
      return openingOrder(ctx, a.player, a.orders, a.card);
    case "draw":
      return draw(ctx, a.player, a.from === "market" ? a.slot : null);
    case "trade":
      return trade(ctx, a.player, a.kind, a.company, a.qty, a.shortIds);
    case "playNews":
      return playNews(ctx, a.player, a.card);
    case "ipoBid":
      return ipoBid(ctx, a.player, a.qty, a.price);
    case "forcedSell":
      throw new IllegalAction("There is nothing to pay off.");
    default:
      throw new IllegalAction("Unknown action.");
  }
}

// ─── Price movement ─────────────────────────────────────────────────────────────────────

function movePrice(ctx: Ctx, c: CompanyId, steps: number, cause: "threshold" | "news" | "opening" | "drift", why: string) {
  const co = ctx.s.companies[c];
  if (co.bankrupt || !co.listed || steps === 0) return;
  const from = co.priceIndex;
  const to = Math.max(0, Math.min(TOP, from + steps));
  if (to === from) {
    ctx.events.push({ kind: "ceiling", company: c, text: `${cname(c)} ${signed(steps)} ignored: already at the ${fmt(TRACK[TOP])} ceiling (${why})` });
    return;
  }
  co.priceIndex = to;
  const capped = to - from !== steps && to === TOP ? " (stopped at the ceiling)" : "";
  ctx.events.push({
    kind: "price",
    company: c,
    from: TRACK[from],
    to: TRACK[to],
    steps: to - from,
    cause,
    text: `${cname(c)} ${signed(to - from)}${cause === "threshold" || cause === "drift" ? ": " : " from "}${why} — ${fmt(TRACK[from])} → ${fmt(TRACK[to])}${capped}`,
  });
  if (to === 0) bankrupt(ctx, c);
  else if (to > from) markCapped(ctx.s, c);
}

/** Flag every short on `c` whose cap the price has now reached. */
function markCapped(s: GameState, c: CompanyId) {
  for (const t of s.shorts) {
    const cap = capIndex(t.openIndex);
    if (t.company === c && cap !== null && s.companies[c].priceIndex >= cap) t.capped = true;
  }
}

function bankrupt(ctx: Ctx, c: CompanyId) {
  const { s } = ctx;
  s.companies[c] = { priceIndex: 0, bankrupt: true, listed: true };
  ctx.events.push({ kind: "bankrupt", company: c, text: `${cname(c)} is bankrupt: all its shares go back to the bank and are worthless` });
  for (const p of s.players) p.shares[c] = 0;
  for (const t of openShorts(s, c)) {
    ctx.events.push({
      kind: "shortClosed",
      player: t.owner,
      company: c,
      shortId: t.id,
      price: 0,
      how: "bankrupt",
      text: `${s.players[t.owner].name}'s short on ${cname(c)} closes with the bankruptcy; they keep what they received`,
    });
  }
  s.shorts = s.shorts.filter((t) => t.company !== c);
  syncChairmen(ctx);
}

function relist(ctx: Ctx, c: CompanyId) {
  ctx.s.companies[c] = { priceIndex: RELIST_INDEX, bankrupt: false, listed: true };
  ctx.events.push({ kind: "relist", company: c, text: `${cname(c)} re-lists at ${fmt(TRACK[RELIST_INDEX])} with all 12 shares in the bank` });
}

/** The two players who hold 6 each, when a company has two co-chairmen instead of a chairman. */
export function coChairmen(s: GameState, c: CompanyId): Seat[] {
  if (s.chairmen[c] !== null || s.companies[c].bankrupt) return [];
  const holders = s.players.map((p, i) => [i, p.shares[c]] as const).filter(([, n]) => n >= CHAIRMAN_SHARES);
  return holders.length === 2 ? holders.map(([i]) => i) : [];
}

export const coChairmanMultiplierOf = (c: GameConfig) => c.coChairmanMultiplier ?? CO_CHAIRMAN_MULTIPLIER;

function syncChairmen(ctx: Ctx) {
  const { s } = ctx;
  for (const c of COMPANY_IDS) {
    const holders = s.players.map((p, i) => [i, p.shares[c]] as const).filter(([, n]) => n >= CHAIRMAN_SHARES);
    const now = !s.companies[c].bankrupt && holders.length === 1 ? holders[0][0] : null;
    const was = s.chairmen[c];
    if (now === was) continue;
    s.chairmen[c] = now;
    const text =
      now === null
        ? holders.length > 1
          ? `${holders.map(([i]) => s.players[i].name).join(" and ")} hold 6 ${cname(c)} each: no single chairman${coChairmanMultiplierOf(s.config) ? `, they share it as co-chairmen` : ""}`
          : `${cname(c)} chairman token removed from ${s.players[was!].name}`
        : `${s.players[now].name} becomes ${cname(c)} chairman`;
    ctx.events.push({ kind: "chairman", company: c, from: was, to: now, text });
  }
}

// ─── Single-share steps (the threshold rule) ────────────────────────────────────────────
// Each moves the outstanding count by one. If that crosses 3, 6, 9 or 12 the price moves
// first and the share trades at the new price. Returns the price the share traded at, or
// null if the move bankrupted the company (the share is then worthless and nothing trades).

function stepUp(ctx: Ctx, c: CompanyId): number {
  const next = outstanding(ctx.s, c) + 1;
  if ((THRESHOLDS as readonly number[]).includes(next)) {
    movePrice(ctx, c, 1, "threshold", `${ordinal(next)} share outstanding crossed a threshold`);
  }
  return price(ctx.s, c);
}

function stepDown(ctx: Ctx, c: CompanyId): number | null {
  const now = outstanding(ctx.s, c);
  if ((THRESHOLDS as readonly number[]).includes(now)) {
    movePrice(ctx, c, -1, "threshold", `outstanding fell below ${now}`);
  }
  return ctx.s.companies[c].bankrupt ? null : price(ctx.s, c);
}

function buyOne(ctx: Ctx, seat: Seat, c: CompanyId): number {
  const paid = stepUp(ctx, c);
  ctx.s.players[seat].cash -= paid;
  ctx.s.players[seat].shares[c] += 1;
  return paid;
}

function sellOne(ctx: Ctx, seat: Seat, c: CompanyId): number | null {
  const got = stepDown(ctx, c);
  if (got === null) return null;
  ctx.s.players[seat].cash += got;
  ctx.s.players[seat].shares[c] -= 1;
  return got;
}

function shortOne(ctx: Ctx, seat: Seat, c: CompanyId): number | null {
  const got = stepDown(ctx, c);
  if (got === null) return null;
  const s = ctx.s;
  const token: ShortToken = { id: s.nextShortId++, owner: seat, company: c, openIndex: s.companies[c].priceIndex };
  s.shorts.push(token);
  s.players[seat].cash += got;
  ctx.events.push({
    kind: "shortOpened",
    player: seat,
    company: c,
    shortId: token.id,
    price: got,
    text: `${s.players[seat].name} opens a short on ${cname(c)} at ${fmt(got)}${capIndex(token.openIndex) === null ? " (no cap: 5 steps up is past the ceiling)" : `, forced to close at ${fmt(TRACK[capIndex(token.openIndex)!])}`}`,
  });
  return got;
}

/** Return a token to the supply. It counts +1, as a buy. */
function closeOne(ctx: Ctx, token: ShortToken): number {
  const paid = stepUp(ctx, token.company);
  ctx.s.shorts = ctx.s.shorts.filter((t) => t.id !== token.id);
  return paid;
}

// ─── Trading ────────────────────────────────────────────────────────────────────────────

export interface TradePreview {
  prices: number[];
  total: number; // paid (buy, cover) or received (sell, short)
  crossings: string[];
  bankrupts: boolean;
  /** Shorts the trade would force closed once it is done, at their cap prices. */
  forcedCloses: { player: Seat; company: CompanyId; price: number }[];
  /** What the trader would still owe after those closes, if anything (they would have to sell). */
  traderOwes: number;
}

/** Run a trade's share-by-share arithmetic on a copy, without checking cash. */
export function previewTrade(s: GameState, a: Extract<Action, { type: "trade" }>): { ok: true; preview: TradePreview } | { ok: false; error: string } {
  if (!Number.isInteger(a.player) || a.player < 0 || a.player >= s.players.length) return { ok: false, error: "No such player." };
  const ctx: Ctx = { s: structuredClone(s), rng: new Rng(s.rng), events: [] };
  try {
    checkTrade(ctx.s, a.player, a.kind, a.company, a.qty, a.shortIds, false);
    const prices = runTrade(ctx, a.player, a.kind, a.company, a.qty, a.shortIds);
    const crossings = ctx.events.filter((e) => e.kind === "price" || e.kind === "ceiling").map((e) => e.text);
    const bankrupts = ctx.events.some((e) => e.kind === "bankrupt");
    // Then what the real move does next: shorts that reached their cap are forced closed. Other
    // players' cash may be hidden from whoever is asking, so assume they can pay: the closes all
    // happen in the end, even if someone has to sell shares first.
    ctx.s.players.forEach((p, i) => {
      if (i !== a.player) p.cash = Number.MAX_SAFE_INTEGER / 8;
    });
    const before = ctx.events.length;
    settle(ctx);
    const forcedCloses = ctx.events
      .slice(before)
      .flatMap((e) => (e.kind === "shortClosed" && e.how === "forced" ? [{ player: e.player, company: e.company, price: e.price }] : []));
    const debt = ctx.s.debt;
    return {
      ok: true,
      preview: {
        prices,
        total: prices.reduce((x, y) => x + y, 0),
        crossings,
        bankrupts,
        forcedCloses,
        traderOwes: debt && debt.player === a.player ? debt.amount - ctx.s.players[a.player].cash : 0,
      },
    };
  } catch (e) {
    if (e instanceof IllegalAction) return { ok: false, error: e.message };
    throw e;
  }
}

/** Most shares in one trade under this game's rules. */
export const maxQtyOf = (c: GameConfig) => c.maxQtyPerAction ?? MAX_QTY_PER_ACTION;
/** What `actionsUsed` counts up to: actions, or shares when actions may be split across companies. */
export const turnBudget = (c: GameConfig) => (c.actionsPerTurn ?? ACTIONS_PER_TURN) * (c.splitActions ? maxQtyOf(c) : 1);
/** How many more shares the player to move may trade in one go this turn (0 when trading is over). */
export function tradeRoom(s: GameState): number {
  if (s.phase.kind !== "turn" || s.phase.step !== "trade" || s.phase.actionsUsed >= turnBudget(s.config)) return 0;
  return s.config.splitActions ? Math.min(maxQtyOf(s.config), turnBudget(s.config) - s.phase.actionsUsed) : maxQtyOf(s.config);
}

function checkTrade(s: GameState, seat: Seat, kind: TradeKind, c: CompanyId, qty: number, shortIds: number[] | undefined, inTurn = true) {
  if (s.phase.kind !== "turn") throw new IllegalAction("Trading happens on player turns, from round 1.");
  if (inTurn) {
    if (s.phase.player !== seat) throw new IllegalAction("It is not your turn.");
    if (s.phase.step !== "trade") throw new IllegalAction("You have already played your news card; trading is over for this turn.");
    if (s.phase.actionsUsed >= turnBudget(s.config)) throw new IllegalAction("You have used both trade actions this turn.");
  }
  if (!COMPANY_IDS.includes(c)) throw new IllegalAction("No such company.");
  if (!Number.isInteger(qty) || qty < 1 || qty > maxQtyOf(s.config)) throw new IllegalAction(`An action is 1 to ${maxQtyOf(s.config)} shares or short tokens.`);
  if (inTurn && s.config.splitActions && s.phase.actionsUsed + qty > turnBudget(s.config))
    throw new IllegalAction(`Only ${turnBudget(s.config) - s.phase.actionsUsed} more shares can be traded this turn.`);
  if (!s.companies[c].listed) throw new IllegalAction(`${cname(c)} is not listed yet: it lists through the IPO at the start of round ${IPO_ROUND}.`);
  if (s.companies[c].bankrupt) throw new IllegalAction(`${cname(c)} is bankrupt and cannot be traded until it re-lists.`);
  const p = s.players[seat];
  switch (kind) {
    case "buy":
      if (bankShares(s, c) < qty) throw new IllegalAction(`The bank has only ${bankShares(s, c)} ${cname(c)} shares left.`);
      break;
    case "sell":
      if (p.shares[c] < qty) throw new IllegalAction(`You hold only ${p.shares[c]} ${cname(c)} shares.`);
      break;
    case "short":
      if (p.shortBanned) throw new IllegalAction("You may not open shorts for the rest of the game (last-resort rule).");
      if (COMPANIES[c].ipo && s.round <= IPO_ROUND) throw new IllegalAction(`${cname(c)} cannot be shorted in its listing round; shorts open from round ${IPO_ROUND + 1}.`);
      if (SHORTS_PER_COMPANY - openShorts(s, c).length < qty)
        throw new IllegalAction(`Only ${SHORTS_PER_COMPANY - openShorts(s, c).length} ${cname(c)} short tokens are left.`);
      break;
    case "cover": {
      const mine = openShorts(s, c, seat);
      if (mine.length < qty) throw new IllegalAction(`You have only ${mine.length} open ${cname(c)} shorts.`);
      if (shortIds) {
        if (shortIds.length !== qty || new Set(shortIds).size !== qty || !shortIds.every((id) => mine.some((t) => t.id === id)))
          throw new IllegalAction("Pick that many of your own short tokens on this company.");
      }
      break;
    }
    default:
      throw new IllegalAction("Unknown trade.");
  }
}

function tokensToCover(s: GameState, seat: Seat, c: CompanyId, qty: number, shortIds?: number[]): ShortToken[] {
  const mine = openShorts(s, c, seat);
  if (shortIds) return shortIds.map((id) => mine.find((t) => t.id === id)!);
  // Default: the tokens nearest their cap first.
  return mine.sort((a, b) => a.openIndex - b.openIndex || a.id - b.id).slice(0, qty);
}

function runTrade(ctx: Ctx, seat: Seat, kind: TradeKind, c: CompanyId, qty: number, shortIds?: number[]): number[] {
  const prices: number[] = [];
  const covers = kind === "cover" ? tokensToCover(ctx.s, seat, c, qty, shortIds) : [];
  for (let i = 0; i < qty; i++) {
    if (kind === "buy") prices.push(buyOne(ctx, seat, c));
    else if (kind === "cover") {
      const paid = closeOne(ctx, covers[i]);
      ctx.s.players[seat].cash -= paid;
      prices.push(paid);
    } else {
      const got = kind === "sell" ? sellOne(ctx, seat, c) : shortOne(ctx, seat, c);
      if (got === null) break; // the company went bankrupt mid-action
      prices.push(got);
    }
  }
  return prices;
}

function trade(ctx: Ctx, seat: Seat, kind: TradeKind, c: CompanyId, qty: number, shortIds?: number[]) {
  const s = ctx.s;
  checkTrade(s, seat, kind, c, qty, shortIds);
  if (kind === "buy" || kind === "cover") {
    const pv = previewTrade(s, { type: "trade", player: seat, kind, company: c, qty, shortIds });
    if (pv.ok && pv.preview.total > s.players[seat].cash)
      throw new IllegalAction(`That costs ${fmt(pv.preview.total)} and you have ${fmt(s.players[seat].cash)}.`);
  }
  const prices = runTrade(ctx, seat, kind, c, qty, shortIds);
  const total = prices.reduce((x, y) => x + y, 0);
  const verb = { buy: "buys", sell: "sells", short: "shorts", cover: "covers" }[kind];
  // A sale or short that bankrupts the company stops part-way: report what actually traded.
  const done = prices.length;
  const noun = kind === "short" || kind === "cover" ? `short${done === 1 ? "" : "s"}` : `share${done === 1 ? "" : "s"}`;
  ctx.events.push({
    kind: "trade",
    player: seat,
    trade: kind,
    company: c,
    prices,
    total,
    text:
      done === 0
        ? `${s.players[seat].name} tries to ${kind} ${cname(c)}, but the first share takes it to ₹0: nothing trades`
        : `${s.players[seat].name} ${verb} ${done} ${cname(c)} ${noun} at ${prices.map(fmt).join(", ")} — ${kind === "buy" || kind === "cover" ? "pays" : "receives"} ${fmt(total)}`,
  });
  if (s.phase.kind === "turn") s.phase.actionsUsed += s.config.splitActions ? Math.max(1, done) : 1;
  if (done > 0) s.tape = [...s.tape, { seat, round: s.round, kind, company: c, qty: done }].slice(-12);
  syncChairmen(ctx);
  settle(ctx);
}

// ─── Forced closes and the can't-pay rule ───────────────────────────────────────────────

/** Resolve every short that has reached its cap, including chain reactions. */
function settle(ctx: Ctx) {
  const s = ctx.s;
  while (!s.debt) {
    const n = s.players.length;
    const from = s.phase.kind === "turn" ? s.phase.player : 0;
    // A token is due once a move reached its cap, whatever the price has done since.
    const due = s.shorts
      .filter((t) => t.capped && !s.companies[t.company].bankrupt)
      // Agreed order: clockwise from the player whose turn it is, then oldest token first.
      .sort((a, b) => (a.owner - from + n) % n - (b.owner - from + n) % n || a.id - b.id);
    const t = due[0];
    if (!t) return;
    const cost = TRACK[capIndex(t.openIndex)!];
    ctx.events.push({
      kind: "shortClosed",
      player: t.owner,
      company: t.company,
      shortId: t.id,
      price: cost,
      how: "forced",
      text: `${s.players[t.owner].name}'s ${cname(t.company)} short (opened at ${fmt(TRACK[t.openIndex])}) hits its 5-step cap and is forced closed at ${fmt(cost)}`,
    });
    closeOne(ctx, t); // counts as a buy: may cross a threshold and trigger more caps
    syncChairmen(ctx);
    charge(ctx, t.owner, cost, `forced close of a ${cname(t.company)} short`);
  }
}

function sellableShares(s: GameState, seat: Seat): number {
  return COMPANY_IDS.reduce((n, c) => n + (isLive(s, c) ? s.players[seat].shares[c] : 0), 0);
}

function charge(ctx: Ctx, seat: Seat, amount: number, reason: string) {
  const p = ctx.s.players[seat];
  if (p.cash >= amount) {
    p.cash -= amount;
    return;
  }
  ctx.events.push({ kind: "debt", player: seat, amount, text: `${p.name} must pay ${fmt(amount)} for a ${reason} but has ${fmt(p.cash)} and must show their cash` });
  ctx.s.debt = { player: seat, amount, reason };
  resolveDebt(ctx);
}

function resolveDebt(ctx: Ctx) {
  const s = ctx.s;
  const d = s.debt!;
  const p = s.players[d.player];
  if (p.cash >= d.amount) {
    p.cash -= d.amount;
    s.debt = null;
  } else if (sellableShares(s, d.player) === 0) {
    ctx.events.push({
      kind: "lastResort",
      player: d.player,
      owed: d.amount,
      paid: p.cash,
      text: `${p.name} cannot pay ${fmt(d.amount)}: pays everything (${fmt(p.cash)}), the bank absorbs ${fmt(d.amount - p.cash)}, and they may not open shorts for the rest of the game`,
    });
    p.cash = 0;
    p.shortBanned = true;
    s.debt = null;
  }
}

function forcedSell(ctx: Ctx, c: CompanyId, qty: number) {
  const s = ctx.s;
  const seat = s.debt!.player;
  if (!COMPANY_IDS.includes(c)) throw new IllegalAction("No such company.");
  if (s.companies[c].bankrupt) throw new IllegalAction(`${cname(c)} is bankrupt; its shares are worthless.`);
  if (!Number.isInteger(qty) || qty < 1 || qty > s.players[seat].shares[c]) throw new IllegalAction(`You hold ${s.players[seat].shares[c]} ${cname(c)} shares.`);
  const prices: number[] = [];
  for (let i = 0; i < qty; i++) {
    const got = sellOne(ctx, seat, c);
    if (got === null) break;
    prices.push(got);
  }
  const total = prices.reduce((x, y) => x + y, 0);
  ctx.events.push({
    kind: "trade",
    player: seat,
    trade: "forcedSell",
    company: c,
    prices,
    total,
    text: prices.length
      ? `${s.players[seat].name} sells ${prices.length} ${cname(c)} to raise cash at ${prices.map(fmt).join(", ")} — receives ${fmt(total)}`
      : `${s.players[seat].name} tries to sell ${cname(c)} to raise cash, but the first share takes it to ₹0: nothing is sold`,
  });
  syncChairmen(ctx);
  resolveDebt(ctx);
  settle(ctx);
}

// ─── News ───────────────────────────────────────────────────────────────────────────────

function playNews(ctx: Ctx, seat: Seat, id: number) {
  const s = ctx.s;
  if (s.phase.kind !== "turn" || s.phase.player !== seat) throw new IllegalAction("It is not your turn.");
  if (s.phase.step !== "trade") throw new IllegalAction("You have already played a news card this turn.");
  const p = s.players[seat];
  if (!p.hand.includes(id)) throw new IllegalAction("That card is not in your hand.");
  p.hand = p.hand.filter((x) => x !== id);
  s.phase.step = "draw";
  if (s.config.delayedNews !== false) {
    s.pendingNews[seat] = id;
    ctx.events.push({ kind: "newsPending", player: seat, text: `${p.name} places a news card face-down; it takes effect at the start of their next turn` });
    return;
  }
  resolveNews(ctx, seat, id, "plays");
}

function resolveNews(ctx: Ctx, seat: Seat, id: number, verb: "plays" | "reveals") {
  const s = ctx.s;
  s.discard.push(id);
  const nc = card(id);
  ctx.events.push({ kind: "news", player: seat, card: id, text: `${s.players[seat].name} ${verb} “${nc.title}” (#${id})` });
  for (const c of COMPANY_IDS) {
    const steps = nc.effects[c] ?? 0;
    if (!steps || !s.companies[c].listed) continue;
    if (s.companies[c].bankrupt) {
      ctx.events.push({ kind: "ceiling", company: c, text: `${cname(c)} ${signed(steps)} ignored: bankrupt until it re-lists` });
      continue;
    }
    movePrice(ctx, c, steps, "news", nc.title);
  }
  settle(ctx);
}

/** Start a player's turn; in the delayed-news variant their face-down card takes effect first. */
function beginTurn(ctx: Ctx, player: Seat, turnInRound: number) {
  const s = ctx.s;
  s.phase = { kind: "turn", player, turnInRound, actionsUsed: 0, step: "trade" };
  const pending = s.pendingNews[player];
  if (pending !== null && pending !== undefined) {
    s.pendingNews[player] = null;
    resolveNews(ctx, player, pending, "reveals");
  }
}

// ─── Drawing ────────────────────────────────────────────────────────────────────────────

function takeFromDeck(ctx: Ctx): number | null {
  const s = ctx.s;
  if (s.deck.length === 0 && s.discard.length > 0) {
    s.deck = ctx.rng.shuffle(s.discard);
    s.discard = [];
    ctx.events.push({ kind: "reshuffle", cards: s.deck.length, text: `The deck ran out: ${s.deck.length} played cards are shuffled into a new deck` });
  }
  return s.deck.pop() ?? null;
}

function draw(ctx: Ctx, seat: Seat, slot: number | null) {
  const s = ctx.s;
  const ph = s.phase;
  if (ph.kind === "openingDraw") {
    if (ph.next !== seat) throw new IllegalAction("Players draw back up in seat order.");
  } else if (ph.kind === "turn") {
    if (ph.player !== seat) throw new IllegalAction("It is not your turn.");
    if (ph.step !== "draw") throw new IllegalAction("Play a news card before you draw.");
  } else throw new IllegalAction("You cannot draw now.");
  const p = s.players[seat];
  if (p.hand.length >= HAND_SIZE) throw new IllegalAction("Your hand is full.");

  let got: number | null;
  if (slot === null) {
    got = takeFromDeck(ctx);
    if (got === null) throw new IllegalAction("The deck and the played pile are both empty; take a market card.");
  } else {
    if (!Number.isInteger(slot) || slot < 0 || slot >= MARKET_SIZE || s.market[slot] === null) throw new IllegalAction("There is no card in that market slot.");
    got = s.market[slot]!;
    s.market[slot] = takeFromDeck(ctx);
  }
  p.hand.push(got);
  ctx.events.push({
    kind: "draw",
    player: seat,
    from: slot === null ? "deck" : "market",
    card: got,
    text: slot === null ? `${p.name} draws blind from the deck` : `${p.name} takes “${card(got).title}” from the market`,
  });

  if (ph.kind === "openingDraw") {
    if (seat + 1 < s.players.length) ph.next = seat + 1;
    else {
      const start = ctx.rng.int(s.players.length);
      s.startPlayer = start;
      ctx.events.push({ kind: "startPlayer", player: start, text: `${s.players[start].name} is drawn to start round 1; play goes clockwise from them` });
      beginRound(ctx, 1);
    }
  } else nextTurn(ctx);
}

// ─── Round 0: the opening ───────────────────────────────────────────────────────────────

function openingOrder(ctx: Ctx, seat: Seat, orders: Partial<Holdings>, cardId: number) {
  const s = ctx.s;
  if (s.phase.kind !== "opening") throw new IllegalAction("Opening orders are only written in round 0.");
  const ph = s.phase;
  if (ph.submissions[seat]) throw new IllegalAction("You have already written your opening orders.");
  let total = 0;
  const clean: Partial<Holdings> = {};
  for (const [k, v] of Object.entries(orders ?? {})) {
    if (!COMPANY_IDS.includes(k as CompanyId)) throw new IllegalAction(`No company ${k}.`);
    if (v && !s.companies[k as CompanyId].listed) throw new IllegalAction(`${cname(k as CompanyId)} is not listed until round ${IPO_ROUND}.`);
    if (!Number.isInteger(v) || v! < 0) throw new IllegalAction("Orders are whole numbers of shares.");
    if (v) clean[k as CompanyId] = v;
    total += v!;
  }
  if (total > OPENING_MAX_SHARES) throw new IllegalAction("Opening orders are for up to 6 shares in total.");
  const cost = Object.entries(clean).reduce((n, [c, q]) => n + q! * price(s, c as CompanyId), 0);
  if (cost > s.players[seat].cash) throw new IllegalAction(`Those orders could cost ${fmt(cost)} and you have ${fmt(s.players[seat].cash)}.`);
  const p = s.players[seat];
  if (!p.hand.includes(cardId)) throw new IllegalAction("Place a news card from your own hand.");
  p.hand = p.hand.filter((x) => x !== cardId);
  ph.submissions[seat] = { orders: clean, card: cardId };
  if (ph.submissions.every((x) => x !== null)) resolveOpening(ctx);
}

/** Share out `supply` one at a time in seat order among the players still wanting one. */
export function allocate(requested: number[], supply: number): number[] {
  const got = requested.map(() => 0);
  if (requested.reduce((a, b) => a + b, 0) <= supply) return [...requested];
  while (supply > 0) {
    let gave = false;
    for (let i = 0; i < requested.length && supply > 0; i++) {
      if (got[i] < requested[i]) {
        got[i]++;
        supply--;
        gave = true;
      }
    }
    if (!gave) break;
  }
  return got;
}

function resolveOpening(ctx: Ctx) {
  const s = ctx.s;
  const subs = (s.phase as Extract<GameState["phase"], { kind: "opening" }>).submissions.map((x) => x!);
  for (const c of COMPANY_IDS) {
    const requested = subs.map((x) => x.orders[c] ?? 0);
    if (requested.every((n) => n === 0)) continue;
    const allocated = allocate(requested, SHARES_PER_COMPANY);
    const start = price(s, c);
    allocated.forEach((n, i) => {
      s.players[i].shares[c] += n;
      s.players[i].cash -= n * start;
    });
    const short = requested.some((n, i) => allocated[i] < n);
    ctx.events.push({
      kind: "openingAllocation",
      company: c,
      requested,
      allocated,
      text: `${cname(c)}: ${allocated.map((n, i) => (n ? `${s.players[i].name} ${n}` : null)).filter(Boolean).join(", ")} at ${fmt(start)}${short ? ` (oversubscribed: ${requested.reduce((a, b) => a + b, 0)} wanted, shared out in seat order)` : ""}`,
    });
  }
  for (const c of COMPANY_IDS) {
    const count = outstanding(s, c);
    const reached = THRESHOLDS.filter((t) => count >= t).length;
    if (reached) movePrice(ctx, c, reached, "opening", `${count} shares outstanding after the opening (${reached} threshold${reached > 1 ? "s" : ""})`);
  }
  syncChairmen(ctx);
  const totals: Partial<Record<CompanyId, number>> = {};
  const why: Partial<Record<CompanyId, string[]>> = {};
  subs.forEach((x, i) => {
    const nc = card(x.card);
    s.discard.push(x.card);
    ctx.events.push({ kind: "news", player: i, card: x.card, text: `${s.players[i].name} reveals “${nc.title}” (#${x.card})` });
    for (const [c, v] of Object.entries(nc.effects) as [CompanyId, number][]) {
      totals[c] = (totals[c] ?? 0) + v;
      (why[c] ??= []).push(`${nc.title} ${signed(v)}`);
    }
  });
  for (const c of COMPANY_IDS) {
    if (totals[c]) movePrice(ctx, c, totals[c]!, "news", `the opening news (${why[c]!.join(", ")})`);
  }
  s.phase = { kind: "openingDraw", next: 0 };
}

// ─── Rounds, dividends and the end ──────────────────────────────────────────────────────

function beginRound(ctx: Ctx, r: number) {
  const s = ctx.s;
  s.round = r;
  ctx.events.push({ kind: "roundStart", round: r, text: `Round ${r} of ${s.config.rounds}` });
  for (const c of COMPANY_IDS) if (s.companies[c].bankrupt) relist(ctx, c);
  if (r === IPO_ROUND && ipoEnabled(s.config) && !s.companies[IPO_COMPANY].listed) {
    s.phase = { kind: "ipo", bids: s.players.map(() => null) };
    ctx.events.push({
      kind: "ipoOpen",
      company: IPO_COMPANY,
      text: `${cname(IPO_COMPANY)} IPO: bids open. Up to ${ipoMaxBidOf(s.config)} shares each at ${ipoBandOf(s.config).map(fmt).join(", ")}`,
    });
    return;
  }
  startTurns(ctx);
}

function startTurns(ctx: Ctx) {
  beginTurn(ctx, ctx.s.startPlayer!, 0);
}

// ─── The IPO ────────────────────────────────────────────────────────────────────────────

/**
 * The book: the listing price is the highest band price at which the shares bid at that price
 * or higher reach 12 (the lowest band if they never do). Bids above it are filled in full; bids
 * at it share what is left one at a time, clockwise from `from`; bids below get nothing.
 */
export function ipoBook(bids: IpoBid[], from: Seat, priceBand: readonly number[] = IPO_BAND): { listingPrice: number; allocated: number[] } {
  const band = [...priceBand].sort((a, b) => b - a);
  let listingPrice = band[band.length - 1];
  for (const p of band) {
    if (bids.reduce((n, b) => n + (b.qty > 0 && b.price >= p ? b.qty : 0), 0) >= SHARES_PER_COMPANY) {
      listingPrice = p;
      break;
    }
  }
  const allocated = bids.map((b) => (b.qty > 0 && b.price > listingPrice ? b.qty : 0));
  let left = SHARES_PER_COMPANY - allocated.reduce((a, b) => a + b, 0);
  const n = bids.length;
  const want = bids.map((b) => (b.qty > 0 && b.price === listingPrice ? b.qty : 0));
  while (left > 0 && want.some((w, i) => allocated[i] < w)) {
    for (let k = 0; k < n && left > 0; k++) {
      const i = (from + k) % n;
      if (allocated[i] < want[i]) {
        allocated[i]++;
        left--;
      }
    }
  }
  return { listingPrice, allocated };
}

function ipoBid(ctx: Ctx, seat: Seat, qty: number, bidPrice: number) {
  const s = ctx.s;
  if (s.phase.kind !== "ipo") throw new IllegalAction("There is no IPO open.");
  if (s.phase.bids[seat]) throw new IllegalAction("You have already placed your IPO bid.");
  const max = ipoMaxBidOf(s.config), band = ipoBandOf(s.config);
  if (!Number.isInteger(qty) || qty < 0 || qty > max) throw new IllegalAction(`Bid for 0 to ${max} shares.`);
  if (qty > 0 && !band.includes(bidPrice)) throw new IllegalAction(`Bid at ${band.map(fmt).join(", ")}.`);
  if (qty * bidPrice > s.players[seat].cash) throw new IllegalAction(`That bid could cost ${fmt(qty * bidPrice)} and you have ${fmt(s.players[seat].cash)}.`);
  s.phase.bids[seat] = { qty, price: qty > 0 ? bidPrice : 0 };
  if (s.phase.bids.every((b) => b !== null)) resolveIpo(ctx);
}

function resolveIpo(ctx: Ctx) {
  const s = ctx.s;
  const c = IPO_COMPANY;
  const bids = (s.phase as Extract<GameState["phase"], { kind: "ipo" }>).bids.map((b) => b!);
  const { listingPrice, allocated } = ipoBook(bids, s.startPlayer ?? 0, ipoBandOf(s.config));
  allocated.forEach((n, i) => {
    s.players[i].shares[c] += n;
    s.players[i].cash -= n * listingPrice;
  });
  s.companies[c] = { priceIndex: indexOfPrice(listingPrice), bankrupt: false, listed: true };
  s.homeIndex[c] = indexOfPrice(listingPrice);
  const total = allocated.reduce((a, b) => a + b, 0);
  const reached = THRESHOLDS.filter((t) => total >= t).length;
  const afterPop = TRACK[Math.min(TOP, indexOfPrice(listingPrice) + reached)];
  const bidText = bids.map((b, i) => `${s.players[i].name} ${b.qty ? `${b.qty} @ ${fmt(b.price)}` : "no bid"}`).join(", ");
  const gotText = allocated.map((n, i) => (n ? `${s.players[i].name} ${n}` : null)).filter(Boolean).join(", ") || "nobody";
  ctx.events.push({
    kind: "ipoListing",
    company: c,
    bids,
    allocated,
    listingPrice,
    afterPop,
    text: `${cname(c)} IPO. Bids: ${bidText}. Lists at ${fmt(listingPrice)}; allotted ${gotText}${total < SHARES_PER_COMPANY ? ` (${SHARES_PER_COMPANY - total} stay in the bank)` : ""}`,
  });
  if (reached) movePrice(ctx, c, reached, "opening", `first-day pop: ${total} shares outstanding (${reached} threshold${reached > 1 ? "s" : ""})`);
  s.deck = ctx.rng.shuffle([...s.deck, ...IPO_CARDS.map((k) => k.id)]);
  ctx.events.push({ kind: "reshuffle", cards: s.deck.length, text: `${IPO_CARDS.length} ${cname(c)} news cards are shuffled into the deck` });
  syncChairmen(ctx);
  startTurns(ctx);
}

function nextTurn(ctx: Ctx) {
  const s = ctx.s;
  const ph = s.phase as Extract<GameState["phase"], { kind: "turn" }>;
  const n = s.players.length;
  if (ph.turnInRound + 1 < n) {
    beginTurn(ctx, (ph.player + 1) % n, ph.turnInRound + 1);
    return;
  }
  endRound(ctx);
}

function endRound(ctx: Ctx) {
  const s = ctx.s;
  if ((DIVIDEND_ROUNDS as readonly number[]).includes(s.round)) payDividends(ctx);
  if (s.config.driftAtOrBelow !== undefined) {
    for (const c of COMPANY_IDS) {
      const n = outstanding(s, c);
      if (!isLive(s, c) || n > s.config.driftAtOrBelow) continue;
      const toStart = s.config.driftMode === "toStart";
      const home = s.homeIndex[c];
      const step = toStart && s.companies[c].priceIndex <= home ? 0 : -1;
      if (step) movePrice(ctx, c, step, "drift", `no buyers: ${n} outstanding at the end of the round`);
    }
  }
  ctx.events.push({
    kind: "roundEnd",
    round: s.round,
    cash: s.players.map((p) => p.cash),
    prices: Object.fromEntries(COMPANY_IDS.map((c) => [c, price(s, c)])) as Record<CompanyId, number>,
    chairmen: { ...s.chairmen },
    text: `End of round ${s.round}`,
  });
  if (s.round >= s.config.rounds) endGame(ctx);
  else beginRound(ctx, s.round + 1);
}

function payDividends(ctx: Ctx) {
  const s = ctx.s;
  // Everything paid out first, for every company, then the short sellers pay: a short seller's
  // ability to pay must not depend on the order the companies are listed in.
  const ledger: { c: CompanyId; d: number; paid: { player: Seat; amount: number; why: "shares" | "chairman" | "short" }[] }[] = [];
  for (const c of COMPANY_IDS) {
    if (!isLive(s, c)) continue;
    const d = dividendPerShare(c, price(s, c), s.config.dividendBands, s.config.ipoPaysDividend === true && c === IPO_COMPANY);
    if (d === 0) continue;
    const paid: { player: Seat; amount: number; why: "shares" | "chairman" | "short" }[] = [];
    s.players.forEach((p, i) => {
      if (p.shares[c]) {
        p.cash += d * p.shares[c];
        paid.push({ player: i, amount: d * p.shares[c], why: "shares" });
      }
    });
    const ch = s.chairmen[c];
    if (ch !== null) {
      s.players[ch].cash += (s.config.chairmanMultiplier ?? CHAIRMAN_MULTIPLIER) * d;
      paid.push({ player: ch, amount: (s.config.chairmanMultiplier ?? CHAIRMAN_MULTIPLIER) * d, why: "chairman" });
    }
    // Two players with 6 each: no chairman, but each gets the co-chairman bonus.
    const co = coChairmanMultiplierOf(s.config);
    if (co > 0)
      for (const seat of coChairmen(s, c)) {
        s.players[seat].cash += co * d;
        paid.push({ player: seat, amount: co * d, why: "chairman" });
      }
    ledger.push({ c, d, paid });
  }
  for (const { c, d, paid } of ledger) {
    for (const t of openShorts(s, c)) {
      const p = s.players[t.owner];
      const pay = Math.min(p.cash, d);
      p.cash -= pay;
      paid.push({ player: t.owner, amount: -pay, why: "short" });
      if (pay < d) {
        ctx.events.push({
          kind: "shortfall",
          player: t.owner,
          owed: d,
          paid: pay,
          text: `${p.name} owes ${fmt(d)} on a ${cname(c)} short but has ${fmt(pay)}; the bank absorbs the rest`,
        });
      }
    }
  }
  for (const { c, d, paid } of ledger) {
    const parts = paid.map((x) =>
      x.why === "short" ? `${s.players[x.player].name} pays ${fmt(-x.amount)} (short)` : `${s.players[x.player].name} ${fmt(x.amount)}${x.why === "chairman" ? " (chairman)" : ""}`,
    );
    if (paid.length) ctx.events.push({ kind: "dividend", company: c, perShare: d, paid, text: `${cname(c)} dividend ${fmt(d)} a share at ${fmt(price(s, c))}: ${parts.join(", ")}` });
  }
}

export function standings(s: GameState): Standing[] {
  const rows = s.players.map((_, i) => netWorth(s, i));
  const order = [...rows].sort((a, b) => b.netWorth - a.netWorth || b.cash - a.cash);
  return order.map((r) => ({
    ...r,
    rank: 1 + order.filter((o) => o.netWorth > r.netWorth || (o.netWorth === r.netWorth && o.cash > r.cash)).length,
  }));
}

function endGame(ctx: Ctx) {
  const s = ctx.s;
  s.pendingNews.forEach((id, seat) => {
    if (id === null) return;
    s.discard.push(id);
    s.pendingNews[seat] = null;
    ctx.events.push({ kind: "newsPending", player: seat, text: `${s.players[seat].name}'s face-down card is discarded unplayed: the game is over` });
  });
  s.standings = standings(s);
  s.phase = { kind: "ended" };
  const winners = s.standings.filter((x) => x.rank === 1);
  ctx.events.push({
    kind: "gameEnd",
    standings: s.standings,
    text: `Game over. ${winners.length > 1 ? `Shared win: ${winners.map((w) => w.name).join(" and ")}` : `${winners[0].name} wins`} with ${fmt(winners[0].netWorth)}`,
  });
}
