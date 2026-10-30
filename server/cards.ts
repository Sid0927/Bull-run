/**
 * Undercover: secret role cards for a game played in person, each phone holding one card.
 *
 * A room is one evening. A player is a signed-in account, so a phone that reloads or loses signal
 * is back in its seat by itself. Every change is written to the store whole, so a restart (a
 * deploy) does not end a game; a room nobody has touched for twelve hours is dropped.
 */
import { randomInt } from "node:crypto";
import { buildDeck, shuffle, splitGroups } from "../src/cards/deck.ts";
import { PRESETS, cleanConfig } from "../src/cards/presets.ts";
import type { Card, CardRoomSummary, Config, RoomView, Timer } from "../src/cards/types.ts";
import { MAX_PLAYERS, MAX_TEST_PLAYERS } from "../src/cards/types.ts";
import type { Store } from "./store.ts";

export class RoomError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Who {
  id: number;
  username: string;
}

interface Player {
  /** An account's id; a test player has a negative one, which no account can have. */
  userId: number;
  name: string;
  test?: boolean;
  card: Card | null;
  group: 0 | 1 | null;
}

interface Room {
  code: string;
  hostId: number;
  players: Player[];
  config: Config;
  dealt: boolean;
  deal: number;
  revealed: boolean;
  setAside: Card | null;
  timer: Timer;
  touched: number;
  version: number;
  /** Accounts the host removed: a shared link must not let them straight back in. */
  kicked?: number[];
}

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O: they read as 1 and 0
const ROOM_TTL = 12 * 60 * 60 * 1000;
/** A phone polls every 20 seconds; past this, its host is taken to have gone. */
export const HOST_AWAY_MS = 90_000;
const MAX_ROOMS = 2000;
const random = () => randomInt(0, 2 ** 32) / 2 ** 32;

export class CardRooms {
  private rooms = new Map<string, Room>();
  /** When each player's phone last asked for the room, so a host who has gone can be replaced. */
  private seen = new Map<string, number>();
  /** Changes on every start: a phone holding a view from before a restart takes the new one. */
  readonly boot = Date.now();
  private writes = new Map<string, Promise<void>>();
  private watchers = new Map<string, Set<() => void>>();

  constructor(
    private store: Store,
    private log: (m: string) => void = () => {},
    private now: () => number = Date.now,
  ) {}

  /** Reads back the rooms saved before a restart. */
  async init() {
    const cutoff = this.now() - ROOM_TTL;
    for (const { code, data } of await this.store.cardRooms()) {
      const room = data as Room;
      if (!room || typeof room !== "object" || !Array.isArray(room.players) || room.touched < cutoff) {
        await this.store.deleteCardRoom(code).catch(() => {});
        continue;
      }
      room.config = cleanConfig(room.config);
      this.rooms.set(code, room);
    }
  }

  create(user: Who): string {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError(503, "Too many rooms are open right now. Try again in a while.");
    let code = "";
    do code = Array.from({ length: 5 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
    while (this.rooms.has(code));
    const room: Room = {
      code,
      hostId: user.id,
      players: [this.newPlayer(user)],
      config: structuredClone(PRESETS[0].config),
      dealt: false,
      deal: 0,
      revealed: false,
      setAside: null,
      timer: { round: 0, endsAt: null, remaining: 0 },
      touched: this.now(),
      version: 1,
    };
    room.timer.remaining = this.roundMs(room, 0);
    this.rooms.set(code, room);
    this.changed(room);
    return code;
  }

  /** Joins, or simply opens a room this account is already in. */
  join(code: string, user: Who) {
    const room = this.get(code);
    const p = room.players.find((x) => x.userId === user.id);
    if (p) {
      p.name = user.username;
      return;
    }
    if (room.kicked?.includes(user.id)) throw new RoomError(403, "The host removed you from this room. Ask them to let you back in.");
    if (room.dealt) throw new RoomError(409, "The cards in this room are already dealt. Ask the host to collect them so you can join.");
    if (room.players.length >= MAX_PLAYERS) throw new RoomError(409, `This room is full (${MAX_PLAYERS} players).`);
    room.players.push(this.newPlayer(user));
    this.changed(room);
  }

  /** The rooms this account is in, newest first. */
  mine(user: Who): CardRoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.players.some((p) => p.userId === user.id))
      .sort((a, b) => b.touched - a.touched)
      .map((r) => ({
        code: r.code,
        title: r.config.title,
        players: r.players.length,
        host: r.players.find((p) => p.userId === r.hostId)?.name ?? "",
        youHost: r.hostId === user.id,
        dealt: r.dealt,
      }));
  }

