import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ALL_CARDS,
  IPO_CARDS,
  ipoBook,
  COMPANY_IDS,
  STARTING_CASH,
  NEWS_CARDS,
  RELIST_INDEX,
  TRACK,
  actor,
  allocate,
  apply,
  card,
  indexOfPrice,
  invariantErrors,
  newGame,
  outstanding,
  previewTrade,
  price,
  replay,
  standings,
  type Action,
  type CompanyId,
  type GameEvent,
  type GameState,
} from "./index.ts";
import { playGame } from "../sim/run.ts";
import { STRATEGIES } from "../sim/strategies.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────────────────

/** A 3-player game moved straight to round 1, seat 0 to act, nobody holding anything. */
function midGame(opts: { round?: number; rounds?: 6 | 9 | 12; players?: number } = {}): GameState {
  const { state } = newGame({ players: ["Asha", "Bilal", "Chitra", "Dev", "Esha"].slice(0, opts.players ?? 3), rounds: opts.rounds ?? 9, seed: 7 });
  state.round = opts.round ?? 1;
  state.startPlayer = 0;
  state.phase = { kind: "turn", player: 0, turnInRound: 0, actionsUsed: 0, step: "trade" };
  // Return the hands to the deck so tests can hand out exactly the cards they need.
  for (const p of state.players) {
    state.deck.push(...p.hand);
    p.hand = [];
  }
  return state;
}

function setPrice(s: GameState, c: CompanyId, p: number) {
  s.companies[c].priceIndex = indexOfPrice(p);
}

function give(s: GameState, seat: number, ...cards: number[]) {
  for (const id of cards) {
    s.deck = s.deck.filter((x) => x !== id);
    s.market = s.market.map((x) => (x === id ? s.deck.pop()! : x));
    s.players[seat].hand.push(id);
  }
}

function addShort(s: GameState, owner: number, c: CompanyId, openPrice: number) {
  s.shorts.push({ id: s.nextShortId++, owner, company: c, openIndex: indexOfPrice(openPrice) });
}

function ok(s: GameState, a: Action): { state: GameState; events: GameEvent[] } {
  const r = apply(s, a);
  if (!r.ok) assert.fail(`expected legal, got: ${r.error}`);
  assert.deepEqual(invariantErrors(r.state), []);
  return r;
}

function illegal(s: GameState, a: Action, match?: RegExp) {
  const r = apply(s, a);
  assert.equal(r.ok, false, "expected the action to be refused");
  if (match && !r.ok) assert.match(r.error, match);
}

const buy = (player: number, company: CompanyId, qty: number): Extract<Action, { type: "trade" }> => ({ type: "trade", player, kind: "buy", company, qty });
const sell = (player: number, company: CompanyId, qty: number): Action => ({ type: "trade", player, kind: "sell", company, qty });
const short = (player: number, company: CompanyId, qty: number): Action => ({ type: "trade", player, kind: "short", company, qty });
const cover = (player: number, company: CompanyId, qty: number): Action => ({ type: "trade", player, kind: "cover", company, qty });
const play = (player: number, id: number): Action => ({ type: "playNews", player, card: id });

// Cards used below, looked up by title so a renumbering cannot silently change a test.
const byTitle = (t: string) => NEWS_CARDS.find((c) => c.title === t)!.id;
const AI_VIRAL = byTitle("AI product goes viral"); // Infosys +3
const US_CLIENT = byTitle("Major US client signs"); // Infosys +2
const BULL_RUN = byTitle("Bull run"); // all +2
const CRASH = byTitle("Market crash"); // all −2
const TRIAL_FAIL = byTitle("Late-stage trial results disappoint"); // Sun −3
const VISA = byTitle("US visa rules tightened"); // Infosys −2
const HUL_UP = byTitle("Festive demand surge"); // HUL +1

// ─── The deck ───────────────────────────────────────────────────────────────────────────

describe("news deck", () => {
  test("50 cards: 15 positive, 15 negative, 20 double-edged (Bull run and Market crash are market-wide)", () => {
    assert.equal(NEWS_CARDS.length, 50);
    const n = (t: string) => NEWS_CARDS.filter((c) => c.type === t).length;
    assert.equal(n("positive") + n("market") / 2, 15);
    assert.equal(n("negative") + n("market") / 2, 15);
    assert.equal(n("double"), 20);
    NEWS_CARDS.forEach((c, i) => assert.equal(c.id, i + 1));
  });

  test("every company's up and down steps balance, before and after the IPO cards join", () => {
    for (const c of COMPANY_IDS) {
      if (c === "ZOM") continue; // only Bull run and Market crash name it before it lists, and they cancel
      const net = NEWS_CARDS.reduce((n, k) => n + (k.effects[c] ?? 0), 0);
      assert.equal(net, 0, `${c} is net ${net}`);
    }
    for (const c of COMPANY_IDS) {
      const net = ALL_CARDS.reduce((n, k) => n + (k.effects[c] ?? 0), 0);
      assert.equal(net, 0, `${c} is net ${net}`);
    }
  });

  test("HUL and HDFC Bank move ±1 only, except Market crash; Bull run is +2", () => {
    for (const k of NEWS_CARDS) {
      if (k.title === "Market crash" || k.title === "Bull run") continue;
      for (const c of ["HUL", "HDFC"] as const) if (k.effects[c] !== undefined) assert.equal(Math.abs(k.effects[c]!), 1, k.title);
    }
    assert.equal(card(BULL_RUN).effects.INFY, 2);
    assert.equal(card(CRASH).effects.HUL, -2);
  });
});

