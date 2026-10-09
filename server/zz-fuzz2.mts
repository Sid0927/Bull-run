import { COMPANY_IDS, TRACK, actor, apply, newGame, previewTrade, netWorth, price, isLive, type GameState } from "../src/engine/index.ts";
import { Rng } from "../src/engine/rng.ts";
import { STRATEGIES } from "../src/sim/strategies.ts";
import { viewFor } from "../src/shared/view.ts";
import { rulesConfig } from "./rules.ts";
const strats = Object.values(STRATEGIES);
const counts: Record<string, number> = {}; const ex: Record<string, string> = {};
const bug = (k: string, m: string) => { counts[k] = (counts[k] ?? 0) + 1; if (!ex[k]) ex[k] = m; };
for (let g = 0; g < 400; g++) {
  const np = 3 + (g % 3);
  const config = { ...rulesConfig([1,2,3][g%3]), players: Array.from({ length: np }, (_, i) => `P${i}`), rounds: [6, 9, 12][(g>>1) % 3] as any, seed: 5000 + g };
  let { state } = newGame(config as any);
  const rng = new Rng(g + 3);
  const ss = Array.from({ length: np }, (_, i) => strats[(g + i) % strats.length]);
  while (state.phase.kind !== "ended") {
    const s = state; const seat = actor(s)!;
    if (s.debt) {
      const p = s.players[s.debt.player];
      const btns = COMPANY_IDS.filter((c) => p.shares[c] > 0 && !s.companies[c].bankrupt);
      if (!btns.length) bug("forced-no-button", JSON.stringify(s.debt));
      for (const c of btns) { const r = apply(s, { type: "forcedSell", player: seat, company: c, qty: 1 }); if (!r.ok) bug("forced-btn-illegal", r.error); }
      if (s.phase.kind === "turn" && s.phase.player !== s.debt.player) bug("debt-nonactive", `${s.phase.kind} player ${s.phase.player} debtor ${s.debt.player} step ${s.phase.step}`);
      if (s.phase.kind !== "turn") bug("debt-phase-"+s.phase.kind, "");
    }
    if (s.phase.kind === "turn" && s.phase.step === "draw" || s.phase.kind === "openingDraw") {
      if (s.deck.length === 0 && s.discard.length === 0) bug("draw-empty", "");
      if (s.deck.length === 0) bug("deck0", `discard ${s.discard.length}`);
      if (s.market.some((x) => x === null)) bug("market-null", "");
    }
    if (s.phase.kind === "turn" && s.phase.step === "trade" && !s.debt) {
      for (const c of COMPANY_IDS) for (const k of ["buy","cover","sell","short"] as const) for (const q of [1,2,3]) {
        const a = { type: "trade", player: seat, kind: k, company: c, qty: q } as const;
        const r = apply(s, a); if (!r.ok) continue;
        for (const e of r.events) if (e.kind === "shortClosed" && e.how === "forced") bug(e.player === seat ? "fc-own" : "fc-other", `${k} ${q} ${c}: ${e.text}`);
        if (r.state.debt) bug(r.state.debt.player === seat ? "debt-own" : "debt-other", `${k} ${q} ${c}`);
      }
      if (s.players[seat].hand.length === 0) bug("hand-empty", "");
    }
    if (s.phase.kind === "ipo" && seat !== null) {
      // can player afford anything?
    }
    let done = false;
    for (const a of ss[seat].candidates(s, seat, rng)) { const r = apply(s, a); if (r.ok) { state = r.state; done = true; break; } }
    if (!done) { bug("stuck", ""); break; }
  }
}
for (const k of Object.keys(counts)) console.log(k, counts[k], "\n   ", ex[k]);
