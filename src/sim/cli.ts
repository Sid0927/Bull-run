/**
 * npm run sim -- --games 1000 --players 4 --rounds 9 --strategies random,favour,dividend --seed 1 [--json report.json]
 */
import { writeFileSync } from "node:fs";
import { COMPANIES, COMPANY_IDS, GAME_LENGTHS, type CompanyId, type GameLength } from "../engine/index.ts";
import { runBatch, type Report } from "./run.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const opts = {
  games: Number(arg("games", "1000")),
  players: Number(arg("players", "4")),
  rounds: Number(arg("rounds", "9")) as GameLength,
  strategies: arg("strategies", "random,favour,dividend").split(","),
  seed: Number(arg("seed", "1")),
  startPrices: parseStarts(arg("start", "")),
  startingCash: arg("cash", "") ? Number(arg("cash", "")) : undefined,
  driftAtOrBelow: arg("drift", "") ? Number(arg("drift", "")) : undefined,
  driftMode: arg("drift-mode", "down") as "down" | "toStart",
  ipo: !process.argv.includes("--no-ipo"),
  delayedNews: process.argv.includes("--delayed-news"),
  chairmanMultiplier: arg("chairman", "") ? Number(arg("chairman", "")) : undefined,
  // --dividends 400:40,225:30,110:20,50:10  (price it starts at : rupees a share)
  dividendBands: arg("dividends", "") ? arg("dividends", "").split(",").map((x) => ({ from: Number(x.split(":")[0]), pays: Number(x.split(":")[1]) })) : undefined,
};

/** --start SUN=150,INFY=120 */
function parseStarts(s: string): Partial<Record<CompanyId, number>> | undefined {
  if (!s) return undefined;
  const out: Partial<Record<CompanyId, number>> = {};
  for (const part of s.split(",")) {
    const [k, v] = part.split("=");
    if (!COMPANY_IDS.includes(k as CompanyId)) throw new Error(`--start: no company ${k}. Use ${COMPANY_IDS.join(", ")}`);
    out[k as CompanyId] = Number(v);
  }
  return out;
}
if (!(opts.players >= 3 && opts.players <= 5)) throw new Error("--players must be 3 to 5");
if (!GAME_LENGTHS.includes(opts.rounds)) throw new Error("--rounds must be 6, 9 or 12");

const t0 = Date.now();
const report = runBatch(opts, (n) => {
  if (process.stderr.isTTY && n % 50 === 0) process.stderr.write(`\r${n}/${opts.games} games`);
});
if (process.stderr.isTTY) process.stderr.write("\r");
print(report, Date.now() - t0);
const json = arg("json", "");
if (json) writeFileSync(json, JSON.stringify(report, null, 2));

function print(r: Report, ms: number) {
  const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const line = (cells: (string | number)[], w: number[]) => cells.map((c, i) => String(c).padStart(w[i])).join("  ");
  console.log(`\nBull Run simulation — ${r.options.games} games, ${r.options.players} players, ${r.options.rounds} rounds, seed ${r.options.seed} (${(ms / 1000).toFixed(1)}s, 0 illegal states)\n`);

  console.log("Win rate by strategy (shared wins split)");
  console.log(line(["strategy", "seats", "wins", "win %", "avg worth"], [10, 7, 8, 7, 11]));
  for (const [k, v] of Object.entries(r.wins.byStrategy)) console.log(line([k, v.seats, v.wins, v.rate, rs(v.avgNetWorth)], [10, 7, 8, 7, 11]));
  console.log(`  (an even table would be ${(100 / r.options.players).toFixed(1)}% each)`);

  console.log("\nWin rate by seat");
  console.log("  " + r.wins.bySeat.map((s) => `seat ${s.seat}: ${s.rate}%`).join("   "));

  console.log("\nFinal net worth");
  console.log(`  average ${rs(r.netWorth.avgAll)} · winner ${rs(r.netWorth.avgWinner)} · last ${rs(r.netWorth.avgLast)} · spread avg ${rs(r.netWorth.avgSpread)}, max ${rs(r.netWorth.maxSpread)}`);

  console.log("\nCompanies");
  console.log(line(["company", "start", "avg end", "median", "max swing", "below start %", "bankrupt %", "failures", "hit ₹500 %", "chair rnds %", "chair games %"], [11, 6, 8, 7, 10, 14, 11, 9, 11, 13, 14]));
  for (const c of COMPANY_IDS) {
    const x = r.companies[c], ch = r.chairmen[c];
    console.log(line([COMPANIES[c].short, x.start, x.avgFinal, x.medianFinal, x.avgSwing, x.endedBelowStartPct, x.bankruptGamesPct, x.bankruptcies, x.reached500GamesPct, ch.roundsWithChairmanPct, ch.gamesWithChairmanPct], [11, 6, 8, 7, 10, 14, 11, 9, 11, 13, 14]));
  }
  console.log("\nChairman round-ends held, by strategy");
  for (const c of COMPANY_IDS) {
    const b = Object.entries(r.chairmen[c].byStrategy).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  ${COMPANIES[c].short.padEnd(10)} ${b || "never"}`);
  }

  console.log("\nFinal price distribution (price: games)");
  for (const c of COMPANY_IDS) {
    const d = Object.entries(r.companies[c].finalDistribution).map(([p, n]) => `${p}:${n}`).join(" ");
    console.log(`  ${COMPANIES[c].short.padEnd(10)} ${d}`);
  }

  const s = r.shorts;
  console.log("\nShorts per game");
  console.log(`  opened ${s.openedPerGame} · covered ${s.coveredPerGame} · forced closed ${s.forcedPerGame} · closed by bankruptcy ${s.closedByBankruptcyPerGame}`);
  console.log(`  forced sales needed ${s.debtsPerGame} · last resort ${s.lastResortPerGame} (in ${s.gamesWithLastResortPct}% of games) · short-dividend shortfalls ${s.shortDividendShortfalls} in total`);

  console.log("\nAverage cash per player at the end of each round");
  console.log("  " + r.cashByRound.map((x) => `R${x.round} ${rs(x.avgCash)}`).join("  "));
  if (r.ipo.games) {
    const ip = r.ipo;
    console.log("\nOracle Group IPO");
    console.log(`  lists at ${rs(ip.avgListing)} on average (${Object.entries(ip.listingDistribution).map(([p, n]) => `₹${p}: ${n}`).join(", ")}), ${rs(ip.avgAfterPop)} after the first-day pop`);
    console.log(`  ${ip.avgAllotted} of 12 shares allotted · undersubscribed in ${ip.undersubscribedPct}% · biggest allottee wins ${ip.biggestAllotteeWinPct}% · ends at ${rs(ip.avgOracleFinal)} on average`);
  }
  console.log(`\n${r.avgActionsPerGame} actions per game on average.`);
}
