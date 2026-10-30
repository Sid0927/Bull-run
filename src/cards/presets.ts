/** Starting setups a host can pick and then change, and the cleaning every saved setup goes through. */
import type { Config, Role, Round, Team } from "./types.ts";
import { TEAM_COLORS } from "./types.ts";
import { LIBRARY_BY_ID, roleFrom } from "./library.ts";

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

/** The two-sided presets' goal: each side is after the same thing, so both are hunting their own Leader. */
const SIDE_GOAL = "Your side wins if, at the end, your Leader is in a group with more of your side than of the other side.";

export const PRESETS: Preset[] = [
  {
    id: "two-sides",
    name: "Two sides, a Leader each",
    blurb: "Sun and Moon, a Leader on each side, everyone else filled in evenly. Two groups and three timed rounds.",
    config: base({
      title: "Sun & Moon",
      teams: [
        { id: "sun", name: "Sun", color: "gold", fills: true, memberName: "Sun", goal: SIDE_GOAL },
        { id: "moon", name: "Moon", color: "purple", fills: true, memberName: "Moon", goal: SIDE_GOAL },
        { id: "loners", name: "Loners", color: "grey", fills: false, memberName: "Loner", goal: "" },
      ],
      roles: [roleFrom("leader", "sun"), roleFrom("leader", "moon"), roleFrom("drifter", "loners", { count: 0 })],
      oddRoleId: "drifter-loners",
      groups: true,
      rounds: [
        { minutes: 3, swap: 1 },
        { minutes: 2, swap: 1 },
        { minutes: 1, swap: 1 },
      ],
      notes: "Showing is always both ways: you both show, or nobody does.",
    }),
  },
  {
    id: "tricky",
    name: "Two sides, full of tricks",
    blurb: "Leaders and Deputies, a Mole and a Scout on each side, plus a Shadow and a Collector playing for themselves.",
    config: base({
      title: "Smoke & Mirrors",
      teams: [
        { id: "red", name: "Red", color: "red", fills: true, memberName: "Red", goal: SIDE_GOAL },
        { id: "blue", name: "Blue", color: "blue", fills: true, memberName: "Blue", goal: SIDE_GOAL },
        { id: "loners", name: "Loners", color: "grey", fills: false, memberName: "Loner", goal: "" },
      ],
      roles: [
        roleFrom("leader", "red"),
        roleFrom("leader", "blue"),
        roleFrom("deputy", "red"),
        roleFrom("deputy", "blue"),
        roleFrom("mole", "red", { showsAsTeamId: "blue" }),
        roleFrom("mole", "blue", { showsAsTeamId: "red" }),
        roleFrom("scout", "red"),
        roleFrom("scout", "blue"),
        roleFrom("shadow", "loners"),
        roleFrom("collector", "loners", { count: 0 }),
      ],
      oddRoleId: "collector-loners",
      setAside: true,
      groups: true,
      rounds: [
        { minutes: 5, swap: 2 },
        { minutes: 3, swap: 2 },
        { minutes: 2, swap: 1 },
        { minutes: 1, swap: 1 },
      ],
      notes: "One card is set aside, so a Leader may not be in play: that is what the Deputies are for.",
    }),
  },
  {
    id: "hidden-few",
    name: "A hidden few",
    blurb: "A big crew and a few Infiltrators. One of them shows as crew on a team share.",
    config: base({
      title: "Crew & Infiltrators",
      teams: [
        { id: "crew", name: "Crew", color: "teal", fills: true, memberName: "Crew", goal: "The Crew wins if, at the end, every Infiltrator is in the same group." },
        { id: "inf", name: "Infiltrators", color: "red", fills: false, memberName: "Infiltrator", goal: "The Infiltrators win if, at the end, at least one of you is in each group." },
      ],
      roles: [roleFrom("leader", "inf", { count: 2 }), roleFrom("mole", "inf", { showsAsTeamId: "crew" }), roleFrom("open-book", "crew"), roleFrom("scout", "crew")],
      rounds: [{ minutes: 5, swap: 0 }],
    }),
  },
  {
    id: "blank",
    name: "Start from scratch",
    blurb: "Two empty sides. Pick the roles you want from the list.",
    config: base({
      title: "My game",
      teams: [
        { id: "t1", name: "Team A", color: "red", fills: true, memberName: "Team A", goal: "" },
        { id: "t2", name: "Team B", color: "blue", fills: true, memberName: "Team B", goal: "" },
      ],
    }),
  },
];

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
      return { id: str(x.id, 40) || rid(), name: str(x.name, 30), color: TEAM_COLORS[color] ? color : "grey", fills: x.fills === true, memberName: str(x.memberName, 40), goal: str(x.goal, 300) };
    });
  // Only roles from the library survive, and their name, text and show rule always come from it.
  const roles: Role[] = arr(o.roles)
    .slice(0, 40)
    .flatMap((r) => {
      const x = obj(r);
      const lib = LIBRARY_BY_ID[str(x.libId, 40)];
      if (!lib) return [];
      return [{ id: str(x.id, 40) || rid(), libId: lib.id, name: lib.name, teamId: str(x.teamId, 40), count: int(x.count, 0, 60, lib.copies), description: lib.description, show: lib.show, showsAsTeamId: lib.disguise ? str(x.showsAsTeamId, 40) : "" }];
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
