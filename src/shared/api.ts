/** What the server and the app send each other. */
import type { GameEvent, GameState, Seat } from "../engine/index.ts";

export interface Me {
  id: number;
  username: string;
  isAdmin: boolean;
}

export type GameStatus = "lobby" | "playing" | "ended" | "abandoned";

export interface GameSummary {
  id: number;
  code: string;
  status: GameStatus;
  rounds: 6 | 9 | 12;
  maxPlayers: number;
  createdBy: string;
  players: string[];
  /** Whether it's waiting on you right now. */
  yourMove: boolean;
  round: number | null;
  /** Who the game is waiting on right now. */
  waitingFor: string[];
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  lastMoveAt: string | null;
}

export interface GameUpdate {
  game: GameSummary;
  seats: { seat: Seat; username: string }[];
  mySeat: Seat | null;
  /** The admin watching a game they are not in: every player's cash, cards and sealed moves are shown. */
  revealed: boolean;
  /** Present once the game has started: the state as this player may see it. */
  view: GameState | null;
  /** Events from index `from` onwards (the client keeps the earlier ones). */
  events: { from: number; list: GameEvent[]; times: (string | null)[] };
  waiting: Seat[];
}

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  /** Devices currently signed in. */
  devices: number;
}

export interface LoginRecord {
  id: number;
  userId: number | null;
  username: string;
  result: "ok" | "wrong" | "blocked" | "off";
  device: string;
  at: string;
}
