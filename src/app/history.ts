/** Price history read back from the event log, for the ticker and the sparklines. */
import { COMPANIES, COMPANY_IDS, IPO_ROUND, price, startPrice, type CompanyId, type GameEvent, type GameState } from "../engine/index.ts";

export interface PricePoint {
  round: number; // 0 = the start of the game; the IPO company starts at its listing, just before round 4
  price: number;
}

export function priceHistory(s: GameState, events: GameEvent[]): Record<CompanyId, PricePoint[]> {
  const h = Object.fromEntries(COMPANY_IDS.map((c) => [c, COMPANIES[c].ipo ? [] : [{ round: 0, price: startPrice(s.config, c) }]])) as Record<CompanyId, PricePoint[]>;
  const listed = new Set<CompanyId>(COMPANY_IDS.filter((c) => !COMPANIES[c].ipo));
  for (const e of events) {
    if (e.kind === "ipoListing") {
      listed.add(e.company);
      h[e.company] = [{ round: IPO_ROUND - 1, price: e.listingPrice }];
    } else if (e.kind === "roundEnd") {
      for (const c of COMPANY_IDS) if (listed.has(c)) h[c].push({ round: e.round, price: e.prices[c] });
    }
  }
  return h;
}

/**
 * Change over the round in play: against the end of the previous round (or the start, or the
 * listing). Once the game is over, the final round's change.
 */
export function changeSinceLastRound(s: GameState, hist: PricePoint[], c: CompanyId): number | null {
  if (!s.companies[c].listed) return null;
  const base = [...hist].reverse().find((p) => p.round < s.round);
  return base ? price(s, c) - base.price : null;
}
