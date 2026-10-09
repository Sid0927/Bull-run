/** Plays games with computer players and collects balance statistics. */
import {
  COMPANIES,
  COMPANY_IDS,
  TRACK,
  actor,
  apply,
  invariantErrors,
  newGame,
  type Action,
  type CompanyId,
  type GameConfig,
  type GameEvent,
  type GameLength,
  type GameState,
} from "../engine/index.ts";
import { Rng } from "../engine/rng.ts";
import { STRATEGIES, type Strategy } from "./strategies.ts";

export interface PlayedGame {
  config: GameConfig;
  strategies: string[]; // by seat
  actions: Action[];
  events: GameEvent[];
  state: GameState;
}

const MAX_ACTIONS = 5000;

export function playGame(config: GameConfig, strategies: Strategy[], checkInvariants = true): PlayedGame {
  let { state, events } = newGame(config);
  events = [...events];
  const actions: Action[] = [];
  const rng = new Rng(config.seed ^ 0x5bd1e995);
  while (state.phase.kind !== "ended") {
    if (actions.length > MAX_ACTIONS) throw new Error(`Game ${config.seed} did not finish in ${MAX_ACTIONS} actions`);
    const seat = actor(state)!;
    const tried: string[] = [];
    let done = false;
    for (const a of strategies[seat].candidates(state, seat, rng)) {
      const r = apply(state, a);
      if (!r.ok) {
        tried.push(r.error);
        continue;
      }
      state = r.state;
      events.push(...r.events);
      actions.push(a);
      done = true;
      break;
    }
    if (!done) throw new Error(`Seat ${seat} (${strategies[seat].name}) had no legal action in game ${config.seed}: ${tried.slice(-3).join(" / ")}`);
    if (checkInvariants) {
      const errs = invariantErrors(state);
      if (errs.length) throw new Error(`Illegal state in game ${config.seed} after action ${actions.length}: ${errs.join("; ")}`);
    }
  }
  return { config, strategies: strategies.map((s) => s.name), actions, events, state };
}

export interface BatchOptions {
  games: number;
  players: number;
  rounds: GameLength;
  strategies: string[];
  seed: number;
  startPrices?: Partial<Record<CompanyId, number>>;
  startingCash?: number;
  driftAtOrBelow?: number;
  driftMode?: "down" | "toStart";
  ipo?: boolean;
  ipoBand?: number[];
  ipoMaxBid?: number;
  delayedNews?: boolean;
  chairmanMultiplier?: number;
  dividendBands?: { from: number; pays: number }[];
  ipoPaysDividend?: boolean;
}

export interface Report {
  options: BatchOptions;
  wins: { byStrategy: Record<string, { seats: number; wins: number; rate: number; avgNetWorth: number }>; bySeat: { seat: number; wins: number; rate: number }[] };
  netWorth: { avgAll: number; avgWinner: number; avgLast: number; avgSpread: number; maxSpread: number };
  companies: Record<
    CompanyId,
    { start: number; avgSwing: number; endedBelowStartPct: number; avgFinal: number; medianFinal: number; finalDistribution: Record<number, number>; bankruptGamesPct: number; bankruptcies: number; reached500GamesPct: number }
  >;
  chairmen: Record<CompanyId, { roundsWithChairmanPct: number; gamesWithChairmanPct: number; byStrategy: Record<string, number> }> & {};
  shorts: { openedPerGame: number; coveredPerGame: number; forcedPerGame: number; closedByBankruptcyPerGame: number; debtsPerGame: number; lastResortPerGame: number; gamesWithLastResortPct: number; shortDividendShortfalls: number };
  cashByRound: { round: number; avgCash: number }[];
  /** Rupees paid out per game, by kind; and the share of the winner's net worth that was chairman bonus. */
  income: { dividendsPerGame: number; chairmanPerGame: number; chairmanShareOfWinnerPct: number };
  ipo: {
    games: number;
    listingDistribution: Record<number, number>;
    avgListing: number;
    avgAfterPop: number;
    avgAllotted: number;
    undersubscribedPct: number;
    /** Of games with a single biggest allottee, how often that player won. */
    biggestAllotteeWinPct: number;
    avgOracleFinal: number;
  };
  avgActionsPerGame: number;
}

