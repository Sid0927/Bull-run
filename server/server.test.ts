/** The server over real HTTP, with the in-memory store: accounts, rooms, privacy and a whole game. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { GameUpdate, GameSummary } from "../src/shared/api.ts";
import { STRATEGIES } from "../src/sim/strategies.ts";
import { Rng } from "../src/engine/rng.ts";
import { createApp, ensureAdmin } from "./app.ts";
import { MemoryStore, PgStore, type Store } from "./store.ts";

// TEST_DATABASE_URL runs the same tests against a real (empty) Postgres database.
const pgUrl = process.env.TEST_DATABASE_URL;

let base = "";
let close: () => void;

let store: Store;
before(async () => {
  store = pgUrl ? new PgStore(pgUrl) : new MemoryStore();
  await store.init();
  await ensureAdmin(store, "boss", "boss-password", () => {});
  const { server } = createApp({ store });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(async () => {
  close();
  await store.close();
});

class Client {
  cookie = "";
  async call(path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const data = await res.json();
    return { status: res.status, data };
  }
  async login(username: string, password: string) {
    return this.call("/api/login", { username, password });
  }
  /** Read one update from the game's live stream. */
  async snapshot(gameId: number): Promise<GameUpdate> {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/games/${gameId}/stream`, { headers: { Cookie: this.cookie }, signal: ctl.signal });
    const reader = res.body!.getReader();
    let buf = "";
    for (;;) {
      const { value } = await reader.read();
      buf += new TextDecoder().decode(value);
      const m = buf.match(/data: (.*)\n\n/);
      if (m) {
        ctl.abort();
        return JSON.parse(m[1]);
      }
    }
  }
}

const admin = new Client();
const players = ["asha", "bilal", "chitra"].map(() => new Client());

describe("accounts", () => {
  test("only the admin's accounts can sign in, and wrong passwords are refused", async () => {
    assert.equal((await admin.login("boss", "nope")).status, 401);
    assert.equal((await admin.login("boss", "boss-password")).status, 200);
    for (const [i, name] of ["asha", "bilal", "chitra"].entries()) {
      const r = await admin.call("/api/admin/users", { username: name, password: `${name}-pw1` });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal((await players[i].login(name, `${name}-pw1`)).status, 200);
    }
    assert.equal((await admin.call("/api/admin/users", { username: "asha", password: "whatever1" })).status, 409);
    assert.equal((await players[0].call("/api/admin/users")).status, 403);
    assert.equal((await new Client().call("/api/games")).status, 401);
  });

  test("the admin can reset a password, which signs that player out", async () => {
    const extra = new Client();
    const made = await admin.call("/api/admin/users", { username: "dev", password: "dev-pw-1" });
    await extra.login("dev", "dev-pw-1");
    assert.equal((await extra.call("/api/me")).status, 200);
    await admin.call(`/api/admin/users/${made.data.id}`, { password: "dev-pw-2" });
    assert.equal((await extra.call("/api/me")).status, 401);
    assert.equal((await extra.login("dev", "dev-pw-2")).status, 200);
    await admin.call(`/api/admin/users/${made.data.id}`, { active: false });
    assert.equal((await extra.call("/api/me")).status, 401);
    assert.equal((await extra.login("dev", "dev-pw-2")).status, 401);
  });
});

describe("a game played from three phones", () => {
  let game: GameSummary;

  test("create, join with the code, and start", async () => {
    game = (await players[0].call("/api/games", { rounds: 6, maxPlayers: 3 })).data;
    assert.match(game.code, /^[A-Z2-9]{5}$/);
    assert.equal((await players[0].call(`/api/games/${game.id}/start`, {})).status, 400); // not enough players
    assert.equal((await players[1].call("/api/games/join", { code: game.code.toLowerCase() })).status, 200);
    assert.equal((await players[1].call(`/api/games/${game.id}/start`, {})).status, 403); // only the creator
    assert.equal((await players[2].call("/api/games/join", { code: game.code })).status, 200);
    assert.equal((await admin.call("/api/games/join", { code: game.code })).status, 400); // full
    assert.equal((await players[0].call(`/api/games/${game.id}/start`, {})).status, 200);
  });

  test("each phone sees its own cash and cards and nobody else's", async () => {
    const [a, b] = await Promise.all([players[0].snapshot(game.id), players[1].snapshot(game.id)]);
    assert.equal(a.mySeat, 0);
    assert.equal(b.mySeat, 1);
    assert.ok(a.view!.players[0].hand.every((x) => x > 0));
    assert.ok(a.view!.players[1].hand.every((x) => x === 0));
    assert.ok(b.view!.players[1].hand.every((x) => x > 0));
    assert.equal(a.view!.config.seed, 0);
    assert.equal(a.view!.players[0].cash, 1000); // the final rules: ₹1,000 each
    assert.deepEqual(a.waiting, [0, 1, 2]);
  });

  test("a player cannot act for someone else's seat", async () => {
    const a = await players[0].snapshot(game.id);
    const card = a.view!.players[0].hand[0];
    // Claims seat 2, but the server uses the seat that belongs to this login.
    const r = await players[0].call(`/api/games/${game.id}/action`, { action: { type: "openingOrder", player: 2, orders: { HUL: 1 }, card } });
    assert.equal(r.status, 200);
    const again = await players[0].call(`/api/games/${game.id}/action`, { action: { type: "openingOrder", player: 0, orders: {}, card } });
    assert.equal(again.status, 400);
    const c = await players[2].snapshot(game.id);
    assert.ok(c.view!.phase.kind === "opening" && c.view!.phase.submissions[2] === null);
  });

  test("the whole game plays to the end through the API", async () => {
    const rng = new Rng(5);
    for (let guard = 0; guard < 2000; guard++) {
      const snaps = await Promise.all(players.map((p) => p.snapshot(game.id)));
      if (snaps[0].view!.phase.kind === "ended") break;
      const seat = snaps[0].waiting[0];
      const s = snaps[seat].view!;
      let done = false;
      for (const a of STRATEGIES.favour.candidates(s, seat, rng)) {
        if ((await players[seat].call(`/api/games/${game.id}/action`, { action: a })).status === 200) {
          done = true;
          break;
        }
      }
      assert.ok(done, `seat ${seat} found no legal action`);
    }
    const end = await players[1].snapshot(game.id);
    assert.equal(end.view!.phase.kind, "ended");
    assert.equal(end.game.status, "ended");
    assert.ok(end.view!.standings!.length === 3);
    // At the end everyone's cash is shown.
    assert.ok(end.view!.players.some((p) => p.cash > 0));
    const list = (await players[2].call("/api/games")).data as GameSummary[];
    assert.equal(list.find((g) => g.id === game.id)!.status, "ended");
  });

  test("outsiders cannot watch; the admin can", async () => {
    const outsider = new Client();
    const made = await admin.call("/api/admin/users", { username: "eve", password: "eve-pw-1" });
    assert.equal(made.status, 200);
    await outsider.login("eve", "eve-pw-1");
    const r = await fetch(`${base}/api/games/${game.id}/stream`, { headers: { Cookie: outsider.cookie } });
    assert.equal(r.status, 403);
    const watch = await admin.snapshot(game.id);
    assert.equal(watch.mySeat, null);
  });
});

describe("fixes from the security review", () => {
  test("no event reveals the seed, and round-end cash shows only your own until the end", async () => {
    // The finished game above shows everything; check a fresh game mid-play.
    const g: GameSummary = (await players[0].call("/api/games", { rounds: 6, maxPlayers: 3 })).data;
    await players[1].call("/api/games/join", { code: g.code });
    await players[2].call("/api/games/join", { code: g.code });
    await players[0].call(`/api/games/${g.id}/start`, {});
    const rng = new Rng(9);
    for (let i = 0; i < 40; i++) {
      const snap = await players[0].snapshot(g.id);
      const seat = snap.waiting[0];
      const s = (await players[seat].snapshot(g.id)).view!;
      for (const a of STRATEGIES.random.candidates(s, seat, rng)) if ((await players[seat].call(`/api/games/${g.id}/action`, { action: a })).status === 200) break;
    }
    const mine = await players[0].snapshot(g.id);
    assert.ok(mine.events.list.every((e) => !/seed/i.test(e.text)), "an event mentions the seed");
    const ends = mine.events.list.filter((e) => e.kind === "roundEnd");
    assert.ok(ends.length > 0);
    for (const e of ends) if (e.kind === "roundEnd") assert.deepEqual(e.cash.slice(1), [0, 0]);
    // Unknown action types and stray fields are refused or dropped, never stored.
    const junk = await players[mine.waiting[0]].call(`/api/games/${g.id}/action`, { action: { type: "nonsense", blob: "x".repeat(1000) } });
    assert.equal(junk.status, 400);
  });

  test("requests must be JSON (a cross-site form can't post to the game)", async () => {
    const r = await fetch(`${base}/api/games/join`, { method: "POST", headers: { "Content-Type": "text/plain", Cookie: players[0].cookie }, body: '{"code":"AAAAA"}' });
    assert.equal(r.status, 415);
  });

  test("a broken address or cookie is handled, not a server error", async () => {
    assert.notEqual((await fetch(`${base}/%E0%A4%A`)).status, 500);
    assert.equal((await fetch(`${base}/api/me`, { headers: { Cookie: "br_session=%E0%A4%A" } })).status, 401);
  });

  test("switching an account off ends its open game connection", async () => {
    const made = await admin.call("/api/admin/users", { username: "zed", password: "zed-pass1" });
    const zed = new Client();
    await zed.login("zed", "zed-pass1");
    const g: GameSummary = (await zed.call("/api/games", { rounds: 6, maxPlayers: 3 })).data;
    const res = await fetch(`${base}/api/games/${g.id}/stream`, { headers: { Cookie: zed.cookie } });
    const reader = res.body!.getReader();
    await reader.read(); // the first update
    await admin.call(`/api/admin/users/${made.data.id}`, { active: false });
    // Any push to the game now ends the stream; the admin starting nothing, so trigger one.
    await players[1].call("/api/games/join", { code: g.code });
    const ended = await Promise.race([
      (async () => {
        for (;;) {
          const { done } = await reader.read();
          if (done) return true;
        }
      })(),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ]);
    assert.equal(ended, true);
  });

  test("wrong passwords from one address don't lock the player out elsewhere", async () => {
    const attacker = new Client();
    for (let i = 0; i < 6; i++) {
      await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" }, body: JSON.stringify({ username: "bilal", password: "wrong" }) });
    }
    const blocked = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" }, body: JSON.stringify({ username: "bilal", password: "bilal-pw1" }) });
    assert.equal(blocked.status, 429);
    const fromHome = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.7" }, body: JSON.stringify({ username: "bilal", password: "bilal-pw1" }) });
    assert.equal(fromHome.status, 200);
    void attacker;
  });
});
