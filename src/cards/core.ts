/**
 * What every Undercover game is built on: two sides, Blue and Red, a President on Blue and a
 * Bomber on Red, and two rooms. Blue wins if, when the last round ends, the President is not in
 * the same room as the Bomber; Red wins if the Bomber is. Everything else (the other roles, the
 * rounds, the house rules) is the host's to choose, but this part is in every game, so every
 * setup is put through `withCore` and nothing a host does can take it out.
 */
import type { Config, Role, Team } from "./types.ts";
import { roleFrom } from "./library.ts";

export const BLUE = "blue";
export const RED = "red";
export const PRESIDENT = "president";
export const BOMBER = "bomber";
/** The role ids of the two key cards in every setup. */
export const PRESIDENT_ROLE = `${PRESIDENT}-${BLUE}`;
export const BOMBER_ROLE = `${BOMBER}-${RED}`;

export const BLUE_GOAL = "Blue wins if, when the last round ends, the President is not in the same room as the Bomber.";
export const RED_GOAL = "Red wins if, when the last round ends, the Bomber is in the same room as the President.";

/** The two sides, as they are in every game. */
export function coreTeams(): Team[] {
  return [
    { id: BLUE, name: "Blue", color: "blue", fills: true, memberName: "Blue", goal: BLUE_GOAL },
    { id: RED, name: "Red", color: "red", fills: true, memberName: "Red", goal: RED_GOAL },
  ];
}

export const isCoreTeam = (id: string) => id === BLUE || id === RED;
export const isCoreRole = (r: Pick<Role, "libId">) => r.libId === PRESIDENT || r.libId === BOMBER;

/**
 * The setup with the core put back in place: Blue and Red first, exactly as defined; any other
 * side dropped (its goal would compete with theirs), loners kept; one President on Blue and one
 * Bomber on Red; two rooms. Roles on a dropped side go with it.
 */
export function withCore(c: Config): Config {
  const loners = c.teams.filter((t) => !t.fills && !isCoreTeam(t.id)).map((t) => ({ ...t, goal: "" }));
  const teams = [...coreTeams(), ...loners];
  const ids = new Set(teams.map((t) => t.id));
  const extras = c.roles.filter((r) => !isCoreRole(r) && ids.has(r.teamId)).map((r) => ({ ...r, showsAsTeamId: r.showsAsTeamId && ids.has(r.showsAsTeamId) ? r.showsAsTeamId : r.showsAsTeamId ? (r.teamId === BLUE ? RED : BLUE) : "" }));
  const roles = [roleFrom(PRESIDENT, BLUE, { id: PRESIDENT_ROLE }), roleFrom(BOMBER, RED, { id: BOMBER_ROLE }), ...extras];
  return {
    ...c,
    teams,
    roles,
    oddRoleId: roles.some((r) => r.id === c.oddRoleId && !isCoreRole(r)) ? c.oddRoleId : "",
    groups: true,
  };
}
