/**
 * Undercover's roles. A host picks from this list rather than writing roles from scratch, so
 * every card says something that has been thought through. The app enforces what it can (how a
 * card may be shown, and a disguised team colour); the rest the players keep to themselves.
 */
import type { Role, ShowRule } from "./types.ts";

export type RoleGroup = "key" | "helper" | "trick" | "loner";

export interface LibraryRole {
  id: string;
  name: string;
  group: RoleGroup;
  description: string;
  show: ShowRule;
  /** A team share shows another team's colour. */
  disguise: boolean;
  /** Copies added at once. */
  copies: number;
}

export const ROLE_GROUPS: { id: RoleGroup; name: string; blurb: string }[] = [
  { id: "key", name: "Key cards", blurb: "The cards a team's goal is built around." },
  { id: "helper", name: "Team players", blurb: "On a side, with something extra to do." },
  { id: "trick", name: "Tricksters", blurb: "On a side, but hard to read." },
  { id: "loner", name: "Loners", blurb: "On nobody's side. Each plays for a goal of their own." },
];

export const LIBRARY: LibraryRole[] = [
  { id: "leader", name: "Leader", group: "key", copies: 1, show: "any", disguise: false, description: "Your side's key card. Everything your side wants turns on where you end up." },
  { id: "deputy", name: "Deputy", group: "key", copies: 1, show: "any", disguise: false, description: "If your team's Leader was set aside and nobody holds it, you become the Leader." },

  { id: "scout", name: "Scout", group: "helper", copies: 1, show: "any", disguise: false, description: "Once a round you may ask anyone to show you their team. They can refuse, but everyone will know they did." },
  { id: "open-book", name: "Open Book", group: "helper", copies: 1, show: "full", disguise: false, description: "You can't hide behind a colour: whenever you show, you show your whole card." },
  { id: "herald", name: "Herald", group: "helper", copies: 1, show: "any", disguise: false, description: "When a round ends, you may tell the whole group one thing you have seen. It must be true." },

  { id: "mole", name: "Mole", group: "trick", copies: 1, show: "any", disguise: true, description: "A team share shows you in the other side's colour. Your full card tells the truth." },
  { id: "silent", name: "Silent", group: "trick", copies: 1, show: "none", disguise: false, description: "You can't show your card to anyone. Talk your way through." },
  { id: "veil", name: "Veil", group: "trick", copies: 1, show: "team", disguise: false, description: "You may only ever show your team. Never let anyone see the rest of your card." },
  { id: "bluffer", name: "Bluffer", group: "trick", copies: 1, show: "team", disguise: false, description: "Say you are any role you like. All you can ever show is your team colour." },

  { id: "drifter", name: "Drifter", group: "loner", copies: 1, show: "any", disguise: false, description: "You win if you end the game in the group with more people in it." },
  { id: "shadow", name: "Shadow", group: "loner", copies: 1, show: "any", disguise: false, description: "Before the first round, secretly tell the host one player's name. You win if you end in the same group as them." },
];

export const LIBRARY_BY_ID: Record<string, LibraryRole> = Object.fromEntries(LIBRARY.map((r) => [r.id, r]));

/** A role in a setup, made from the library. */
export function roleFrom(libId: string, teamId: string, opts: { id?: string; count?: number; showsAsTeamId?: string } = {}): Role {
  const lib = LIBRARY_BY_ID[libId];
  if (!lib) throw new Error(`No role ${libId}`);
  return {
    id: opts.id ?? `${libId}-${teamId}`,
    libId,
    name: lib.name,
    teamId,
    count: opts.count ?? lib.copies,
    description: lib.description,
    show: lib.show,
    showsAsTeamId: lib.disguise ? (opts.showsAsTeamId ?? "") : "",
  };
}
