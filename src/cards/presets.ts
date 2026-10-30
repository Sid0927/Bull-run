/** Starting setups a host can pick and then change, and the cleaning every saved setup goes through. */
import type { Config, Role, Round, ShowRule, Team } from "./types.ts";
import { TEAM_COLORS } from "./types.ts";

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  config: Config;
}

const base = (over: Partial<Config>): Config => ({
  title: "Game night",
  teams: [],
  roles: [],
  oddRoleId: "",
  setAside: false,
  groups: false,
  groupNames: ["Room 1", "Room 2"],
  rounds: [],
  notes: "",
  ...over,
});

export const PRESETS: Preset[] = [
  {
    id: "two-teams",
    name: "Two teams, one key card each",
    blurb: "Sun and Moon, a leader on each side, everyone else filled in evenly. Two groups and three timed rounds.",
    config: base({
      title: "Sun & Moon",
      teams: [
        { id: "sun", name: "Sun", color: "gold", fills: true, memberName: "Sun" },
        { id: "moon", name: "Moon", color: "purple", fills: true, memberName: "Moon" },
        { id: "drift", name: "Drifter", color: "grey", fills: false, memberName: "Drifter" },
      ],
      roles: [
        { id: "sun-lead", name: "Sun Keeper", teamId: "sun", count: 1, description: "Your team's key card.", show: "any", showsAsTeamId: "" },
        { id: "moon-lead", name: "Moon Keeper", teamId: "moon", count: 1, description: "Your team's key card.", show: "any", showsAsTeamId: "" },
        { id: "drifter", name: "Drifter", teamId: "drift", count: 0, description: "On nobody's side. Write your own goal in the house rules.", show: "any", showsAsTeamId: "" },
      ],
      oddRoleId: "drifter",
      groups: true,
      rounds: [
        { minutes: 3, swap: 1 },
        { minutes: 2, swap: 1 },
        { minutes: 1, swap: 1 },
      ],
      notes: "Agree your goals before you deal. Showing a card is always both ways: you both show, or nobody does.",
    }),
  },
  {
    id: "hidden-team",
    name: "Hidden minority",
    blurb: "A large crew and a few infiltrators. One infiltrator shows as crew on a team share.",
    config: base({
      title: "Crew & Infiltrators",
      teams: [
        { id: "crew", name: "Crew", color: "teal", fills: true, memberName: "Crew" },
        { id: "inf", name: "Infiltrators", color: "red", fills: false, memberName: "Infiltrator" },
      ],
      roles: [
        { id: "inf-a", name: "Infiltrator", teamId: "inf", count: 2, description: "You know who else is with you once you share.", show: "any", showsAsTeamId: "" },
        { id: "inf-mask", name: "Masked Infiltrator", teamId: "inf", count: 1, description: "A team share shows you as Crew.", show: "any", showsAsTeamId: "crew" },
        { id: "captain", name: "Captain", teamId: "crew", count: 1, description: "May only show the full card.", show: "full", showsAsTeamId: "" },
      ],
      rounds: [{ minutes: 5, swap: 0 }],
      notes: "",
    }),
  },
  {
    id: "blank",
    name: "Start from scratch",
    blurb: "Two empty teams. Add your own roles.",
    config: base({
      title: "My game",
      teams: [
        { id: "t1", name: "Team A", color: "red", fills: true, memberName: "Team A" },
        { id: "t2", name: "Team B", color: "blue", fills: true, memberName: "Team B" },
      ],
    }),
  },
];

const SHOW: ShowRule[] = ["any", "team", "full", "none"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};
const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Whatever arrives (a request body, a pasted setup, an old saved one) comes out as a well-formed Config. */
export function cleanConfig(input: unknown): Config {
  const o = obj(input);
  const teams: Team[] = arr(o.teams)
    .slice(0, 8)
    .map((t) => {
      const x = obj(t);
      const color = str(x.color, 20);
      return { id: str(x.id, 40) || rid(), name: str(x.name, 30), color: TEAM_COLORS[color] ? color : "grey", fills: x.fills === true, memberName: str(x.memberName, 40) };
    });
  const roles: Role[] = arr(o.roles)
    .slice(0, 40)
    .map((r) => {
      const x = obj(r);
      const show = SHOW.includes(x.show as ShowRule) ? (x.show as ShowRule) : "any";
      return { id: str(x.id, 40) || rid(), name: str(x.name, 40), teamId: str(x.teamId, 40), count: int(x.count, 0, 60, 1), description: str(x.description, 400), show, showsAsTeamId: str(x.showsAsTeamId, 40) };
    });
  const rounds: Round[] = arr(o.rounds)
    .slice(0, 12)
    .map((r) => {
      const x = obj(r);
      return { minutes: num(x.minutes, 0.25, 60, 3), swap: int(x.swap, 0, 30, 0) };
    });
  const g = arr(o.groupNames);
  return {
    title: str(o.title, 40),
    teams,
    roles,
    oddRoleId: str(o.oddRoleId, 40),
    setAside: o.setAside === true,
    groups: o.groups === true,
    groupNames: [str(g[0], 24) || "Room 1", str(g[1], 24) || "Room 2"],
    rounds,
    notes: str(o.notes, 2000),
  };
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}
