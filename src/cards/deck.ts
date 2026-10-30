/**
 * Building and checking a deck. Pure: the shuffle takes its random source as an argument, so
 * the tests can pin it and the server passes crypto randomness.
 */
import type { Card, Config, Role, Team } from "./types.ts";
import { MAX_PLAYERS, TEAM_COLORS } from "./types.ts";
import { LIBRARY_BY_ID } from "./library.ts";

export type Random = () => number;

const MEMBER = "member:";

function cardOf(role: Role): Card {
  return { roleId: role.id, name: role.name, teamId: role.teamId, description: role.description, show: role.show, showsAsTeamId: role.showsAsTeamId };
}

function memberCard(team: Team): Card {
  return { roleId: MEMBER + team.id, name: team.memberName || `${team.name} member`, teamId: team.id, description: "", show: "any", showsAsTeamId: "" };
}

/** Problems with the setup itself, whatever the player count. Empty when it is usable. */
export function configProblems(config: Config): string[] {
  const out: string[] = [];
  const teamIds = new Set(config.teams.map((t) => t.id));
  if (config.teams.length === 0) out.push("Add at least one team.");
  for (const t of config.teams) {
    if (!t.name.trim()) out.push("Every team needs a name.");
    if (!TEAM_COLORS[t.color]) out.push(`${t.name || "A team"} has no colour.`);
  }
  for (const r of config.roles) {
    if (!r.name.trim()) out.push("Every role needs a name.");
    if (!teamIds.has(r.teamId)) out.push(`${r.name || "A role"} is on a team that no longer exists.`);
    if (r.showsAsTeamId && !teamIds.has(r.showsAsTeamId)) out.push(`${r.name || "A role"} shows as a team that no longer exists.`);
    if (!Number.isInteger(r.count) || r.count < 0) out.push(`${r.name || "A role"} needs a whole number of copies.`);
    if (LIBRARY_BY_ID[r.libId]?.disguise && !r.showsAsTeamId) out.push(`${r.name} needs a team to show as. Pick one, or add a second team.`);
  }
  if (config.oddRoleId && !config.roles.some((r) => r.id === config.oddRoleId)) out.push("The odd-player role no longer exists.");
  if (config.rounds.some((r) => !(r.minutes > 0))) out.push("Every round needs a length.");
  return [...new Set(out)];
}

/**
 * The cards for this many players, before shuffling: every role at its count, then plain cards
 * for the filling teams, each going to whichever filling team is smallest so far. When one card
 * is left and the filling teams are level, the odd-player role takes it instead.
 */
export function buildDeck(config: Config, players: number): { cards: Card[] } | { error: string } {
  const problems = configProblems(config);
  if (problems.length) return { error: problems[0] };
  if (players < 2) return { error: "At least two players are needed." };
  if (players > MAX_PLAYERS) return { error: `At most ${MAX_PLAYERS} players.` };
  const size = players + (config.setAside ? 1 : 0);
  const cards: Card[] = [];
  for (const role of config.roles) for (let i = 0; i < role.count; i++) cards.push(cardOf(role));
  if (cards.length > size) {
    return { error: `The roles add up to ${cards.length} cards, but there are ${size} to deal${config.setAside ? " (one set aside)" : ""}. Take some roles out or wait for more players.` };
  }
  const fillers = config.teams.filter((t) => t.fills);
  const odd = config.roles.find((r) => r.id === config.oddRoleId);
  const sizeOf = (teamId: string) => cards.filter((c) => c.teamId === teamId).length;
  while (cards.length < size) {
    if (fillers.length === 0) {
      return { error: `${size - cards.length} more card${size - cards.length === 1 ? " is" : "s are"} needed. Tick "fills the deck" on a team or add roles.` };
    }
    const counts = fillers.map((t) => sizeOf(t.id));
    const least = Math.min(...counts);
    const level = counts.every((c) => c === least);
    if (odd && level && fillers.length > 1 && size - cards.length === 1) {
      cards.push(cardOf(odd));
      continue;
    }
    cards.push(memberCard(fillers[counts.indexOf(least)]));
  }
  return { cards };
}

export function shuffle<T>(items: T[], random: Random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Group 0 or 1 for each of `n` players, as even as it can be, in random order. */
export function splitGroups(n: number, random: Random): (0 | 1)[] {
  const groups: (0 | 1)[] = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0 : 1));
  return shuffle(groups, random);
}

/** A short line saying how the deck comes out for this many players. */
export function deckSummary(config: Config, players: number): string {
  const built = buildDeck(config, players);
  if ("error" in built) return built.error;
  const byTeam = config.teams
    .map((t) => `${built.cards.filter((c) => c.teamId === t.id).length} ${t.name}`)
    .filter((s) => !s.startsWith("0 "));
  return `${players} players: ${byTeam.join(", ")}${config.setAside ? " (one card set aside)" : ""}.`;
}