/** Middle value of a sorted list; the mean of the two middle values for an even count. */
function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

export function runBatch(opts: BatchOptions, onProgress?: (done: number) => void): Report {
  const strategies = opts.strategies.map((n) => {
    const s = STRATEGIES[n];
    if (!s) throw new Error(`Unknown strategy "${n}". Known: ${Object.keys(STRATEGIES).join(", ")}`);
    return s;
  });
  const seatRng = new Rng(opts.seed);
  const byStrategy: Record<string, { seats: number; wins: number; worth: number }> = {};
  for (const s of strategies) byStrategy[s.name] = { seats: 0, wins: 0, worth: 0 };
  const seatWins = Array.from({ length: opts.players }, () => 0);
  const finals = Object.fromEntries(COMPANY_IDS.map((c) => [c, [] as number[]])) as Record<CompanyId, number[]>;
  const bankrupt = Object.fromEntries(COMPANY_IDS.map((c) => [c, { games: 0, events: 0 }])) as Record<CompanyId, { games: number; events: number }>;
  const top = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
  const chair = Object.fromEntries(COMPANY_IDS.map((c) => [c, { rounds: 0, games: 0, byStrategy: {} as Record<string, number> }])) as Record<
    CompanyId,
    { rounds: number; games: number; byStrategy: Record<string, number> }
  >;
  // Average of the largest distance from the starting price reached in each game.
  const swing = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
  const listedGames = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
  const startSum = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
  const belowStart = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
  let roundEnds = 0;
  let divPaid = 0, chairPaid = 0, winnerChairShare = 0;
  const listedRoundEnds = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
  const sh = { opened: 0, covered: 0, forced: 0, bankrupt: 0, debts: 0, lastResort: 0, lastResortGames: 0, shortfalls: 0 };
  const cash: { sum: number; n: number }[] = [];
  const ipo = { games: 0, listing: 0, after: 0, allotted: 0, under: 0, dist: {} as Record<number, number>, bigGames: 0, bigWins: 0, orgFinal: 0 };
  let worthAll = 0, worthWin = 0, worthLast = 0, spreadSum = 0, spreadMax = 0, actionsSum = 0;

  for (let g = 0; g < opts.games; g++) {
    // Cycle the strategy list to fill the table, then shuffle seats so seat and strategy are not confounded.
    const lineup = seatRng.shuffle(Array.from({ length: opts.players }, (_, i) => strategies[i % strategies.length]));
    const config: GameConfig = { players: lineup.map((s, i) => `${s.name}-${i + 1}`), rounds: opts.rounds, seed: (opts.seed * 100003 + g) | 0, startPrices: opts.startPrices, startingCash: opts.startingCash, driftAtOrBelow: opts.driftAtOrBelow, driftMode: opts.driftMode, ipo: opts.ipo, ipoBand: opts.ipoBand, ipoMaxBid: opts.ipoMaxBid, delayedNews: opts.delayedNews, chairmanMultiplier: opts.chairmanMultiplier, dividendBands: opts.dividendBands, ipoPaysDividend: opts.ipoPaysDividend };
    const game = playGame(config, lineup);
    const st = game.state.standings!;
    const winners = st.filter((x) => x.rank === 1);
    for (const w of winners) {
      seatWins[w.seat] += 1 / winners.length;
      byStrategy[lineup[w.seat].name].wins += 1 / winners.length;
    }
    for (const x of st) {
      byStrategy[lineup[x.seat].name].seats++;
      byStrategy[lineup[x.seat].name].worth += x.netWorth;
      worthAll += x.netWorth;
    }
    const nw = st.map((x) => x.netWorth);
    worthWin += Math.max(...nw);
    worthLast += Math.min(...nw);
    spreadSum += Math.max(...nw) - Math.min(...nw);
    spreadMax = Math.max(spreadMax, Math.max(...nw) - Math.min(...nw));
    actionsSum += game.actions.length;
    // A company that never listed (the IPO switched off) has no final price to report.
    for (const c of COMPANY_IDS) if (game.state.companies[c].listed) finals[c].push(TRACK[game.state.companies[c].priceIndex]);

    const bankruptHere = new Set<CompanyId>(), topHere = new Set<CompanyId>(), chairHere = new Set<CompanyId>();
    let lastResortHere = false;
    const listedNow = new Set<CompanyId>();
    let winnerBonus = 0;
    const maxDev = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0])) as Record<CompanyId, number>;
    // Each company's own starting point this game: its start price, or the IPO listing price.
    const startOf = Object.fromEntries(COMPANY_IDS.map((c) => [c, opts.startPrices?.[c] ?? COMPANIES[c].startPrice])) as Record<CompanyId, number>;
    for (const e of game.events) {
      switch (e.kind) {
        case "bankrupt": bankrupt[e.company].events++; bankruptHere.add(e.company); break;
        case "price": {
          if (e.to === 500) topHere.add(e.company);
          maxDev[e.company] = Math.max(maxDev[e.company], Math.abs(e.to - startOf[e.company]));
          break;
        }
        case "shortOpened": sh.opened++; break;
        case "shortClosed": if (e.how === "cover") sh.covered++; else if (e.how === "forced") sh.forced++; else sh.bankrupt++; break;
        case "debt": sh.debts++; break;
        case "lastResort": sh.lastResort++; lastResortHere = true; break;
        case "shortfall": sh.shortfalls++; break;
        case "trade": if (e.trade === "cover") sh.covered += e.prices.length; break;
        case "ipoListing": {
          listedNow.add(e.company);
          if (e.listingPrice === 500 || e.afterPop === 500) topHere.add(e.company);
          startOf[e.company] = e.listingPrice;
          ipo.games++;
          ipo.listing += e.listingPrice;
          ipo.after += e.afterPop;
          const total = e.allocated.reduce((a, b) => a + b, 0);
          ipo.allotted += total;
          if (total < 12) ipo.under++;
          ipo.dist[e.listingPrice] = (ipo.dist[e.listingPrice] ?? 0) + 1;
          const max = Math.max(...e.allocated);
          const tops = e.allocated.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0);
          if (max > 0 && tops.length === 1) {
            ipo.bigGames++;
            if (st.find((x) => x.seat === tops[0])!.rank === 1) ipo.bigWins++;
          }
          ipo.orgFinal += TRACK[game.state.companies.ORG.priceIndex];
          break;
        }
        case "dividend":
          for (const x of e.paid) {
            if (x.why === "shares") divPaid += x.amount;
            if (x.why === "chairman") {
              chairPaid += x.amount;
              if (st.find((y) => y.seat === x.player)!.rank === 1) winnerBonus += x.amount;
            }
          }
          break;
        case "roundEnd":
          roundEnds++;
          for (const c of COMPANY_IDS) if (!COMPANIES[c].ipo || listedNow.has(c)) listedRoundEnds[c]++;
          (cash[e.round] ??= { sum: 0, n: 0 });
          cash[e.round].sum += e.cash.reduce((a, b) => a + b, 0);
          cash[e.round].n += e.cash.length;
          for (const c of COMPANY_IDS) {
            const who = e.chairmen[c];
            if (who === null) continue;
            chair[c].rounds++;
            chairHere.add(c);
            const name = lineup[who].name;
            chair[c].byStrategy[name] = (chair[c].byStrategy[name] ?? 0) + 1;
          }
          break;
      }
    }
    const tops = st.filter((x) => x.rank === 1);
    winnerChairShare += winnerBonus / tops.length / Math.max(1, tops[0].netWorth);
    for (const c of COMPANY_IDS) if (!COMPANIES[c].ipo && startOf[c] === 500) topHere.add(c);
    for (const c of COMPANY_IDS) {
      swing[c] += maxDev[c];
      if (game.state.companies[c].listed) {
        listedGames[c]++;
        startSum[c] += startOf[c];
        if (TRACK[game.state.companies[c].priceIndex] < startOf[c]) belowStart[c]++;
      }
    }
    bankruptHere.forEach((c) => bankrupt[c].games++);
    topHere.forEach((c) => top[c]++);
    chairHere.forEach((c) => chair[c].games++);
    if (lastResortHere) sh.lastResortGames++;
    onProgress?.(g + 1);
  }

  const G = opts.games;
  const pct = (x: number) => Math.round((1000 * x) / G) / 10;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    options: opts,
    wins: {
      byStrategy: Object.fromEntries(
        Object.entries(byStrategy).map(([k, v]) => [k, { seats: v.seats, wins: r1(v.wins), rate: v.seats ? Math.round((1000 * v.wins) / v.seats) / 10 : 0, avgNetWorth: Math.round(v.worth / Math.max(1, v.seats)) }]),
      ),
      bySeat: seatWins.map((w, i) => ({ seat: i + 1, wins: r1(w), rate: pct(w) })),
    },
    netWorth: { avgAll: Math.round(worthAll / (G * opts.players)), avgWinner: Math.round(worthWin / G), avgLast: Math.round(worthLast / G), avgSpread: Math.round(spreadSum / G), maxSpread: spreadMax },
    companies: Object.fromEntries(
      COMPANY_IDS.map((c) => {
        const xs = [...finals[c]].sort((a, b) => a - b);
        const dist: Record<number, number> = {};
        for (const x of xs) dist[x] = (dist[x] ?? 0) + 1;
        // The IPO company's start is its average listing price; games where it never listed are left out.
        const n = Math.max(1, listedGames[c]);
        const start = Math.round(startSum[c] / n);
        return [c, { start, avgSwing: Math.round(swing[c] / G), endedBelowStartPct: Math.round((1000 * belowStart[c]) / n) / 10, avgFinal: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0, medianFinal: median(xs), finalDistribution: dist, bankruptGamesPct: pct(bankrupt[c].games), bankruptcies: bankrupt[c].events, reached500GamesPct: pct(top[c]) }];
      }),
    ) as Report["companies"],
    chairmen: Object.fromEntries(
      COMPANY_IDS.map((c) => [c, { roundsWithChairmanPct: Math.round((1000 * chair[c].rounds) / Math.max(1, listedRoundEnds[c])) / 10, gamesWithChairmanPct: pct(chair[c].games), byStrategy: chair[c].byStrategy }]),
    ) as Report["chairmen"],
    shorts: {
      openedPerGame: r1(sh.opened / G),
      coveredPerGame: r1(sh.covered / G),
      forcedPerGame: r1(sh.forced / G),
      closedByBankruptcyPerGame: r1(sh.bankrupt / G),
      debtsPerGame: r1(sh.debts / G),
      lastResortPerGame: Math.round((100 * sh.lastResort) / G) / 100,
      gamesWithLastResortPct: pct(sh.lastResortGames),
      shortDividendShortfalls: sh.shortfalls,
    },
    cashByRound: cash.map((x, round) => (x ? { round, avgCash: Math.round(x.sum / x.n) } : null)).filter((x): x is { round: number; avgCash: number } => x !== null),
    avgActionsPerGame: Math.round(actionsSum / G),
    income: { dividendsPerGame: Math.round(divPaid / G), chairmanPerGame: Math.round(chairPaid / G), chairmanShareOfWinnerPct: Math.round((1000 * winnerChairShare) / G) / 10 },
    ipo: {
      games: ipo.games,
      listingDistribution: ipo.dist,
      avgListing: Math.round(ipo.listing / Math.max(1, ipo.games)),
      avgAfterPop: Math.round(ipo.after / Math.max(1, ipo.games)),
      avgAllotted: Math.round((10 * ipo.allotted) / Math.max(1, ipo.games)) / 10,
      undersubscribedPct: Math.round((1000 * ipo.under) / Math.max(1, ipo.games)) / 10,
      biggestAllotteeWinPct: Math.round((1000 * ipo.bigWins) / Math.max(1, ipo.bigGames)) / 10,
      avgOracleFinal: Math.round(ipo.orgFinal / Math.max(1, ipo.games)),
    },
  };
}