  view(code: string, user: Who): RoomView {
    const room = this.get(code);
    const me = this.player(room, user);
    this.seen.set(`${room.code}:${me.userId}`, this.now());
    return {
      code: room.code,
      me: me.userId,
      host: me.userId === room.hostId,
      config: room.config,
      players: room.players.map((p) => ({
        id: p.userId,
        name: p.name,
        host: p.userId === room.hostId,
        ...(p.test ? { test: true } : {}),
        ...(p.test && p.card && me.userId === room.hostId ? { testCard: p.card } : {}),
        ...(room.revealed && p.card ? { card: p.card } : {}),
        ...(room.dealt && p.group !== null ? { group: p.group } : {}),
      })),
      dealt: room.dealt,
      deal: room.deal,
      revealed: room.revealed,
      myCard: me.card,
      myGroup: me.group,
      setAside: room.revealed ? room.setAside : null,
      timer: room.timer,
      version: room.version,
      boot: this.boot,
      hostAway: me.userId !== room.hostId && this.away(room, room.hostId),
      serverNow: this.now(),
    };
  }

  /** Calls `fn` whenever the room changes, until the returned function is called. */
  watch(code: string, user: Who, fn: () => void): () => void {
    this.player(this.get(code), user);
    const set = this.watchers.get(code) ?? new Set();
    set.add(fn);
    this.watchers.set(code, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.watchers.delete(code);
    };
  }

  setConfig(code: string, user: Who, input: unknown) {
    const room = this.hostRoom(code, user);
    if (room.dealt) throw new RoomError(400, "Collect the cards before changing the setup.");
    room.config = cleanConfig(input);
    room.timer = { round: 0, endsAt: null, remaining: this.roundMs(room, 0) };
    this.changed(room);
  }

  /** Deals. Dealing again over cards already out needs `again`, so a stale Deal button can't reshuffle a game. */
  deal(code: string, user: Who, again = false) {
    const room = this.hostRoom(code, user);
    if (room.dealt && !again) throw new RoomError(409, "The cards are already out. Use Deal again to reshuffle.");
    const built = buildDeck(room.config, room.players.length);
    if ("error" in built) throw new RoomError(400, built.error);
    const cards = shuffle(built.cards, random);
    const groups = room.config.groups ? splitGroups(room.players.length, random) : [];
    room.players.forEach((p, i) => {
      p.card = cards[i];
      p.group = room.config.groups ? groups[i] : null;
    });
    room.setAside = room.config.setAside ? cards[room.players.length] : null;
    room.dealt = true;
    room.revealed = false;
    room.deal += 1;
    room.timer = { round: 0, endsAt: null, remaining: this.roundMs(room, 0) };
    this.changed(room);
  }

  /** Takes the cards back: the room is in setup again. */
  collect(code: string, user: Who) {
    const room = this.hostRoom(code, user);
    for (const p of room.players) {
      p.card = null;
      p.group = null;
    }
    room.dealt = false;
    room.revealed = false;
    room.setAside = null;
    room.timer = { round: 0, endsAt: null, remaining: this.roundMs(room, 0) };
    this.changed(room);
  }

  reveal(code: string, user: Who, on: boolean) {
    const room = this.hostRoom(code, user);
    if (!room.dealt) throw new RoomError(400, "Deal the cards first.");
    room.revealed = on;
    this.changed(room);
  }

  /** Moves a player to the other group (the host keeps the groups true to the table). */
  move(code: string, user: Who, playerId: number) {
    const room = this.hostRoom(code, user);
    const p = room.players.find((x) => x.userId === playerId);
    if (!p || p.group === null) throw new RoomError(404, "That player is not in a group.");
    p.group = p.group === 0 ? 1 : 0;
    this.changed(room);
  }

  timer(code: string, user: Who, action: string) {
    const room = this.hostRoom(code, user);
    const t = room.timer;
    const now = this.now();
    switch (action) {
      case "start":
        if (t.endsAt === null) t.endsAt = now + (t.remaining > 0 ? t.remaining : this.roundMs(room, t.round));
        break;
      case "pause":
        if (t.endsAt !== null) t.remaining = Math.max(0, t.endsAt - now);
        t.endsAt = null;
        break;
      case "reset":
        t.endsAt = null;
        t.remaining = this.roundMs(room, t.round);
        break;
      case "next":
      case "prev": {
        const last = Math.max(0, room.config.rounds.length - 1);
        t.round = Math.min(last, Math.max(0, t.round + (action === "next" ? 1 : -1)));
        t.endsAt = null;
        t.remaining = this.roundMs(room, t.round);
        break;
      }
      default:
        throw new RoomError(400, "Unknown timer action.");
    }
    this.changed(room);
  }

  kick(code: string, user: Who, playerId: number) {
    const room = this.hostRoom(code, user);
    if (playerId === room.hostId) throw new RoomError(400, "The host can't remove themselves. Hand the room to someone else first.");
    if (room.dealt) throw new RoomError(400, "Collect the cards before removing anybody, or the deck no longer matches the table.");
    const gone = room.players.find((p) => p.userId === playerId);
    room.players = room.players.filter((p) => p.userId !== playerId);
    if (gone && !gone.test) room.kicked = [...(room.kicked ?? []), playerId];
    this.changed(room);
  }

  /** Lets the host back in somebody they removed. */
  unkick(code: string, user: Who, playerId: number) {
    const room = this.hostRoom(code, user);
    room.kicked = (room.kicked ?? []).filter((id) => id !== playerId);
    this.changed(room);
  }