// ─── Thresholds ─────────────────────────────────────────────────────────────────────────

describe("thresholds", () => {
  test("worked example: Infosys at ₹140 with 4 outstanding, buy 4 → ₹590", () => {
    const s = midGame();
    setPrice(s, "INFY", 140);
    s.players[1].shares.INFY = 4;
    // An action is at most 3 shares, so buying 4 takes both actions.
    const pv = previewTrade(s, buy(0, "INFY", 3));
    assert.ok(pv.ok);
    assert.deepEqual(pv.ok && pv.preview.prices, [140, 150, 150]);
    const a = ok(s, buy(0, "INFY", 3));
    const b = ok(a.state, buy(0, "INFY", 1));
    assert.equal(STARTING_CASH - b.state.players[0].cash, 590);
    assert.equal(price(b.state, "INFY"), 150);
    assert.ok(a.events.some((e) => e.text.includes("Infosys +1: 6th share outstanding crossed a threshold")));
  });

  test("selling below a threshold: price drops first, that share sells at the lower price", () => {
    const s = midGame();
    setPrice(s, "HUL", 150);
    s.players[0].shares.HUL = 6;
    const r = ok(s, sell(0, "HUL", 2));
    const t = r.events.find((e) => e.kind === "trade");
    assert.deepEqual(t?.kind === "trade" && t.prices, [140, 140]);
    assert.equal(price(r.state, "HUL"), 140);
  });

  test("crossing 3, 6, 9 and 12 upwards and back down", () => {
    let s = midGame();
    setPrice(s, "ONGC", 100);
    s.players[0].cash = 99999;
    s.players[0].shares.ONGC = 0;
    const prices: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = ok(s, buy(0, "ONGC", 3)).state;
      prices.push(price(s, "ONGC"));
      s.phase = { kind: "turn", player: 0, turnInRound: 0, actionsUsed: 0, step: "trade" };
    }
    assert.deepEqual(prices, [110, 120, 130, 140]);
    s = ok(s, sell(0, "ONGC", 3)).state; // 12 → 9: below 12
    assert.equal(price(s, "ONGC"), 130);
    s = ok(s, sell(0, "ONGC", 1)).state; // 9 → 8: below 9
    assert.equal(price(s, "ONGC"), 120);
  });

  test("short tokens count −1 and covering counts +1", () => {
    const s = midGame();
    setPrice(s, "DLF", 80);
    s.players[1].shares.DLF = 6;
    assert.equal(outstanding(s, "DLF"), 6);
    const r = ok(s, short(0, "DLF", 1)); // 6 → 5
    assert.equal(outstanding(r.state, "DLF"), 5);
    assert.equal(price(r.state, "DLF"), 70);
    assert.equal(r.state.players[0].cash, STARTING_CASH + 70);
    assert.equal(r.state.shorts[0].openIndex, indexOfPrice(70));
    const c = ok(r.state, cover(0, "DLF", 1)); // 5 → 6
    assert.equal(price(c.state, "DLF"), 80);
    assert.equal(c.state.players[0].cash, STARTING_CASH + 70 - 80);
    assert.equal(c.state.shorts.length, 0);
  });

  test("the bank always trades at the current price but only has 12 shares", () => {
    const s = midGame();
    s.players[1].shares.SUN = 10;
    illegal(s, buy(0, "SUN", 3), /only 2/);
  });

  test("you cannot buy what you cannot afford, counting the threshold", () => {
    const s = midGame();
    setPrice(s, "INFY", 140);
    s.players[1].shares.INFY = 4;
    s.players[0].cash = 400; // 140 + 150 + 150 = 440
    illegal(s, buy(0, "INFY", 3), /costs ₹440/);
  });
});

// ─── Ceiling and bankruptcy ─────────────────────────────────────────────────────────────

describe("ceiling", () => {
  test("upward moves past ₹500 are ignored; shares still trade at ₹500", () => {
    const s = midGame();
    setPrice(s, "HUL", 450);
    give(s, 0, BULL_RUN);
    const r = ok(s, play(0, BULL_RUN));
    assert.equal(price(r.state, "HUL"), 500);
    r.state.phase = { kind: "turn", player: 0, turnInRound: 0, actionsUsed: 0, step: "trade" };
    r.state.players[1].shares.HUL = 2;
    const b = ok(r.state, buy(0, "HUL", 1)); // 3rd share crosses at the ceiling: no move
    assert.equal(price(b.state, "HUL"), 500);
    assert.equal(b.state.players[0].cash, STARTING_CASH - 500);
  });
});

