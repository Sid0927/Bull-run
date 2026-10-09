/** Price history read back from the event log, for the ticker and the sparklines. */
import { COMPANIES, COMPANY_IDS, IPO_ROUND, RELIST_INDEX, TRACK, price, startPrice, type CompanyId, type GameEvent, type GameState } from "../engine/index.ts";

export interface PricePoint {
  /** The round this price closed: −1 is the starting price, 0 the close of the opening; the IPO listing sits at round 3. */
  round: number;
  price: number;
  /** Shown instead of "End of round N" for the points that are not a round end. */
  label?: string;
}

export function priceHistory(s: GameState, events: GameEvent[]): Record<CompanyId, PricePoint[]> {
  // Live prices, followed through the log, so the opening and re-listings can be snapshotted.
  const cur = Object.fromEntries(COMPANY_IDS.map((c) => [c, startPrice(s.config, c)])) as Record<CompanyId, number>;
  const h = Object.fromEntries(
    COMPANY_IDS.map((c) => [c, COMPANIES[c].ipo ? [] : [{ round: -1, price: cur[c], label: "Start" }]]),
  ) as Record<CompanyId, PricePoint[]>;
  const listed = new Set<CompanyId>(COMPANY_IDS.filter((c) => !COMPANIES[c].ipo));
  let round = 0;
  for (const e of events) {
    switch (e.kind) {
      case "price":
        cur[e.company] = e.to;
        break;
      case "relist":
        cur[e.company] = TRACK[RELIST_INDEX];
        // Re-listed before this round's trading: measure the round from ₹60, not from ₹0.
        h[e.company].push({ round: round - 1, price: cur[e.company], label: "Re-listed" });
        break;
      case "startPlayer":
        // The opening is round 0: its close (after the orders and the opening news) is the base
        // round 1 is measured from.
        for (const c of listed) h[c].push({ round: 0, price: cur[c], label: "After the opening" });
        break;
      case "roundStart":
        round = e.round;
        break;
      case "ipoListing":
        listed.add(e.company);
        cur[e.company] = e.listingPrice;
        h[e.company] = [{ round: IPO_ROUND - 1, price: e.listingPrice, label: "Listing" }];
        break;
      case "roundEnd":
        for (const c of listed) h[c].push({ round: e.round, price: e.prices[c] });
        break;
    }
  }
  return h;
}

/**
 * Change over the round in play, measured from the last price recorded before it: the end of the
 * previous round, the close of the opening, a listing or a re-listing. In the opening itself, the
 * change since the starting prices. Once the game is over, the final round's change.
 */
export function changeSinceLastRound(s: GameState, hist: PricePoint[], c: CompanyId): number | null {
  if (!s.companies[c].listed) return null;
  const base = s.round === 0 ? hist[0] : [...hist].reverse().find((p) => p.round < s.round);
  return base ? price(s, c) - base.price : null;
}
