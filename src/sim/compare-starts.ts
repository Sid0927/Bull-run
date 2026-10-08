/** Compares starting-price layouts: npm run sim:starts */
import { runBatch } from "./run.ts";
import { COMPANY_IDS } from "../engine/index.ts";
const layouts: Record<string, any> = {
  current: {},
  A_flip: { SUN: 150, INFY: 120, ONGC: 100, DLF: 100, HDFC: 80, HUL: 60 },
  B_volHigh_safe120: { SUN: 150, INFY: 150, ONGC: 120, DLF: 120, HUL: 120, HDFC: 120 },
  C_volHigh_safe100: { SUN: 150, INFY: 150, ONGC: 120, DLF: 120, HUL: 100, HDFC: 100 },
  D_tiered: { SUN: 140, INFY: 140, ONGC: 110, DLF: 110, HUL: 90, HDFC: 90 },
  E_tiered_low: { SUN: 120, INFY: 120, ONGC: 100, DLF: 100, HUL: 80, HDFC: 80 },
};
for (const players of [4, 5]) for (const [name, sp] of Object.entries(layouts)) {
  const r = runBatch({ games: 1000, players, rounds: players === 4 ? 9 : 12, strategies: ["random", "favour", "dividend"], seed: 11, startPrices: sp });
  const row = COMPANY_IDS.map((c) => { const x = r.companies[c]; return `${c} ${x.start}→${x.medianFinal} sw${x.avgSwing} bk${x.bankruptGamesPct}% top${x.reached500GamesPct}% ch${r.chairmen[c].gamesWithChairmanPct}%`; });
  console.log(`\n[${players}p] ${name}  fav ${r.wins.byStrategy.favour.rate}% div ${r.wins.byStrategy.dividend.rate}% rnd ${r.wins.byStrategy.random.rate}% · spread ₹${r.netWorth.avgSpread} · winner ₹${r.netWorth.avgWinner} · seats ${r.wins.bySeat.map(s=>s.rate).join("/")} · forced ${r.shorts.forcedPerGame}/g`);
  console.log("  " + row.join("\n  "));
}