  /**
   * Any player may take over a room whose host's phone has not been heard from for a while
   * (a flat battery mid-game), or the room would be stuck with nobody able to collect or reveal.
   */
  claimHost(code: string, user: Who) {
    const room = this.get(code);
    const me = this.player(room, user);
    if (room.hostId === me.userId) return;
    if (!this.away(room, room.hostId)) throw new RoomError(409, "The host is still here.");
    room.hostId = me.userId;
    this.changed(room);
  }

  private away(room: Room, userId: number) {
    const last = this.seen.get(`${room.code}:${userId}`);
    // Never seen since this server started counts from the start, not as away at once.
    return this.now() - (last ?? this.boot) > HOST_AWAY_MS;
  }

  /**
   * Adds pretend players, so somebody can try a setup alone: the host sees their cards and can
   * hold any of them up as if it were that player's phone.
   */
  addTestPlayers(code: string, user: Who, count: number) {
    const room = this.hostRoom(code, user);
    if (room.dealt) throw new RoomError(400, "Collect the cards before adding players.");
    const have = room.players.filter((p) => p.test).length;
    const n = Math.min(Math.max(1, Math.floor(Number(count) || 1)), MAX_TEST_PLAYERS - have, MAX_PLAYERS - room.players.length);
    if (n <= 0) throw new RoomError(409, have >= MAX_TEST_PLAYERS ? `A room can hold ${MAX_TEST_PLAYERS} test players.` : "This room is full.");
    let id = Math.min(0, ...room.players.map((p) => p.userId));
    let no = Math.max(0, ...room.players.filter((p) => p.test).map((p) => Number(p.name.replace(/\D/g, "")) || 0));
    for (let i = 0; i < n; i++) room.players.push({ userId: --id, name: `Test player ${++no}`, test: true, card: null, group: null });
    this.changed(room);
  }

  /** Takes every test player out (before a real game). */
  removeTestPlayers(code: string, user: Who) {
    const room = this.hostRoom(code, user);
    if (room.dealt) throw new RoomError(400, "Collect the cards before removing anybody, or the deck no longer matches the table.");
    room.players = room.players.filter((p) => !p.test);
    this.changed(room);
  }

  makeHost(code: string, user: Who, playerId: number) {
    const room = this.hostRoom(code, user);
    const p = room.players.find((x) => x.userId === playerId);
    if (!p) throw new RoomError(404, "No such player.");
    if (p.test) throw new RoomError(400, "A test player can't host: there is nobody holding that phone.");
    room.hostId = playerId;
    this.changed(room);
  }

  leave(code: string, user: Who) {
    const room = this.get(code);
    const me = this.player(room, user);
    if (room.dealt) throw new RoomError(400, "The cards are dealt. Ask the host to collect them first.");
    room.players = room.players.filter((p) => p.userId !== me.userId);
    const people = room.players.filter((p) => !p.test);
    if (people.length === 0) return this.drop(room.code); // nobody left but pretend players
    if (room.hostId === me.userId) room.hostId = people[0].userId;
    this.changed(room);
  }

  sweep() {
    const cutoff = this.now() - ROOM_TTL;
    for (const [code, room] of this.rooms) if (room.touched < cutoff) this.drop(code);
  }

  private drop(code: string) {
    this.rooms.delete(code);
    this.queue(code, () => this.store.deleteCardRoom(code));
    for (const fn of this.watchers.get(code) ?? []) fn();
  }

  private roundMs(room: Room, i: number) {
    const r = room.config.rounds[i];
    return r ? Math.round(r.minutes * 60_000) : 0;
  }

  private newPlayer(user: Who): Player {
    return { userId: user.id, name: user.username, card: null, group: null };
  }

  private get(code: string): Room {
    const room = this.rooms.get(String(code).toUpperCase());
    if (!room) throw new RoomError(404, "No room with that code. Check the letters with the host.");
    return room;
  }

  private player(room: Room, user: Who): Player {
    const p = room.players.find((x) => x.userId === user.id);
    if (!p) throw new RoomError(403, "You are not in this room. Join it with its code.");
    return p;
  }

  private hostRoom(code: string, user: Who): Room {
    const room = this.get(code);
    if (this.player(room, user).userId !== room.hostId) throw new RoomError(403, "Only the host can do that.");
    return room;
  }

  /** Every change: a new version for the phones, a write to the store, a ping to every watcher. */
  private changed(room: Room) {
    room.version += 1;
    room.touched = this.now();
    const snapshot = structuredClone(room);
    this.queue(room.code, () => this.store.saveCardRoom(room.code, snapshot));
    for (const fn of this.watchers.get(room.code) ?? []) fn();
  }

  /** Writes for one room go in order, so an older snapshot can never land after a newer one. */
  private queue(code: string, write: () => Promise<void>) {
    const next = (this.writes.get(code) ?? Promise.resolve())
      .then(write)
      .catch((e) => this.log(`Could not save card room ${code}: ${(e as Error).message}`));
    this.writes.set(code, next);
    next.finally(() => {
      if (this.writes.get(code) === next) this.writes.delete(code);
    });
  }

  /** Waits for every pending write (on shutdown, and in tests). */
  async flush() {
    await Promise.all(this.writes.values());
  }
}