describe("bankruptcy", () => {
  test("at ₹0 shares are wiped, shorts close owing nothing, chairman removed, news ignored, no trading", () => {
    const s = midGame();
    setPrice(s, "SUN", 30);
    s.players[1].shares.SUN = 6;
    s.chairmen.SUN = 1;
    addShort(s, 2, "SUN", 60);
    s.players[2].cash = 1560;
    give(s, 0, TRIAL_FAIL, HUL_UP);
    const r = ok(s, play(0, TRIAL_FAIL));
    const st = r.state;
    assert.equal(st.companies.SUN.bankrupt, true);
    assert.equal(st.players[1].shares.SUN, 0);
    assert.equal(st.shorts.length, 0);
    assert.equal(st.players[2].cash, 1560);
    assert.equal(st.chairmen.SUN, null);
    st.phase = { kind: "turn", player: 0, turnInRound: 0, actionsUsed: 0, step: "trade" };
    illegal(st, buy(0, "SUN", 1), /bankrupt/);
    illegal(st, short(0, "SUN", 1), /bankrupt/);
  });

  test("re-lists at ₹60 at the start of the next round", () => {
    let s = midGame();
    s.companies.SUN = { priceIndex: 0, bankrupt: true, listed: true };
    // Finish round 1: each of 3 players plays and draws.
    for (let i = 0; i < 3; i++) {
      give(s, i, s.deck[0]);
      s = ok(s, play(i, s.players[i].hand[0])).state;
      s = ok(s, { type: "draw", player: i, from: "deck" }).state;
    }
    assert.equal(s.round, 2);
    assert.equal(s.companies.SUN.bankrupt, false);
    assert.equal(s.companies.SUN.priceIndex, RELIST_INDEX);
    assert.equal(TRACK[RELIST_INDEX], 60);
  });

  test("bankrupt in the final round stays at ₹0", () => {
    let s = midGame({ round: 6, rounds: 6 });
    s.companies.SUN = { priceIndex: 0, bankrupt: true, listed: true };
    for (let i = 0; i < 3; i++) {
      give(s, i, s.deck[0]);
      s = ok(s, play(i, s.players[i].hand[0])).state;
      s = ok(s, { type: "draw", player: i, from: "deck" }).state;
    }
    assert.equal(s.phase.kind, "ended");
    assert.equal(price(s, "SUN"), 0);
  });

  test("a sale that takes the price to ₹0 bankrupts it and that share is worth nothing", () => {
    const s = midGame();
    setPrice(s, "DLF", 10);
    s.players[0].shares.DLF = 3;
    const r = ok(s, sell(0, "DLF", 1));
    assert.equal(r.state.companies.DLF.bankrupt, true);
    assert.equal(r.state.players[0].cash, STARTING_CASH);
  });
});

// ─── Shorts ─────────────────────────────────────────────────────────────────────────────

describe("short selling", () => {
  test("not allowed in round 0", () => {
    const { state } = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 1 });
    illegal(state, short(0, "INFY", 1), /round 1/);
  });

  test("3 tokens per company", () => {
    const s = midGame();
    addShort(s, 1, "ONGC", 100);
    addShort(s, 1, "ONGC", 100);
    illegal(s, short(0, "ONGC", 2), /Only 1/);
  });

  test("5-step cap: closes at the price 5 steps up even if news jumped further", () => {
    const s = midGame();
    setPrice(s, "INFY", 140);
    addShort(s, 1, "INFY", 100); // cap at 150 (5 steps: 110 120 130 140 150)
    give(s, 0, AI_VIRAL);
    const r = ok(s, play(0, AI_VIRAL)); // 140 → 200
    assert.equal(r.state.shorts.length, 0);
    assert.equal(r.state.players[1].cash, STARTING_CASH - 150);
    // The forced close counts as a buy: -1 → 0 crosses nothing, so the price stays at 200.
    assert.equal(price(r.state, "INFY"), 200);
  });

  test("forced closes chain: one close crosses a threshold and caps the next", () => {
    const s = midGame();
    setPrice(s, "ONGC", 130);
    s.players[0].shares.ONGC = 7; // 7 held − 2 shorts = 5 outstanding
    addShort(s, 1, "ONGC", 90); // cap 140
    addShort(s, 2, "ONGC", 100); // cap 150
    give(s, 0, byTitle("Gas price revised upward")); // ONGC +1 → 140
    const r = ok(s, play(0, byTitle("Gas price revised upward")));
    // Bilal's short closes at 140; count 5 → 6 crosses a threshold → 150; Chitra's caps at 150.
    assert.equal(r.state.shorts.length, 0);
    assert.equal(r.state.players[1].cash, STARTING_CASH - 140);
    assert.equal(r.state.players[2].cash, STARTING_CASH - 150);
    assert.equal(price(r.state, "ONGC"), 150);
    const forced = r.events.filter((e) => e.kind === "shortClosed" && e.how === "forced");
    assert.equal(forced.length, 2);
  });

  test("a short opened 5 steps or fewer from the ceiling has no cap", () => {
    const s = midGame();
    setPrice(s, "HUL", 450);
    addShort(s, 1, "HUL", 300); // 5 steps up would be past ₹500
    give(s, 0, BULL_RUN);
    const r = ok(s, play(0, BULL_RUN));
    assert.equal(price(r.state, "HUL"), 500);
    assert.equal(r.state.shorts.length, 1);
  });

  test("can't pay: sells shares of their choice until they can", () => {
    const s = midGame();
    setPrice(s, "INFY", 140);
    addShort(s, 1, "INFY", 100);
    s.players[1].cash = 50;
    s.players[1].shares.HUL = 2;
    give(s, 0, AI_VIRAL, HUL_UP);
    const r = ok(s, play(0, AI_VIRAL));
    assert.equal(r.state.debt?.player, 1);
    assert.equal(r.state.debt?.amount, 150);
    assert.equal(actor(r.state), 1);
    illegal(r.state, { type: "draw", player: 0, from: "deck" }, /must first sell/);
    const a = ok(r.state, { type: "forcedSell", player: 1, company: "HUL", qty: 1 });
    assert.equal(a.state.players[1].cash, 50 + 150 - 150);
    assert.equal(a.state.debt, null);
    assert.equal(actor(a.state), 0); // back to the active player's draw
  });

  test("last resort: no shares left, pays everything, bank absorbs, no more shorts", () => {
    const s = midGame();
    setPrice(s, "INFY", 140);
    addShort(s, 1, "INFY", 100);
    s.players[1].cash = 50;
    give(s, 0, AI_VIRAL);
    const r = ok(s, play(0, AI_VIRAL));
    assert.equal(r.state.debt, null);
    assert.equal(r.state.players[1].cash, 0);
    assert.equal(r.state.players[1].shortBanned, true);
    assert.ok(r.events.some((e) => e.kind === "lastResort"));
    const t = structuredClone(r.state);
    t.phase = { kind: "turn", player: 1, turnInRound: 1, actionsUsed: 0, step: "trade" };
    illegal(t, short(1, "ONGC", 1), /last-resort/);
  });

  test("last resort leaves the player's other shorts open", () => {
    const s = midGame();
    setPrice(s, "INFY", 140);
    addShort(s, 1, "INFY", 100);
    addShort(s, 1, "DLF", 80);
    s.players[1].cash = 10;
    give(s, 0, AI_VIRAL);
    const r = ok(s, play(0, AI_VIRAL));
    assert.equal(r.state.shorts.length, 1);
    assert.equal(r.state.shorts[0].company, "DLF");
  });

  test("a short that reached its cap is still closed if a forced sale pulls the price back under it", () => {
    const s = midGame();
    setPrice(s, "INFY", 140);
    s.players[1].shares.INFY = 5;
    s.players[1].cash = 50;
    addShort(s, 1, "INFY", 100); // cap ₹150
    addShort(s, 2, "INFY", 100); // cap ₹150
    give(s, 0, byTitle("Government digital contract won")); // Infosys +1 → ₹150
    const r = ok(s, play(0, byTitle("Government digital contract won")));
    assert.equal(r.state.debt?.player, 1); // Bilal closes first and cannot pay
    const a = ok(r.state, { type: "forcedSell", player: 1, company: "INFY", qty: 2 });
    // His sale dropped the price below the cap…
    assert.ok(a.events.some((e) => e.kind === "price" && e.company === "INFY" && e.from === 150 && e.to === 140));
    // …but Chitra's short had already hit it, so it closes (and that +1 lifts the price back to ₹150).
    assert.equal(a.state.shorts.length, 0);
    assert.equal(price(a.state, "INFY"), 150);
    assert.equal(a.state.players[2].cash, STARTING_CASH - 150);
  });

  test("a player may hold and short the same company, and use both actions on it", () => {
    const s = midGame();
    s.players[0].shares.ONGC = 2;
    const a = ok(s, short(0, "ONGC", 1));
    const b = ok(a.state, buy(0, "ONGC", 1));
    assert.equal(b.state.players[0].shares.ONGC, 3);
    illegal(b.state, buy(0, "ONGC", 1), /both trade actions/);
  });
});

