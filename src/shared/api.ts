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
}

export interface GameUpdate {
  game: GameSummary;
  seats: { seat: Seat; username: string }[];
  mySeat: Seat | null;
  /** Present once the game has started: the state as this player may see it. */
  view: GameState | null;
  /** Events from index `from` onwards (the client keeps the earlier ones). */
  events: { from: number; list: GameEvent[] };
  waiting: Seat[];
}

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
}
