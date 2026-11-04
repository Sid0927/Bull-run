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
  { id: "key", name: "In every game", blurb: "The President (Blue) and the Bomber (Red): both sides' goals turn on where they end up." },
  { id: "helper", name: "Team players", blurb: "On a side, with something extra to do." },
  { id: "trick", name: "Tricksters", blurb: "On a side, but hard to read." },
  { id: "loner", name: "Loners", blurb: "On nobody's side. Each plays for a goal of their own." },
];

export const LIBRARY: LibraryRole[] = [
  { id: "president", name: "President", group: "key", copies: 1, show: "any", disguise: false, description: "Stay away from the Bomber. Your side wins if, when the last round ends, you are not in the same room as the Bomber." },
  { id: "bomber", name: "Bomber", group: "key", copies: 1, show: "any", disguise: false, description: "Get to the President. Your side wins if, when the last round ends, you are in the same room as the President." },

  { id: "scout", name: "Scout", group: "helper", copies: 1, show: "any", disguise: false, description: "Once a round you may ask anyone to show you their team. They can refuse, but everyone will know they did." },
  { id: "open-book", name: "Open Book", group: "helper", copies: 1, show: "full", disguise: false, description: "You can't hide behind a colour: whenever you show, you show your whole card." },
  { id: "herald", name: "Herald", group: "helper", copies: 1, show: "any", disguise: false, description: "When a round ends, you may tell the whole group one thing you have seen. It must be true." },

  { id: "lover", name: "Lover", group: "helper", copies: 1, show: "any", disguise: false, description: "You and your Lover, on the other side, know each other: the app tells you who. You both win if you end the game in the same room." },
  { id: "spy", name: "Spy", group: "trick", copies: 1, show: "any", disguise: true, description: "You play for your own side. When you show your team, you show the other side's colour; when you show your whole card, it shows your real side." },
  { id: "silent", name: "Silent", group: "trick", copies: 1, show: "none", disguise: false, description: "You can't show your card to anyone. Talk your way through." },

  { id: "drifter", name: "Drifter", group: "loner", copies: 1, show: "any", disguise: false, description: "You win if you end the game in the group with more people in it." },
  { id: "gambler", name: "Gambler", group: "loner", copies: 1, show: "any", disguise: false, description: "Secretly bets on which team will win. Correct prediction gives a personal win." },
  { id: "shadow", name: "Shadow", group: "loner", copies: 1, show: "any", disguise: false, description: "Before the first round, secretly tell the host one player's name. You win if you end in the same group as them." },
];

export const LIBRARY_BY_ID: Record<string, LibraryRole> = Object.fromEntries(LIBRARY.map((r) => [r.id, r]));

/** Roles that were renamed: a setup saved under the old name still loads. */
export const RENAMED: Record<string, string> = { mole: "spy" };

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