// ─── Chairman ───────────────────────────────────────────────────────────────────────────

describe("chairman", () => {
  test("token moves the moment holdings change; a 6–6 tie means nobody", () => {
    let s = midGame();
    s.players[0].cash = 99999;
    s.players[1].shares.HDFC = 5;
    s = ok(s, buy(0, "HDFC", 3)).state;
    s = ok(s, buy(0, "HDFC", 3)).state;
    assert.equal(s.chairmen.HDFC, 0);
    s.phase = { kind: "turn", player: 1, turnInRound: 1, actionsUsed: 0, step: "trade" };
    s.players[1].cash = 99999;
    s = ok(s, buy(1, "HDFC", 1)).state; // 6–6
    assert.equal(s.chairmen.HDFC, null);
    s = ok(s, { type: "trade", player: 1, kind: "sell", company: "HDFC", qty: 1 }).state; // 6–5
    assert.equal(s.chairmen.HDFC, 0);
  });

  test("short tokens do not count towards it", () => {
    const s = midGame();
    s.players[0].shares.DLF = 6;
    addShort(s, 0, "DLF", 80);
    const r = ok(s, buy(0, "DLF", 1));
    assert.equal(r.state.chairmen.DLF, 0);
  });
});

// ─── Dividends ──────────────────────────────────────────────────────────────────────────

