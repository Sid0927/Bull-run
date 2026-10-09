import { COMPANY_IDS, TRACK, actor, apply, newGame, previewTrade, netWorth, price, card, type Action, type GameState, type GameEvent, type TradeKind } from "../src/engine/index.ts";
import { Rng } from "../src/engine/rng.ts";
import { STRATEGIES } from "../src/sim/strategies.ts";
import { viewFor, waitingOn } from "../src/shared/view.ts";
import { cardImpact, paysNow } from "../src/app/parts.tsx";
import { priceHistory, changeSinceLastRound } from "../src/app/history.ts";
import { rulesConfig } from "./rules.ts";

const strats = Object.values(STRATEGIES);
const counts: Record<string, number> = {};
const ex: Record<string, string> = {};
const bug = (k: string, msg: string) => { counts[k] = (counts[k] ?? 0) + 1; if (!ex[k]) ex[k] = msg; };
const kinds: TradeKind[] = ["buy", "sell", "short", "cover"];

for (let g = 0; g < 300; g++) {
  const rules = [1, 2, 3][g % 3];
  const np = 3 + (g % 3);
  const config = { ...rulesConfig(rules), players: Array.from({ length: np }, (_, i) => `P${i}`), rounds: [6, 9, 12][g % 3] as 6 | 9 | 12, seed: 1000 + g };
  let { state, events } = newGame(config as any);
  events = [...events];
  const rng = new Rng(g * 7 + 1);
  const ss = Array.from({ length: np }, (_, i) => strats[(g + i) % strats.length]);
  let steps = 0;
  // track "last round close" prices truth
  while (state.phase.kind !== "ended" && steps++ < 5000) {
    const s = state;
    const seat = actor(s)!;
    // waitingOn vs actor
    if (!waitingOn(s).includes(seat)) bug("waiting", JSON.stringify(s.phase));
    const v = viewFor(s, seat);
    // trade comparisons
    if (s.phase.kind === "turn" && s.phase.step === "trade" && !s.debt) {
      for (const k of kinds) for (const c of COMPANY_IDS) for (const q of [1, 2, 3]) {
        const a = { type: "trade", player: seat, kind: k, company: c, qty: q } as const;
        const pv = previewTrade(v, a);
        const legal = apply(v, a);
        const real = apply(s, a);
        if (legal.ok !== real.ok) bug("legal-mismatch", `${k} ${q} ${c}: view ${legal.ok} real ${real.ok} ${!real.ok ? real.error : ""}`);
        if (real.ok) {
          const te = real.events.find((e) => e.kind === "trade") as any;
          if (!pv.ok) bug("pv-fail-but-legal", `${k} ${q} ${c} ${pv.error}`);
          else if (pv.preview.total !== te.total || pv.preview.prices.join() !== te.prices.join()) bug("pv-total", `${k} ${q} ${c} pv ${pv.preview.prices} real ${te.prices}`);
          // own forced close / debt not mentioned in preview
          const own = real.events.filter((e) => e.kind === "shortClosed" && (e as any).how === "forced");
          if (own.length) bug("pv-misses-forced-close", `${k} ${q} ${c}: ${own.map((e) => e.text).join(" | ")}`);
          if (real.state.debt && real.state.debt.player === seat) bug("trade-causes-own-debt", `${k} ${q} ${c}: ${real.state.debt.amount} cash after trade`);
        }
      }
      // cardImpact vs actual in immediate mode
      for (const id of s.players[seat].hand) {
        const est = cardImpact(v, seat, id);
        if (s.config.delayedNews === false) {
          const r = apply(s, { type: "playNews", player: seat, card: id });
          if (r.ok) {
            const d = netWorth(r.state, seat).netWorth - netWorth(s, seat).netWorth;
            const complex = r.events.some((e) => (e.kind === "price" && e.cause === "threshold") || e.kind === "shortClosed" || e.kind === "debt" || e.kind === "ceiling");
            if (!complex && d !== est) bug("cardImpact", `card ${id} est ${est} actual ${d}`);
            if (complex && Math.sign(d) !== Math.sign(est) && est !== 0) bug("cardImpact-sign-complex", `card ${id} est ${est} actual ${d} ${r.events.map(e=>e.text).join(" | ")}`);
          }
        }
      }
    }
    // change since last round check: base should be price at last roundEnd (or opening close) etc.
    const hist = priceHistory(v, events);
    for (const c of COMPANY_IDS) {
      const ch = changeSinceLastRound(v, hist[c], c);
      if (!s.companies[c].listed) continue;
      // truth: price now minus price at end of previous round (from roundEnd events with round = s.round-1)
      if (s.round >= 2) {
        const re = [...events].reverse().find((e) => e.kind === "roundEnd" && e.round === s.round - 1) as any;
        const relisted = events.some((e) => e.kind === "relist" && e.company === c) ;
        const truth = price(s, c) - re.prices[c];
        if (re && ch !== truth && !(c === "ORG" && s.round === 4)) bug(relisted ? "chg-relisted" : "chg", `${c} r${s.round} ui ${ch} truth ${truth}`);
      }
    }
    // paysNow vs dividendPerShare semantics: verify via dividends at round end later
    let done = false;
    for (const a of ss[seat].candidates(s, seat, rng)) {
      const r = apply(s, a);
      if (!r.ok) continue;
      // dividend check
      for (const e of r.events) if (e.kind === "dividend") {
        // compare against paysNow on the state before? price may change during turn; compare at end-of-round price: use r.state if no later price event
      }
      state = r.state; events.push(...r.events); done = true; break;
    }
    if (!done) { bug("stuck", JSON.stringify(s.phase)); break; }
  }
}
for (const k of Object.keys(counts)) console.log(k, counts[k], "\n   ", ex[k]);
