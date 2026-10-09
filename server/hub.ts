/**
 * Live games. The server is the only place a game's full state exists: it applies every action
 * through the rules engine, saves it, and sends each player only what they may see.
 */
import { randomInt } from "node:crypto";
import { rulesConfig } from "./rules.ts";
import { apply, newGame, type Action, type GameEvent, type GameState, type Seat } from "../src/engine/index.ts";
import type { GameSummary, GameUpdate } from "../src/shared/api.ts";
import { cleanAction, eventsFor, viewFor, waitingOn } from "../src/shared/view.ts";
import type { Game, Seated, Store, User } from "./store.ts";

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

interface Live {
  state: GameState;
  events: GameEvent[];
  /** When each event happened (the time of the move that caused it), aligned with `events`. */
  times: (string | null)[];
  seq: number;
  lastMoveAt: string | null;
}

type Listener = { userId: number; seat: Seat | null; send: (u: GameUpdate) => void; end: () => void; alive: () => boolean; sent: number };

/** Games kept in memory; beyond this, games nobody is watching are dropped and replayed when needed. */
const CACHE_LIMIT = 100;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export class Hub {
  private live = new Map<number, Live>();
  private loading = new Map<number, Promise<Live | null>>();
  private locks = new Map<number, Promise<unknown>>();
  private inFlight = new Map<number, number>();
  private listeners = new Map<number, Set<Listener>>();

  constructor(private store: Store) {}

  /** Run `fn` for one game at a time, so two phones acting at once cannot interleave. */
  private exclusive<T>(gameId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(gameId) ?? Promise.resolve();
    // Counted while queued or running, so the cache never drops a game a move is being made in.
    this.inFlight.set(gameId, (this.inFlight.get(gameId) ?? 0) + 1);
    const run = () =>
      fn().finally(() => {
        const n = (this.inFlight.get(gameId) ?? 1) - 1;
        if (n > 0) this.inFlight.set(gameId, n);
        else this.inFlight.delete(gameId);
      });
    const next = prev.then(run, run);
    this.locks.set(
      gameId,
      next.catch(() => {}),
    );
    return next;
  }

  /**
   * The game in memory, replayed from the database the first time it is needed. Concurrent
   * callers share one replay: two racing replays could otherwise let a stale one overwrite a
   * state that already includes a newer action (seen after a restart, when every phone reconnects).
   */
  private load(game: Game): Promise<Live | null> {
    if (game.status === "lobby" || game.seed === null) return Promise.resolve(null);
    const cached = this.live.get(game.id);
    if (cached) return Promise.resolve(cached);
    const pending = this.loading.get(game.id);
    if (pending) return pending;
    const seed = game.seed;
    const p = (async () => {
      const seated = await this.store.seated(game.id);
      // The IPO company was called ZOM before it became Oracle Group (ORG); old saved moves still say ZOM.
      const saved = await this.store.actions(game.id);
      const actions = saved.map(({ action: x }) => ("company" in x && (x.company as string) === "ZOM" ? { ...x, company: "ORG" as const } : x));
      // Replayed a move at a time so every event keeps the time of the move that caused it.
      const start = newGame({ ...rulesConfig(game.rules), players: seated.map((x) => x.username), rounds: game.rounds, seed });
      let state = start.state;
      const events = [...start.events];
      const times: (string | null)[] = start.events.map(() => game.startedAt);
      actions.forEach((a, i) => {
        const r = apply(state, a);
        if (!r.ok) throw new Error(`Move ${i + 1} (${a.type}) is illegal on replay: ${r.error}`);
        state = r.state;
        events.push(...r.events);
        times.push(...r.events.map(() => saved[i].at));
      });
      const live = this.live.get(game.id) ?? { state, events, times, seq: actions.length, lastMoveAt: saved.at(-1)?.at ?? null };
      this.live.set(game.id, live);
      this.trimCache();
      return live;
    })().finally(() => this.loading.delete(game.id));
    this.loading.set(game.id, p);
    return p;
  }

  private trimCache() {
    if (this.live.size <= CACHE_LIMIT) return;
    for (const id of this.live.keys()) {
      if (this.live.size <= CACHE_LIMIT) break;
      if (!this.listeners.get(id)?.size && !this.loading.has(id) && !this.inFlight.has(id)) this.live.delete(id);
    }
  }

  async summary(game: Game, forUser: number): Promise<GameSummary> {
    const seated = await this.store.seated(game.id);
    const creator = await this.store.userById(game.createdBy);
    const live = await this.load(game);
    const mine = seated.find((p) => p.userId === forUser);
    return {
      id: game.id,
      code: game.code,
      status: game.status,
      rounds: game.rounds,
      maxPlayers: game.maxPlayers,
      createdBy: creator?.username ?? "?",
      players: seated.map((p) => p.username),
      yourMove: !!(live && mine && game.status === "playing" && waitingOn(live.state).includes(mine.seat)),
      round: live ? live.state.round : null,
      waitingFor: live && game.status === "playing" ? waitingOn(live.state).map((i) => seated.find((p) => p.seat === i)?.username ?? "?") : [],
      createdAt: game.createdAt,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      lastMoveAt: live?.lastMoveAt ?? null,
    };
  }

  private async update(game: Game, seated: Seated[], user: User, sinceRaw: number): Promise<GameUpdate> {
    const live = await this.load(game);
    const since = Math.min(Math.max(0, Math.floor(sinceRaw) || 0), live?.events.length ?? 0);
    const mine = seated.find((p) => p.userId === user.id);
    const seat = mine ? mine.seat : null;
    // The admin sees everything in a game they are not playing in; in their own games, only their seat.
    const reveal = user.isAdmin && !mine;
    return {
      game: await this.summary(game, user.id),
      seats: seated.map((p) => ({ seat: p.seat, username: p.username })),
      mySeat: seat,
      revealed: reveal,
      view: live ? viewFor(live.state, seat, reveal) : null,
      events: {
        from: since,
        list: live ? eventsFor(live.events.slice(since), seat, live.state.phase.kind === "ended", reveal) : [],
        times: live ? live.times.slice(since) : [],
      },
      waiting: live && game.status === "playing" ? waitingOn(live.state) : [],
    };
  }

  /** Push the latest to everyone watching a game, each with their own view. */
  /** Send the latest to every watcher without waiting, and never let a failure take the server down. */
  private push(gameId: number) {
    this.broadcast(gameId).catch((e) => console.error(`Could not send game ${gameId} to its watchers:`, e));
  }

  private async broadcast(gameId: number) {
    const set = this.listeners.get(gameId);
    if (!set?.size) return;
    const game = await this.store.gameById(gameId);
    if (!game) return;
    const seated = await this.store.seated(gameId);
    for (const l of set) {
      // Re-check on every push: a closed connection, a switched-off account or a player who has
      // left must stop receiving the game.
      const user = await this.store.userById(l.userId);
      const allowed = !!user && user.active && (user.isAdmin || seated.some((p) => p.userId === l.userId));
      if (!l.alive() || !allowed) {
        set.delete(l);
        l.end();
        continue;
      }
      try {
        const u = await this.update(game, seated, user, l.sent);
        l.sent = u.events.from + u.events.list.length;
        l.send(u);
      } catch (e) {
        // One watcher's failure must not stop the others getting the move.
        console.error(`Could not send game ${gameId} to user ${l.userId}:`, e);
      }
    }
  }

  /** End every live connection a user has (switched off, password reset, signed out everywhere). */
  disconnectUser(userId: number) {
    for (const set of this.listeners.values()) {
      for (const l of set) {
        if (l.userId === userId) {
          set.delete(l);
          l.end();
        }
      }
    }
  }

  async watch(gameId: number, user: User, since: number, conn: { send: (u: GameUpdate) => void; end: () => void; alive: () => boolean }): Promise<() => void> {
    const game = await this.mustSee(gameId, user);
    const seated = await this.store.seated(gameId);
    const mine = seated.find((p) => p.userId === user.id);
    const first = await this.update(game, seated, user, since);
    const l: Listener = { userId: user.id, seat: mine?.seat ?? null, ...conn, sent: first.events.from + first.events.list.length };
    if (!conn.alive()) return () => {};
    conn.send(first);
    const set = this.listeners.get(gameId) ?? new Set();
    set.add(l);
    this.listeners.set(gameId, set);
    return () => set.delete(l);
  }

  /** Players of a game may see it; the admin may watch any game. */
  async mustSee(gameId: number, user: User): Promise<Game> {
    const game = await this.store.gameById(gameId);
    if (!game) throw new GameError("No such game.", 404);
    if (user.isAdmin) return game;
    const seated = await this.store.seated(gameId);
    if (!seated.some((p) => p.userId === user.id)) throw new GameError("You are not in this game.", 403);
    return game;
  }

  async create(user: User, rounds: number, maxPlayers: number): Promise<Game> {
    if (![6, 9, 12].includes(rounds)) throw new GameError("A game is 6, 9 or 12 rounds.");
    if (!Number.isInteger(maxPlayers) || maxPlayers < 3 || maxPlayers > 5) throw new GameError("A game is for 3–5 players.");
    let code = "";
    for (let tries = 0; ; tries++) {
      if (tries === 20) throw new GameError("Couldn't find a free game code. Try again.", 503);
      code = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      if (!(await this.store.gameByCode(code))) break;
    }
    const game = await this.store.createGame({ code, createdBy: user.id, rounds: rounds as 6 | 9 | 12, maxPlayers });
    await this.store.addPlayer(game.id, user.id);
    return game;
  }

  async join(user: User, rawCode: string): Promise<Game> {
    const code = String(rawCode ?? "").trim().toUpperCase();
    const game = await this.store.gameByCode(code);
    if (!game) throw new GameError("No game has that code. Check it with whoever created the game.", 404);
    return this.exclusive(game.id, async () => {
      const g = (await this.store.gameById(game.id))!;
      const seated = await this.store.seated(g.id);
      if (seated.some((p) => p.userId === user.id) && g.status !== "abandoned") return g;
      if (g.status === "abandoned") throw new GameError("That game was cancelled.");
      if (g.status !== "lobby") throw new GameError("That game has already started.");
      if (seated.length >= g.maxPlayers) throw new GameError("That game is full.");
      await this.store.addPlayer(g.id, user.id);
      this.push(g.id);
      return g;
    });
  }

  async leave(user: User, gameId: number) {
    return this.exclusive(gameId, async () => {
      const g = await this.mustSee(gameId, user);
      if (g.status !== "lobby") throw new GameError("You can only leave a game before it starts.");
      if (g.createdBy === user.id) {
        await this.store.updateGame(g.id, { status: "abandoned" });
      } else await this.store.removePlayer(g.id, user.id);
      this.push(g.id);
    });
  }

  async start(user: User, gameId: number) {
    return this.exclusive(gameId, async () => {
      const g = await this.mustSee(gameId, user);
      if (g.createdBy !== user.id && !user.isAdmin) throw new GameError("Only the player who created the game can start it.", 403);
      if (g.status !== "lobby") throw new GameError("That game has already started.");
      const seated = await this.store.seated(g.id);
      if (seated.length < 3) throw new GameError("A game needs at least 3 players.");
      const seed = randomInt(2 ** 31);
      const { state, events } = newGame({ ...rulesConfig(g.rules), players: seated.map((p) => p.username), rounds: g.rounds, seed });
      await this.store.updateGame(g.id, { status: "playing", seed }); // one write: never "playing" without a seed
      const now = new Date().toISOString();
      this.live.set(g.id, { state, events: [...events], times: events.map(() => now), seq: 0, lastMoveAt: null });
      this.push(g.id);
    });
  }

  async act(user: User, gameId: number, action: Action) {
    return this.exclusive(gameId, async () => {
      const g = await this.mustSee(gameId, user);
      if (g.status !== "playing") throw new GameError(g.status === "lobby" ? "The game hasn't started." : "The game is over.");
      const seated = await this.store.seated(g.id);
      const mine = seated.find((p) => p.userId === user.id);
      if (!mine) throw new GameError("You are watching this game, not playing in it.", 403);
      const live = (await this.load(g))!;
      // Only the fields an action has, and the seat always from the login, never from the phone.
      const a = cleanAction(action, mine.seat);
      if (!a) throw new GameError("Unknown action.");
      const r = apply(live.state, a);
      if (!r.ok) throw new GameError(r.error);
      await this.store.appendAction(g.id, live.seq, a);
      const now = new Date().toISOString();
      live.state = r.state;
      live.events.push(...r.events);
      live.times.push(...r.events.map(() => now));
      live.lastMoveAt = now;
      live.seq++;
      // If anything replaced the cached copy while the move was being saved, this one is the truth.
      this.live.set(g.id, live);
      if (r.state.phase.kind === "ended") await this.store.updateGame(g.id, { status: "ended" });
      this.push(g.id);
    });
  }

  async abandon(gameId: number) {
    return this.exclusive(gameId, async () => {
      const g = await this.store.gameById(gameId);
      if (!g) throw new GameError("No such game.", 404);
      if (g.status === "ended") throw new GameError("That game has finished; it stays in the players' history.");
      if (g.status === "abandoned") return;
      await this.store.updateGame(gameId, { status: "abandoned" });
      this.live.delete(gameId);
      this.push(gameId);
    });
  }
}
