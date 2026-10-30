/** Undercover: what a host sets up, what the server keeps, and what each phone is sent. */

/** The game's name, in one place. */
export const CARDS_NAME = "Undercover";

/** How a role's holder may show their card to somebody else. */
export type ShowRule = "any" | "team" | "full" | "none";

export interface Team {
  id: string;
  name: string;
  /** One of TEAM_COLORS' keys. */
  color: string;
  /** Plain cards of this team fill the deck up to the player count, keeping the teams level. */
  fills: boolean;
  /** The name printed on a plain card of this team. */
  memberName: string;
  /** What this side is trying to do, printed on every card of the side. Empty for loners, whose roles carry their own. */
  goal: string;
}

export interface Role {
  id: string;
  /** The library role this is (see library.ts): its name, text and show rule come from there. */
  libId: string;
  name: string;
  teamId: string;
  /** How many copies go in the deck (0 leaves the role out without deleting it). */
  count: number;
  description: string;
  show: ShowRule;
  /** A team share shows this team's colour instead of the real one. Empty: the real team. */
  showsAsTeamId: string;
}

export interface Round {
  minutes: number;
  /** How many players each group sends to the other at the end of the round (when groups are on). */
  swap: number;
}

export interface Config {
  title: string;
  teams: Team[];
  roles: Role[];
  /** Added when the plain cards cannot split evenly between the filling teams. Empty: none. */
  oddRoleId: string;
  /** Deal one card more than there are players and set it aside unseen. */
  setAside: boolean;
  /** Split the players into two groups at random when dealing. */
  groups: boolean;
  groupNames: [string, string];
  rounds: Round[];
  /** Free text every player can read: the house rules. */
  notes: string;
}

export interface Card {
  roleId: string;
  name: string;
  teamId: string;
  description: string;
  show: ShowRule;
  showsAsTeamId: string;
  /** The side's goal, copied from its team when the cards are dealt. */
  goal: string;
}

export interface Timer {
  round: number;
  /** Epoch ms the round ends at, while running. */
  endsAt: number | null;
  /** Ms left, while paused or not started. */
  remaining: number;
}

export interface PlayerView {
  id: number;
  name: string;
  host: boolean;
  /** Only present once the host reveals every card. */
  card?: Card;
  /** A pretend player the host added to try the game alone. */
  test?: boolean;
  /** A test player's card, sent to the host only: there is no phone to hold it. */
  testCard?: Card;
}

/** Everything one phone is sent. Nobody else's card is in it unless the cards were revealed. */
export interface RoomView {
  code: string;
  me: number;
  host: boolean;
  config: Config;
  players: PlayerView[];
  dealt: boolean;
  deal: number;
  revealed: boolean;
  myCard: Card | null;
  myGroup: 0 | 1 | null;
  /** Revealed only: the card set aside, if any. */
  setAside: Card | null;
  timer: Timer;
  version: number;
  /** For the host: the people they removed, who can be let back in. */
  removed: { id: number; name: string }[];
  /** This phone may reveal everybody's cards: an admin, host or not. */
  canReveal: boolean;
  /** This phone may add test players: it is the host, and an admin. */
  canTest: boolean;
  /** Which start of the server this view is from (versions restart with it). */
  boot: number;
  /** The host's phone has not been heard from for a while: anyone may take over. */
  hostAway: boolean;
  serverNow: number;
}

/** A room on the list of rooms somebody is in. */
export interface CardRoomSummary {
  code: string;
  title: string;
  players: number;
  host: string;
  youHost: boolean;
  dealt: boolean;
}

export const TEAM_COLORS: Record<string, { label: string; bg: string; ink: string }> = {
  red: { label: "Red", bg: "#d23b2f", ink: "#ffffff" },
  blue: { label: "Blue", bg: "#2a63d4", ink: "#ffffff" },
  green: { label: "Green", bg: "#1f9254", ink: "#ffffff" },
  gold: { label: "Gold", bg: "#e0a100", ink: "#1d1500" },
  purple: { label: "Purple", bg: "#7c3fc4", ink: "#ffffff" },
  orange: { label: "Orange", bg: "#ea6a1f", ink: "#1e0d02" },
  teal: { label: "Teal", bg: "#12968f", ink: "#ffffff" },
  pink: { label: "Pink", bg: "#d94f8f", ink: "#ffffff" },
  grey: { label: "Grey", bg: "#6b7076", ink: "#ffffff" },
  black: { label: "Black", bg: "#1c1d20", ink: "#ffffff" },
};

export const SHOW_LABELS: Record<ShowRule, string> = {
  any: "Team or full card",
  team: "Team only",
  full: "Full card only",
  none: "Can't show at all",
};

export const MAX_PLAYERS = 60;
/** How many test players one room may hold. */
export const MAX_TEST_PLAYERS = 20;
