/**
 * Where accounts and games are kept. Postgres in production (DATABASE_URL), memory for local
 * development and tests. A game is stored as its seed and the list of actions taken: the rules
 * engine replays them, so nothing else about a game needs saving.
 */
import pg from "pg";
import type { Action } from "../src/engine/index.ts";

export type GameStatus = "lobby" | "playing" | "ended" | "abandoned";

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
}

export interface Game {
  id: number;
  code: string;
  createdBy: number;
  status: GameStatus;
  rounds: 6 | 9 | 12;
  maxPlayers: number;
  seed: number | null;
  createdAt: string;
}

export interface Seated {
  userId: number;
  seat: number;
  username: string;
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  userByName(username: string): Promise<User | null>;
  userById(id: number): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(username: string, passwordHash: string, isAdmin: boolean): Promise<User>;
  updateUser(id: number, patch: { passwordHash?: string; active?: boolean; isAdmin?: boolean }): Promise<void>;
  createSession(token: string, userId: number, expiresAt: Date): Promise<void>;
  sessionUser(token: string): Promise<User | null>;
  deleteSession(token: string): Promise<void>;
  deleteSessionsFor(userId: number): Promise<void>;
  createGame(g: { code: string; createdBy: number; rounds: 6 | 9 | 12; maxPlayers: number }): Promise<Game>;
  gameById(id: number): Promise<Game | null>;
  gameByCode(code: string): Promise<Game | null>;
  gamesFor(userId: number): Promise<Game[]>;
  allGames(): Promise<Game[]>;
  updateGame(id: number, patch: { status?: GameStatus; seed?: number }): Promise<void>;
  seated(gameId: number): Promise<Seated[]>;
  addPlayer(gameId: number, userId: number): Promise<void>;
  removePlayer(gameId: number, userId: number): Promise<void>;
  actions(gameId: number): Promise<Action[]>;
  appendAction(gameId: number, seq: number, action: Action): Promise<void>;
}

// ─── Memory ─────────────────────────────────────────────────────────────────────────────

export class MemoryStore implements Store {
  private users: User[] = [];
  private sessions = new Map<string, { userId: number; expiresAt: Date }>();
  private games: Game[] = [];
  private players: { gameId: number; userId: number; seat: number }[] = [];
  private log = new Map<number, Action[]>();

  async init() {}
  async close() {}
  async userByName(username: string) {
    return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
  }
  async userById(id: number) {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async listUsers() {
    return [...this.users];
  }
  async createUser(username: string, passwordHash: string, isAdmin: boolean) {
    const u: User = { id: this.users.length + 1, username, passwordHash, isAdmin, active: true, createdAt: new Date().toISOString() };
    this.users.push(u);
    return u;
  }
  async updateUser(id: number, patch: { passwordHash?: string; active?: boolean; isAdmin?: boolean }) {
    const u = this.users.find((x) => x.id === id);
    if (u) Object.assign(u, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  }
  async createSession(token: string, userId: number, expiresAt: Date) {
    this.sessions.set(token, { userId, expiresAt });
  }
  async sessionUser(token: string) {
    const s = this.sessions.get(token);
    if (!s || s.expiresAt < new Date()) return null;
    return this.userById(s.userId);
  }
  async deleteSession(token: string) {
    this.sessions.delete(token);
  }
  async deleteSessionsFor(userId: number) {
    for (const [t, s] of this.sessions) if (s.userId === userId) this.sessions.delete(t);
  }
  async createGame(g: { code: string; createdBy: number; rounds: 6 | 9 | 12; maxPlayers: number }) {
    const game: Game = { id: this.games.length + 1, status: "lobby", seed: null, createdAt: new Date().toISOString(), ...g };
    this.games.push(game);
    return { ...game };
  }
  async gameById(id: number) {
    const g = this.games.find((x) => x.id === id);
    return g ? { ...g } : null;
  }
  async gameByCode(code: string) {
    const g = this.games.find((x) => x.code === code);
    return g ? { ...g } : null;
  }
  async gamesFor(userId: number) {
    const ids = new Set(this.players.filter((p) => p.userId === userId).map((p) => p.gameId));
    return this.games.filter((g) => ids.has(g.id)).map((g) => ({ ...g })).reverse();
  }
  async allGames() {
    return this.games.map((g) => ({ ...g })).reverse();
  }
  async updateGame(id: number, patch: { status?: GameStatus; seed?: number }) {
    const g = this.games.find((x) => x.id === id);
    if (g) Object.assign(g, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  }
  async seated(gameId: number) {
    return this.players
      .filter((p) => p.gameId === gameId)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ userId: p.userId, seat: p.seat, username: this.users.find((u) => u.id === p.userId)!.username }));
  }
  async addPlayer(gameId: number, userId: number) {
    const seats = this.players.filter((p) => p.gameId === gameId).map((p) => p.seat);
    this.players.push({ gameId, userId, seat: seats.length ? Math.max(...seats) + 1 : 0 });
  }
  async removePlayer(gameId: number, userId: number) {
    this.players = this.players.filter((p) => !(p.gameId === gameId && p.userId === userId));
    // Close the gap so seats stay 0..n-1 in join order.
    this.players
      .filter((p) => p.gameId === gameId)
      .sort((a, b) => a.seat - b.seat)
      .forEach((p, i) => (p.seat = i));
  }
  async actions(gameId: number) {
    return [...(this.log.get(gameId) ?? [])];
  }
  async appendAction(gameId: number, seq: number, action: Action) {
    const list = this.log.get(gameId) ?? [];
    if (list.length !== seq) throw new Error(`Action ${seq} out of order for game ${gameId}`);
    list.push(action);
    this.log.set(gameId, list);
  }
}

