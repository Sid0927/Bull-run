/** Starting setups a host can pick and then change, and the cleaning every saved setup goes through. */
import type { Config, Role, Round, Team } from "./types.ts";
import { TEAM_COLORS } from "./types.ts";
import { LIBRARY_BY_ID, roleFrom } from "./library.ts";
import { withCore } from "./core.ts";

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

/** Every game: Blue with the President, Red with the Bomber, two rooms (see core.ts). */
const core = (over: Partial<Config>): Config => withCore(base(over));
const LONERS: Team = { id: "loners", name: "Loners", color: "grey", fills: false, memberName: "Loner", goal: "" };
const ROUNDS: Round[] = [
  { minutes: 3, swap: 1 },
  { minutes: 2, swap: 1 },
  { minutes: 1, swap: 1 },
];
const END_RULE = "When the last round ends, the President and the Bomber show their cards. Same room: Red wins. Different rooms: Blue wins.";

export const PRESETS: Preset[] = [
  {
    id: "president-bomber",
    name: "President & Bomber",
    blurb: "Blue has the President, Red has the Bomber, everyone else is split evenly. Two rooms and three timed rounds.",
    config: core({
      title: "President & Bomber",
      teams: [LONERS],
      roles: [roleFrom("drifter", "loners", { count: 0 })],
      oddRoleId: "drifter-loners",
      rounds: ROUNDS,
      notes: `${END_RULE}\nShowing is always both ways: you both show, or nobody does.`,
    }),
  },
  {
    id: "tricky",
    name: "Full of tricks",
    blurb: "The President and the Bomber, plus a Mole and a Scout on each side, and a Shadow and a Drifter playing for themselves.",
    config: core({
      title: "Smoke & Mirrors",
      teams: [LONERS],
      roles: [
        roleFrom("mole", "blue", { showsAsTeamId: "red" }),
        roleFrom("mole", "red", { showsAsTeamId: "blue" }),
        roleFrom("scout", "blue"),
        roleFrom("scout", "red"),
        roleFrom("shadow", "loners"),
        roleFrom("drifter", "loners", { count: 0 }),
      ],
      oddRoleId: "drifter-loners",
      setAside: true,
      rounds: [
        { minutes: 5, swap: 2 },
        { minutes: 3, swap: 2 },
        { minutes: 2, swap: 1 },
        { minutes: 1, swap: 1 },
      ],
      notes: `${END_RULE}\nOne card is set aside, but never the President or the Bomber.`,
    }),
  },
  {
    id: "blank",
    name: "Start from scratch",
    blurb: "Just the President and the Bomber. Add the roles and rounds you want.",
    config: core({ title: "My game", notes: END_RULE }),
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
  // A pasted setup can repeat an id; each one has to be unique or edits land on the wrong copy.
  for (const list of [teams, roles] as { id: string }[][]) {
    const used = new Set<string>();
    for (const x of list) {
      if (used.has(x.id)) x.id = rid(); // roles keep pointing at the first team of that id
      used.add(x.id);
    }
  }
  const g = arr(o.groupNames);
  // Whatever came in, the President, the Bomber, Blue and Red are put back as they are in every game.
  return withCore({
    title: str(o.title, 40),
    teams,
    roles,
    oddRoleId: str(o.oddRoleId, 40),
    setAside: o.setAside === true,
    groups: o.groups === true,
    groupNames: [str(g[0], 24) || "Room 1", str(g[1], 24) || "Room 2"],
    rounds,
    notes: str(o.notes, 2000),
  });
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}
