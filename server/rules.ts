/**
 * Rule sets. A game keeps the rules it started under: it is stored as its seed and its moves,
 * and replaying those moves under different rules could make them illegal or change the result.
 */
import type { GameConfig } from "../src/engine/index.ts";

/** The rules new games are created under. */
export const CURRENT_RULES = 3;

/**
 * 1: news applies at once, ₹1,200 each, dividends ₹10/20/30 from ₹120/225/400 (before 9 Oct 2026).
 * 2: the final rules: news one lap later, ₹1,000 each, dividends ₹10/20/30/40 from ₹50/110/225/400.
 * 3: as 2, and two players holding 6 each both get a 2× co-chairman bonus (it used to be nobody).
 */
export function rulesConfig(version: number): Partial<GameConfig> {
  if (version === 1)
    return {
      delayedNews: false,
      startingCash: 1200,
      dividendBands: [
        { from: 400, pays: 30 },
        { from: 225, pays: 20 },
        { from: 120, pays: 10 },
      ],
      coChairmanMultiplier: 0,
    };
  if (version === 2) return { coChairmanMultiplier: 0 };
  return {};
}