describe("dividends", () => {
  function endRound(s: GameState): ReturnType<typeof ok> {
    let r: ReturnType<typeof ok> = { state: s, events: [] };
    const all: GameEvent[] = [];
    for (let i = 0; i < s.players.length; i++) {
      give(r.state, i, r.state.deck[r.state.deck.length - 1]);
      r = ok(r.state, play(i, r.state.players[i].hand[r.state.players[i].hand.length - 1]));
      all.push(...r.events);
      r = ok(r.state, { type: "draw", player: i, from: "deck" });
      all.push(...r.events);
    }
    return { state: r.state, events: all };
  }

  test("paid at the end of round 3, at the prices then, with doubles, chairman bonus and shorts paying", () => {
    const s = midGame({ round: 3 });
    // Fix the cards drawn so no news moves these prices.
    const quiet = NEWS_CARDS.filter((k) => !k.effects.HUL && !k.effects.SUN && !k.effects.INFY).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    setPrice(s, "HUL", 225); // ₹20 → doubled ₹40
    setPrice(s, "INFY", 120); // ₹10
    setPrice(s, "SUN", 110); // ₹0
    s.players[0].shares.HUL = 7; // chairman
    s.chairmen.HUL = 0;
    s.players[1].shares.INFY = 2;
    s.players[1].shares.SUN = 4;
    addShort(s, 2, "HUL", 300);
    const r = endRound(s);
    const div = r.events.filter((e) => e.kind === "dividend" && e.paid.length > 0);
    assert.deepEqual(div.map((e) => e.kind === "dividend" && [e.company, e.perShare]), [["HUL", 40], ["INFY", 10]]);
    assert.equal(r.state.players[0].cash, STARTING_CASH + 7 * 40 + 3 * 40);
    assert.equal(r.state.players[1].cash, STARTING_CASH + 2 * 10);
    assert.equal(r.state.players[2].cash, STARTING_CASH - 40);
  });

  test("short sellers pay after every dividend is paid out, whatever order the companies are in", () => {
    const s = midGame({ round: 3 });
    const quiet = ALL_CARDS.filter((k) => !k.effects.HUL && !k.effects.SUN).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    setPrice(s, "HUL", 150); // ₹10, doubled: the short owes ₹20
    setPrice(s, "SUN", 150); // ₹10 a share
    addShort(s, 1, "HUL", 150);
    s.players[1].cash = 0;
    s.players[1].shares.SUN = 3;
    const r = endRound(s);
    assert.equal(r.state.players[1].cash, 30 - 20);
    assert.ok(!r.events.some((e) => e.kind === "shortfall"));
  });

  test("no dividend at the end of round 2", () => {
    const s = midGame({ round: 2 });
    s.players[0].shares.HUL = 3;
    const r = endRound(s);
    assert.equal(r.events.filter((e) => e.kind === "dividend").length, 0);
  });

  test("a short seller who cannot pay a dividend pays what they have; no forced sale", () => {
    const s = midGame({ round: 3 });
    const quiet = NEWS_CARDS.filter((k) => !k.effects.HDFC).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    setPrice(s, "HDFC", 400); // ₹30 doubled = ₹60
    addShort(s, 2, "HDFC", 400);
    s.players[2].cash = 25;
    s.players[2].shares.ONGC = 3;
    const r = endRound(s);
    assert.equal(r.state.players[2].cash, 0);
    assert.equal(r.state.players[2].shares.ONGC, 3);
    assert.equal(r.state.players[2].shortBanned, false);
    assert.ok(r.events.some((e) => e.kind === "shortfall"));
  });
});

describe("play-test variants", () => {
  test("drift: a company at or below the level drops one step at the end of the round", () => {
    let s = midGame();
    s.config.driftAtOrBelow = 0;
    setPrice(s, "ONGC", 100);
    setPrice(s, "DLF", 100);
    s.players[1].shares.DLF = 2;
    const quiet = NEWS_CARDS.filter((k) => !k.effects.ONGC && !k.effects.DLF).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    for (let i = 0; i < 3; i++) {
      give(s, i, s.deck[s.deck.length - 1]);
      s = ok(s, play(i, s.players[i].hand[s.players[i].hand.length - 1])).state;
      s = ok(s, { type: "draw", player: i, from: "deck" }).state;
    }
    assert.equal(price(s, "ONGC"), 90);
    assert.equal(price(s, "DLF"), 100);
  });

  test("drift back to start uses the IPO company's listing price", () => {
    let s = midGame();
    s.config.driftAtOrBelow = 0;
    s.config.driftMode = "toStart";
    s.companies.ZOM = { priceIndex: indexOfPrice(90), bankrupt: false, listed: true };
    s.homeIndex.ZOM = indexOfPrice(60);
    s.deck.push(...IPO_CARDS.map((k) => k.id));
    const quiet = ALL_CARDS.filter((k) => !k.effects.ZOM).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    for (let i = 0; i < 3; i++) {
      give(s, i, s.deck[s.deck.length - 1]);
      s = ok(s, play(i, s.players[i].hand[s.players[i].hand.length - 1])).state;
      s = ok(s, { type: "draw", player: i, from: "deck" }).state;
    }
    assert.equal(price(s, "ZOM"), 80);
  });

  test("bad variant settings are refused, not crashed on", () => {
    assert.throws(() => newGame({ players: ["A", "B", "C"], rounds: 6, seed: 1, ipoBand: [65, 75] }), /price track/);
    assert.throws(() => newGame({ players: ["A", "B", "C"], rounds: 6, seed: 1, ipoBand: [] }), /price track/);
    assert.throws(() => newGame({ players: ["A", "B", "C"], rounds: 6, seed: 1, startingCash: -5 }), /Starting cash/);
  });

  test("delayed news: the card goes face-down and takes effect at the start of its owner's next turn", () => {
    let s = midGame();
    s.config.delayedNews = true;
    setPrice(s, "INFY", 100);
    const quiet = ALL_CARDS.filter((k) => !k.effects.INFY).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    give(s, 0, AI_VIRAL);
    s = ok(s, play(0, AI_VIRAL)).state;
    assert.equal(price(s, "INFY"), 100); // nothing yet
    assert.equal(s.pendingNews[0], AI_VIRAL);
    s = ok(s, { type: "draw", player: 0, from: "deck" }).state;
    for (const i of [1, 2]) {
      give(s, i, s.deck[s.deck.length - 1]);
      s = ok(s, play(i, s.players[i].hand[s.players[i].hand.length - 1])).state;
      s = ok(s, { type: "draw", player: i, from: "deck" }).state;
    }
    // Back to Asha: her card resolves before she trades.
    assert.equal(price(s, "INFY"), 130);
    assert.equal(s.pendingNews[0], null);
    assert.ok(s.discard.includes(AI_VIRAL));
  });

  test("delayed news: cards still face-down at the end of the game are discarded", () => {
    let s = midGame({ round: 6, rounds: 6 });
    s.config.delayedNews = true;
    for (let i = 0; i < 3; i++) {
      give(s, i, s.deck[s.deck.length - 1]);
      s = ok(s, play(i, s.players[i].hand[s.players[i].hand.length - 1])).state;
      s = ok(s, { type: "draw", player: i, from: "deck" }).state;
    }
    assert.equal(s.phase.kind, "ended");
    assert.ok(s.pendingNews.every((x) => x === null));
  });

  test("starting cash can be set", () => {
    const { state } = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 1, startingCash: 1200 });
    assert.ok(state.players.every((p) => p.cash === 1200));
  });
});

