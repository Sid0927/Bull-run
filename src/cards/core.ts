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
  // Lovers only ever come as one on Blue and one on Red (see setLovers); a stray one is dropped.
  const lovers = c.roles.some((r) => r.libId === LOVER && r.teamId === BLUE) && c.roles.some((r) => r.libId === LOVER && r.teamId === RED);
  const extras = c.roles.filter((r) => !isCoreRole(r) && ids.has(r.teamId) && r.libId !== LOVER).map((r) => ({ ...r, showsAsTeamId: r.showsAsTeamId && ids.has(r.showsAsTeamId) ? r.showsAsTeamId : r.showsAsTeamId ? (r.teamId === BLUE ? RED : BLUE) : "" }));
  const pair = lovers ? [roleFrom("lover", BLUE, { id: `lover-${BLUE}` }), roleFrom("lover", RED, { id: `lover-${RED}` })] : [];
  const roles = [roleFrom(PRESIDENT, BLUE, { id: PRESIDENT_ROLE }), roleFrom(BOMBER, RED, { id: BOMBER_ROLE }), ...pair, ...extras];
  return {
    ...c,
    teams,
    roles,
    oddRoleId: roles.some((r) => r.id === c.oddRoleId && !isCoreRole(r)) ? c.oddRoleId : "",
    groups: true,
  };
}

/** The option of one Spy on each side: on Blue it shows as Red, on Red it shows as Blue. */
export const SPY = "spy";
const SPY_ON = { [BLUE]: RED, [RED]: BLUE } as const;

/** Whether the setup has exactly the one-Spy-each option on: a Spy on Blue and a Spy on Red. */
export function hasSpyEach(c: Config): boolean {
  return ([BLUE, RED] as const).every((side) => c.roles.some((r) => r.libId === SPY && r.teamId === side && r.count === 1 && r.showsAsTeamId === SPY_ON[side]));
}

/** Turns the option on (one Spy each side, showing as the other) or off (no Spies on Blue or Red). */
export function setSpyEach(c: Config, on: boolean): Config {
  const others = c.roles.filter((r) => !(r.libId === SPY && (r.teamId === BLUE || r.teamId === RED)));
  if (!on) return { ...c, roles: others };
  const spies = ([BLUE, RED] as const).map((side) => roleFrom(SPY, side, { id: `${SPY}-${side}`, showsAsTeamId: SPY_ON[side] }));
  // After the President and the Bomber, so the key cards stay at the top of the list.
  const [core, rest] = [others.filter(isCoreRole), others.filter((r) => !isCoreRole(r))];
  return { ...c, roles: [...core, ...spies, ...rest] };
}

/** The Lovers: one on Blue and one on Red, who are told each other's names. Always a pair. */
export const LOVER = "lover";
export const LOVER_ROLES = [`${LOVER}-${BLUE}`, `${LOVER}-${RED}`] as const;

export function hasLovers(c: Config): boolean {
  return ([BLUE, RED] as const).every((side) => c.roles.some((r) => r.libId === LOVER && r.teamId === side && r.count === 1));
}

/** Turns the Lovers on (one each side) or off. Any other Lover is dropped: they only come as a pair. */
export function setLovers(c: Config, on: boolean): Config {
  const others = c.roles.filter((r) => r.libId !== LOVER);
  if (!on) return { ...c, roles: others };
  const lovers = ([BLUE, RED] as const).map((side) => roleFrom(LOVER, side, { id: `${LOVER}-${side}` }));
  const [core, rest] = [others.filter(isCoreRole), others.filter((r) => !isCoreRole(r))];
  return { ...c, roles: [...core, ...lovers, ...rest] };
}

/** Cards that must never be the one set aside: the game turns on them, or (a Lover) on its pair. */
export const NEVER_SET_ASIDE = new Set<string>([PRESIDENT_ROLE, BOMBER_ROLE, ...LOVER_ROLES]);