// ─── Postgres ───────────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  seed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS game_players (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seat INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id),
  UNIQUE (game_id, seat)
);
CREATE TABLE IF NOT EXISTS game_actions (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  action JSONB NOT NULL,
  PRIMARY KEY (game_id, seq)
);
`;

type Row = Record<string, unknown>;
const toUser = (r: Row): User => ({
  id: r.id as number,
  username: r.username as string,
  passwordHash: r.password_hash as string,
  isAdmin: r.is_admin as boolean,
  active: r.active as boolean,
  createdAt: new Date(r.created_at as string).toISOString(),
});
const toGame = (r: Row): Game => ({
  id: r.id as number,
  code: r.code as string,
  createdBy: r.created_by as number,
  status: r.status as GameStatus,
  rounds: r.rounds as 6 | 9 | 12,
  maxPlayers: r.max_players as number,
  seed: (r.seed as number | null) ?? null,
  createdAt: new Date(r.created_at as string).toISOString(),
});

export class PgStore implements Store {
  private pool: pg.Pool;
  constructor(url: string) {
    // Neon and Render Postgres both require TLS.
    this.pool = new pg.Pool({ connectionString: url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false }, max: 5 });
  }
  private async q(sql: string, params: unknown[] = []) {
    return (await this.pool.query(sql, params)).rows as Row[];
  }
  async init() {
    await this.pool.query(SCHEMA);
  }
  async close() {
    await this.pool.end();
  }
  async userByName(username: string) {
    const [r] = await this.q("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
    return r ? toUser(r) : null;
  }
  async userById(id: number) {
    const [r] = await this.q("SELECT * FROM users WHERE id = $1", [id]);
    return r ? toUser(r) : null;
  }
  async listUsers() {
    return (await this.q("SELECT * FROM users ORDER BY id")).map(toUser);
  }
  async createUser(username: string, passwordHash: string, isAdmin: boolean) {
    const [r] = await this.q("INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING *", [username, passwordHash, isAdmin]);
    return toUser(r);
  }
  async updateUser(id: number, patch: { passwordHash?: string; active?: boolean; isAdmin?: boolean }) {
    if (patch.passwordHash !== undefined) await this.q("UPDATE users SET password_hash = $2 WHERE id = $1", [id, patch.passwordHash]);
    if (patch.active !== undefined) await this.q("UPDATE users SET active = $2 WHERE id = $1", [id, patch.active]);
    if (patch.isAdmin !== undefined) await this.q("UPDATE users SET is_admin = $2 WHERE id = $1", [id, patch.isAdmin]);
  }
  async createSession(token: string, userId: number, expiresAt: Date) {
    await this.q("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expiresAt]);
  }
  async sessionUser(token: string) {
    const [r] = await this.q("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()", [token]);
    return r ? toUser(r) : null;
  }
  async deleteSession(token: string) {
    await this.q("DELETE FROM sessions WHERE token = $1", [token]);
  }
  async deleteSessionsFor(userId: number) {
    await this.q("DELETE FROM sessions WHERE user_id = $1", [userId]);
  }
  async createGame(g: { code: string; createdBy: number; rounds: 6 | 9 | 12; maxPlayers: number }) {
    const [r] = await this.q("INSERT INTO games (code, created_by, status, rounds, max_players) VALUES ($1, $2, 'lobby', $3, $4) RETURNING *", [g.code, g.createdBy, g.rounds, g.maxPlayers]);
    return toGame(r);
  }
  async gameById(id: number) {
    const [r] = await this.q("SELECT * FROM games WHERE id = $1", [id]);
    return r ? toGame(r) : null;
  }
  async gameByCode(code: string) {
    const [r] = await this.q("SELECT * FROM games WHERE code = $1", [code]);
    return r ? toGame(r) : null;
  }
  async gamesFor(userId: number) {
    return (await this.q("SELECT g.* FROM games g JOIN game_players p ON p.game_id = g.id WHERE p.user_id = $1 ORDER BY g.id DESC", [userId])).map(toGame);
  }
  async allGames() {
    return (await this.q("SELECT * FROM games ORDER BY id DESC LIMIT 200")).map(toGame);
  }
  async updateGame(id: number, patch: { status?: GameStatus; seed?: number }) {
    if (patch.status !== undefined) await this.q("UPDATE games SET status = $2 WHERE id = $1", [id, patch.status]);
    if (patch.seed !== undefined) await this.q("UPDATE games SET seed = $2 WHERE id = $1", [id, patch.seed]);
  }
  async seated(gameId: number) {
    return (
      await this.q("SELECT p.user_id, p.seat, u.username FROM game_players p JOIN users u ON u.id = p.user_id WHERE p.game_id = $1 ORDER BY p.seat", [gameId])
    ).map((r) => ({ userId: r.user_id as number, seat: r.seat as number, username: r.username as string }));
  }
  async addPlayer(gameId: number, userId: number) {
    await this.q(
      "INSERT INTO game_players (game_id, user_id, seat) VALUES ($1, $2, (SELECT COALESCE(MAX(seat) + 1, 0) FROM game_players WHERE game_id = $1))",
      [gameId, userId],
    );
  }
  async removePlayer(gameId: number, userId: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM game_players WHERE game_id = $1 AND user_id = $2", [gameId, userId]);
      const { rows } = await client.query("SELECT user_id FROM game_players WHERE game_id = $1 ORDER BY seat", [gameId]);
      // Renumber in two passes so the unique (game, seat) index is never violated mid-way.
      for (let i = 0; i < rows.length; i++) await client.query("UPDATE game_players SET seat = $3 WHERE game_id = $1 AND user_id = $2", [gameId, rows[i].user_id, 1000 + i]);
      for (let i = 0; i < rows.length; i++) await client.query("UPDATE game_players SET seat = $3 WHERE game_id = $1 AND user_id = $2", [gameId, rows[i].user_id, i]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async actions(gameId: number) {
    return (await this.q("SELECT action FROM game_actions WHERE game_id = $1 ORDER BY seq", [gameId])).map((r) => r.action as Action);
  }
  async appendAction(gameId: number, seq: number, action: Action) {
    await this.q("INSERT INTO game_actions (game_id, seq, action) VALUES ($1, $2, $3)", [gameId, seq, JSON.stringify(action)]);
  }
}