// ─── The IPO ────────────────────────────────────────────────────────────────────────────

describe("Zomato IPO", () => {
  const bid = (qty: number, price: number) => ({ qty, price });

  test("example 1: competitive book lists at ₹80, the cut-off bidders are rationed clockwise from the start player", () => {
    // Asha, Bilal, Chitra, Dev; Bilal (seat 1) started the round.
    const r = ipoBook([bid(6, 90), bid(3, 80), bid(4, 80), bid(3, 80)], 1);
    assert.equal(r.listingPrice, 80);
    assert.deepEqual(r.allocated, [6, 2, 2, 2]);
  });

  test("example 2: a bid below the listing price gets nothing", () => {
    const r = ipoBook([bid(6, 90), bid(3, 80), bid(4, 80), bid(3, 70)], 1);
    assert.equal(r.listingPrice, 80);
    assert.deepEqual(r.allocated, [6, 3, 3, 0]);
  });

  test("example 3: undersubscribed lists at the floor and the rest stay in the bank", () => {
    const r = ipoBook([bid(3, 70), bid(3, 60), bid(3, 90), bid(0, 0)], 0);
    assert.equal(r.listingPrice, 60);
    assert.deepEqual(r.allocated, [3, 3, 3, 0]);
  });

  function listZomato(s: GameState, at: number) {
    s.companies.ZOM = { priceIndex: indexOfPrice(at), bankrupt: false, listed: true };
    s.deck.push(...IPO_CARDS.map((k) => k.id));
  }

  function toRound4(players = 4): GameState {
    let s = midGame({ round: 3, players });
    s.startPlayer = 1;
    s.phase = { kind: "turn", player: 1, turnInRound: 0, actionsUsed: 0, step: "trade" };
    const quiet = NEWS_CARDS.filter((k) => Object.keys(k.effects).length < 6).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    for (let k = 0; k < players; k++) {
      const i = (1 + k) % players;
      give(s, i, s.deck[s.deck.length - 1]);
      s = ok(s, play(i, s.players[i].hand[s.players[i].hand.length - 1])).state;
      s = ok(s, { type: "draw", player: i, from: "deck" }).state;
    }
    return s;
  }

  test("bids open at the start of round 4, then the listing pops by the thresholds and its cards join the deck", () => {
    let s = toRound4();
    assert.equal(s.round, 4);
    assert.equal(s.phase.kind, "ipo");
    const deckBefore = s.deck.length;
    const bids: [number, number][] = [[6, 90], [3, 80], [4, 80], [3, 80]];
    bids.forEach(([q, p], i) => {
      s = ok(s, { type: "ipoBid", player: i, qty: q, price: p }).state;
    });
    assert.equal(s.companies.ZOM.listed, true);
    assert.equal(price(s, "ZOM"), 120); // ₹80 + 4 thresholds
    assert.deepEqual(s.players.map((p) => p.shares.ZOM), [6, 2, 2, 2]);
    assert.equal(s.players[0].cash, STARTING_CASH - 480);
    assert.equal(s.chairmen.ZOM, 0);
    assert.equal(s.deck.length, deckBefore + IPO_CARDS.length);
    const ph = s.phase as GameState["phase"];
    assert.equal(ph.kind === "turn" && ph.player, 1);
  });

  test("bids are 0–6 shares at a band price you can afford", () => {
    const s = toRound4();
    illegal(s, { type: "ipoBid", player: 0, qty: 7, price: 80 }, /0 to 6/);
    illegal(s, { type: "ipoBid", player: 0, qty: 2, price: 95 }, /₹60, ₹70, ₹80, ₹90/);
    s.players[0].cash = 200;
    illegal(s, { type: "ipoBid", player: 0, qty: 3, price: 80 }, /could cost ₹240/);
  });

  test("before listing it cannot be traded and market-wide news passes it by", () => {
    const s = midGame();
    illegal(s, buy(0, "ZOM", 1), /not listed/);
    give(s, 0, BULL_RUN);
    const r = ok(s, play(0, BULL_RUN));
    assert.equal(r.state.companies.ZOM.listed, false);
    assert.ok(!r.events.some((e) => e.kind === "price" && e.company === "ZOM"));
  });

  test("in a 3-player game a bid may be for up to 8 shares", () => {
    const s = toRound4(3);
    assert.equal(s.phase.kind, "ipo");
    ok(s, { type: "ipoBid", player: 0, qty: 8, price: 60 });
    illegal(s, { type: "ipoBid", player: 0, qty: 9, price: 60 }, /0 to 8/);
  });

  test("no shorting in its listing round; allowed from round 5", () => {
    const s = midGame({ round: 4 });
    listZomato(s, 150);
    illegal(s, short(0, "ZOM", 1), /listing round/);
    s.round = 5;
    ok(s, short(0, "ZOM", 1));
  });

  test("Zomato pays no dividend", () => {
    let s = midGame({ round: 6 });
    listZomato(s, 400);
    s.players[0].shares.ZOM = 7;
    s.chairmen.ZOM = 0;
    s.players[1].shares.HUL = 1; // a company that does pay, to show the payout ran
    setPrice(s, "HUL", 200);
    const events: GameEvent[] = [];
    const quiet = ALL_CARDS.filter((k) => !k.effects.ZOM && !k.effects.HUL).map((k) => k.id);
    s.deck = [...s.deck.filter((x) => !quiet.includes(x)), ...quiet.filter((x) => s.deck.includes(x))];
    for (let i = 0; i < 3; i++) {
      give(s, i, s.deck[s.deck.length - 1]);
      const r = ok(s, play(i, s.players[i].hand[s.players[i].hand.length - 1]));
      const d = ok(r.state, { type: "draw", player: i, from: "deck" });
      events.push(...r.events, ...d.events);
      s = d.state;
    }
    const div = events.filter((e) => e.kind === "dividend");
    assert.ok(div.some((e) => e.kind === "dividend" && e.company === "HUL"));
    assert.ok(!div.some((e) => e.kind === "dividend" && e.company === "ZOM"));
    assert.equal(s.chairmen.ZOM, 0);
  });

  test("with the IPO switched off, round 4 starts with turns", () => {
    const s = midGame({ round: 3 });
    s.config.ipo = false;
    let t = s;
    for (let i = 0; i < 3; i++) {
      give(t, i, t.deck[t.deck.length - 1]);
      t = ok(t, play(i, t.players[i].hand[t.players[i].hand.length - 1])).state;
      t = ok(t, { type: "draw", player: i, from: "deck" }).state;
    }
    assert.equal(t.phase.kind, "turn");
  });
});

