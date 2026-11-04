/**
 * Who won, from the revealed cards and the host's answers about where people ended up. Pure, so it
 * can be tested and every phone works it out the same way.
 *
 * Red wins if the President and the Bomber ended in the same room; Blue wins if not. A Spy wins with
 * its real side (the colour it showed doesn't matter). The Gambler wins if its bet was the winning
 * side. The Lovers win if they ended in the same room. Other loners (the Drifter, the Shadow) play
 * for goals the app can't check, so they are listed to check for themselves.
 */
import { BLUE, LOVER_ROLES, RED } from "./core.ts";
import type { Card, Config, Outcome } from "./types.ts";

export interface Seat {
  name: string;
  card?: Card;
  bet?: string | null;
}

export interface Result {
  /** The winning side, or null until the host has said where the President and Bomber ended. */
  side: typeof BLUE | typeof RED | null;
  /** Everyone on the winning side (Spies by their real side). */
  sideWinners: string[];
  gamblers: { name: string; bet: string | null; won: boolean | null }[];
  /** The Lovers, and whether they won (null until the host has answered). */
  lovers: { names: string[]; won: boolean | null } | null;
  /** Loners whose goals the app can't check: they say for themselves. */
  checkYourself: { name: string; role: string }[];
}

export function result(seats: Seat[], config: Config, outcome: Outcome | null): Result {
  const libOf = (c?: Card) => (c ? config.roles.find((r) => r.id === c.roleId)?.libId : undefined);
  const side = outcome?.sameRoom === true ? RED : outcome?.sameRoom === false ? BLUE : null;
  const lovers = seats.filter((s) => s.card && (LOVER_ROLES as readonly string[]).includes(s.card.roleId));
  return {
    side,
    sideWinners: side ? seats.filter((s) => s.card?.teamId === side).map((s) => s.name) : [],
    gamblers: seats
      .filter((s) => libOf(s.card) === "gambler")
      .map((s) => ({ name: s.name, bet: s.bet ?? null, won: side === null ? null : s.bet === side })),
    lovers: lovers.length === 2 ? { names: lovers.map((s) => s.name), won: outcome?.loversTogether ?? null } : null,
    checkYourself: seats
      .filter((s) => s.card && !(s.card.teamId === BLUE || s.card.teamId === RED) && libOf(s.card) !== "gambler")
      .map((s) => ({ name: s.name, role: s.card!.name })),
  };
}
