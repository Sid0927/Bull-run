/**
 * How long a computer player "thinks" before each move, so a game against it feels like one
 * against a person: a few seconds over a trade, a little less over a draw, longer over a sealed
 * order. Varied a little each time, because a bot that answers on the beat looks like a bot.
 */
import type { GameState } from "../engine/index.ts";

export function botThinkMs(s: GameState, random: () => number = Math.random): number {
  const between = (lo: number, hi: number) => Math.round(lo + (hi - lo) * random());
  if (s.debt) return between(2500, 4000);
  const ph = s.phase;
  // Sealed orders are written at the same time: once one is in, the rest follow quickly.
  if (ph.kind === "opening" || ph.kind === "ipo") {
    const done = (ph.kind === "opening" ? ph.submissions : ph.bids).filter((x) => x !== null).length;
    return done ? between(1200, 2500) : between(5000, 9000);
  }
  if (ph.kind === "openingDraw" || (ph.kind === "turn" && ph.step === "draw")) return between(2500, 4500);
  // The first move of a turn takes longest: reading the board.
  if (ph.kind === "turn") return ph.actionsUsed === 0 ? between(4500, 7500) : between(3000, 5000);
  return 2000;
}