// ─── Round 0 ────────────────────────────────────────────────────────────────────────────

describe("the opening (round 0)", () => {
  test("oversubscription is shared out one at a time in seat order", () => {
    assert.deepEqual(allocate([6, 6, 6], 12), [4, 4, 4]);
    assert.deepEqual(allocate([6, 6, 6, 6], 12), [3, 3, 3, 3]);
    assert.deepEqual(allocate([6, 6, 6, 6, 6], 12), [3, 3, 2, 2, 2]);
    assert.deepEqual(allocate([1, 6, 6], 12), [1, 6, 5]);
    assert.deepEqual(allocate([2, 3], 12), [2, 3]);
  });

  test("simultaneous orders, starting price, threshold steps, then summed news, then draw back up", () => {
    let { state: s } = newGame({ players: ["A", "B", "C", "D", "E"], rounds: 9, seed: 3 });
    // Pick each player's card so the news total is known.
    const cards = [US_CLIENT, VISA, BULL_RUN, HUL_UP, CRASH];
    s.players.forEach((p, i) => {
      s.deck.push(...p.hand);
      p.hand = [];
      const fillers = s.deck.filter((x) => !cards.includes(x)).slice(0, 3);
      give(s, i, cards[i], ...fillers);
    });
    const orders = [{ INFY: 6 }, { INFY: 6 }, { INFY: 6 }, { INFY: 4, HUL: 2 }, { HDFC: 1 }];
    // Before everybody has written their orders, nothing is revealed.
    for (let i = 0; i < 5; i++) {
      s = ok(s, { type: "openingOrder", player: i, orders: orders[i], card: cards[i] }).state;
      if (i < 4) assert.equal(s.phase.kind, "opening");
    }
    // Infosys: 22 wanted → 3,3,2,2,0... seat order one at a time: A3 B3 C2 D2? (4 asked) → 3,3,3,3 needs 12; E asked 0.
    assert.deepEqual(s.players.map((p) => p.shares.INFY), [3, 3, 3, 3, 0]);
    assert.equal(s.players[0].cash, STARTING_CASH - 3 * 100);
    assert.equal(s.players[3].cash, STARTING_CASH - 3 * 100 - 2 * 150);
    // Infosys: 12 outstanding → +4 steps (100 → 140); news +2 −2 +2 −2 = 0 → stays 140.
    assert.equal(price(s, "INFY"), 140);
    // HUL: 2 outstanding → no threshold; news +2 +1 −2 = +1 → 175.
    assert.equal(price(s, "HUL"), 175);
    // HDFC: 1 share; news +2 −2 = 0 → 120.
    assert.equal(price(s, "HDFC"), 120);
    assert.equal(s.phase.kind, "openingDraw");
    for (let i = 0; i < 5; i++) {
      illegal(s, { type: "draw", player: (i + 1) % 5, from: "deck" }, /seat order/);
      const slot = s.market.findIndex((x) => x !== null);
      s = ok(s, i % 2 ? { type: "draw", player: i, from: "deck" } : { type: "draw", player: i, from: "market", slot }).state;
    }
    assert.equal(s.round, 1);
    assert.ok(s.players.every((p) => p.hand.length === 4));
    assert.equal(s.phase.kind === "turn" && s.phase.player, s.startPlayer);
  });

  test("opening orders must be affordable", () => {
    const { state: s } = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 4, startingCash: 500 });
    illegal(s, { type: "openingOrder", player: 0, orders: { HUL: 4 }, card: s.players[0].hand[0] }, /could cost ₹600/);
    ok(s, { type: "openingOrder", player: 0, orders: { HUL: 3 }, card: s.players[0].hand[0] });
  });

  test("orders are capped at 6 shares, from your own hand", () => {
    const { state: s } = newGame({ players: ["A", "B", "C"], rounds: 6, seed: 4 });
    illegal(s, { type: "openingOrder", player: 0, orders: { HUL: 4, DLF: 3 }, card: s.players[0].hand[0] }, /up to 6/);
    illegal(s, { type: "openingOrder", player: 0, orders: { HUL: 1 }, card: s.players[1].hand[0] }, /own hand/);
  });
});

// ─── Turn order and the deck ────────────────────────────────────────────────────────────

describe("turns", () => {
  test("trade (up to 2) → play news (mandatory) → draw", () => {
    const s = midGame();
    give(s, 0, HUL_UP);
    illegal(s, { type: "draw", player: 0, from: "deck" }, /Play a news card/);
    illegal(s, buy(1, "HUL", 1), /not your turn/);
    const a = ok(s, play(0, HUL_UP));
    illegal(a.state, buy(0, "HUL", 1), /trading is over/);
    const b = ok(a.state, { type: "draw", player: 0, from: "market", slot: 2 });
    assert.equal(b.state.market.every((x) => x !== null), true);
    assert.equal(actor(b.state), 1);
  });

  test("turn order runs clockwise from the start player for the rest of the game", () => {
    let s = midGame({ players: 4 });
    s.startPlayer = 2;
    s.phase = { kind: "turn", player: 2, turnInRound: 0, actionsUsed: 0, step: "trade" };
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      const p = actor(s)!;
      seen.push(p);
      give(s, p, s.deck[0]);
      s = ok(s, play(p, s.players[p].hand[0])).state;
      s = ok(s, { type: "draw", player: p, from: "deck" }).state;
    }
    assert.deepEqual(seen, [2, 3, 0, 1, 2, 3, 0, 1]);
    assert.equal(s.round, 3);
  });

  test("when the deck runs out the played cards are shuffled into a new deck", () => {
    const s = midGame();
    give(s, 0, HUL_UP);
    s.discard = [...s.deck];
    s.deck = [];
    const r = ok(s, play(0, HUL_UP));
    const d = ok(r.state, { type: "draw", player: 0, from: "deck" });
    assert.ok(d.events.some((e) => e.kind === "reshuffle"));
    assert.equal(d.state.discard.length, 0);
  });

  test("taking the last market card with an empty deck reshuffles to refill the slot", () => {
    const s = midGame();
    give(s, 0, HUL_UP);
    s.discard = [...s.deck];
    s.deck = [];
    const r = ok(s, play(0, HUL_UP));
    const d = ok(r.state, { type: "draw", player: 0, from: "market", slot: 1 });
    assert.notEqual(d.state.market[1], null);
  });
});

// ─── Scoring ────────────────────────────────────────────────────────────────────────────

describe("scoring", () => {
  test("net worth = cash + shares × price − cost to cover shorts; ties go to cash, then shared", () => {
    const s = midGame();
    setPrice(s, "HUL", 200);
    setPrice(s, "DLF", 80);
    s.players[0].cash = 1000;
    s.players[0].shares.HUL = 3; // 600
    s.players[1].cash = 1680;
    addShort(s, 1, "DLF", 80); // −80 → 1600
    s.players[2].cash = 1600;
    const st = standings(s);
    assert.deepEqual(st.map((x) => [x.name, x.netWorth, x.rank]), [["Bilal", 1600, 1], ["Chitra", 1600, 2], ["Asha", 1600, 3]]);
  });

  test("equal net worth and equal cash is a shared win", () => {
    const s = midGame();
    s.players[0].cash = 2000;
    s.players[1].cash = 2000;
    const st = standings(s);
    assert.deepEqual(st.filter((x) => x.rank === 1).map((x) => x.name).sort(), ["Asha", "Bilal"]);
  });
});

// ─── Determinism and whole games ────────────────────────────────────────────────────────

describe("determinism", () => {
  test("the same seed and action log reproduce the same game", () => {
    const strategies = [STRATEGIES.random, STRATEGIES.favour, STRATEGIES.dividend, STRATEGIES.random];
    const g = playGame({ players: ["A", "B", "C", "D"], rounds: 12, seed: 42 }, strategies);
    const r = replay({ config: g.config, actions: g.actions });
    assert.deepEqual(r.state, g.state);
    assert.deepEqual(r.events.map((e) => e.text), g.events.map((e) => e.text));
    const again = playGame({ players: ["A", "B", "C", "D"], rounds: 12, seed: 42 }, strategies);
    assert.deepEqual(again.actions, g.actions);
  });

  test("200 random games of every size and length finish with no illegal state", () => {
    for (let i = 0; i < 200; i++) {
      const n = 3 + (i % 3);
      const rounds = ([6, 9, 12] as const)[i % 3];
      const g = playGame({ players: Array.from({ length: n }, (_, k) => `P${k}`), rounds, seed: 1000 + i }, Array.from({ length: n }, () => STRATEGIES.random));
      assert.equal(g.state.phase.kind, "ended");
      assert.equal(g.state.round, rounds);
    }
  });
});
