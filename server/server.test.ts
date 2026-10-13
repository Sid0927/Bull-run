/** The server over real HTTP, with the in-memory store: accounts, rooms, privacy and a whole game. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { GameUpdate, GameSummary } from "../src/shared/api.ts";
import { STRATEGIES } from "../src/sim/strategies.ts";
import { Rng } from "../src/engine/rng.ts";
import { createApp, ensureAdmin } from "./app.ts";
import { MemoryStore, PgStore, type Store } from "./store.ts";
import { recordingMailer } from "./mail.ts";

// TEST_DATABASE_URL runs the same tests against a real (empty) Postgres database.
const pgUrl = process.env.TEST_DATABASE_URL;

let base = "";
let close: () => void;

let store: Store;
const mail = recordingMailer();
before(async () => {
  store = pgUrl ? new PgStore(pgUrl) : new MemoryStore();
  await store.init();
  await ensureAdmin(store, "boss", "boss-password", () => {});
  const { server } = createApp({ store, trustProxy: true, botDelayMs: 5, mailer: mail, appUrl: "https://bullrun.test" });
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
    // The admin is not in this game, so sees every desk; a player sees only their own.
    const boss = await admin.snapshot(g.id);
    assert.equal(boss.revealed, true);
    assert.ok(boss.view!.players.every((p) => p.hand.every((x) => x > 0)));
    assert.ok(boss.view!.players.some((p, i) => i > 0 && p.cash > 0));
    assert.equal(boss.view!.config.seed, 0);
    assert.equal(mine.revealed, false);
    assert.ok(mine.view!.players.slice(1).every((p) => p.cash === 0 && p.hand.every((x) => x === 0)));
    // Every event comes with the time of the move that caused it.
    assert.equal(mine.events.times.length, mine.events.list.length);
    assert.ok(mine.events.times.every((t) => t !== null && !Number.isNaN(Date.parse(t))));
    const listed = ((await admin.call("/api/admin/games")).data as GameSummary[]).find((x) => x.id === g.id)!;
    assert.ok(listed.startedAt && listed.lastMoveAt && listed.waitingFor.length > 0);
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

  test("the admin sees every sign-in, failed ones included, and when each player was last on", async () => {
    await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1", "X-Forwarded-For": "198.51.100.40" }, body: JSON.stringify({ username: "chitra", password: "nope-nope" }) });
    await players[2].login("chitra", "chitra-pw1");
    const log = (await admin.call("/api/admin/logins")).data as { username: string; result: string; device: string }[];
    assert.ok(log.some((l) => l.username === "chitra" && l.result === "wrong" && l.device === "iPhone · Safari"));
    assert.ok(log.some((l) => l.username === "chitra" && l.result === "ok"));
    assert.ok(!JSON.stringify(log).includes("nope-nope"), "a password was recorded");
    const users = (await admin.call("/api/admin/users")).data as { username: string; lastLoginAt: string | null; devices: number }[];
    const c = users.find((u) => u.username === "chitra")!;
    assert.ok(c.lastLoginAt && c.devices >= 1);
    assert.equal((await players[0].call("/api/admin/logins")).status, 403);
    // A flood of guesses leaves one "blocked" line per name and address, not hundreds.
    for (let i = 0; i < 25; i++)
      await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.77" }, body: JSON.stringify({ username: "flood", password: "x" }) });
    const after = (await admin.call("/api/admin/logins")).data as { username: string; result: string }[];
    assert.equal(after.filter((l) => l.username === "flood" && l.result === "blocked").length, 1);
  });

  test("the admin can't lock themselves out, and odd values are refused", async () => {
    const me = (await admin.call("/api/me")).data as { id: number };
    assert.equal((await admin.call(`/api/admin/users/${me.id}`, { active: "no" })).status, 400);
    assert.equal((await admin.call(`/api/admin/users/${me.id}`, { password: { x: 1 } })).status, 400);
    assert.equal((await admin.call("/api/me")).status, 200);
    assert.equal((await admin.call("/api/admin/users/99999999999", { active: true })).status, 404);
    assert.equal((await players[0].call("/api/games/99999999999/leave", {})).status, 404);
  });

  test("a player can't pile up games nobody has joined", async () => {
    const solo = new Client();
    await admin.call("/api/admin/users", { username: "solo", password: "solo-pass1" });
    await solo.login("solo", "solo-pass1");
    for (let i = 0; i < 5; i++) assert.equal((await solo.call("/api/games", { rounds: 6, maxPlayers: 3 })).status, 200);
    assert.equal((await solo.call("/api/games", { rounds: 6, maxPlayers: 3 })).status, 429);
  });

  test("signing out ends that phone's live game connection", async () => {
    const g: GameSummary = (await players[0].call("/api/games", { rounds: 6, maxPlayers: 3 })).data;
    const p = new Client();
    await p.login("asha", "asha-pw1");
    const res = await fetch(`${base}/api/games/${g.id}/stream`, { headers: { Cookie: p.cookie } });
    const reader = res.body!.getReader();
    await reader.read();
    await p.call("/api/logout", {});
    const ended = await Promise.race([
      (async () => {
        for (;;) if ((await reader.read()).done) return true;
      })(),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ]);
    assert.equal(ended, true);
    await players[0].call(`/api/games/${g.id}/leave`, {});
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

describe("the admin swaps a player", () => {
  test("a seat goes to another account mid-game, with everything it holds", async () => {
    const g: GameSummary = (await players[0].call("/api/games", { rounds: 6, maxPlayers: 3 })).data;
    await players[1].call("/api/games/join", { code: g.code });
    await players[2].call("/api/games/join", { code: g.code });
    assert.equal((await players[0].call(`/api/games/${g.id}/start`, {})).status, 200);
    // Everyone writes an opening order, so the seat has shares and a card face-down.
    for (const [i, p] of players.entries()) {
      const v = (await p.snapshot(g.id)).view!;
      assert.equal((await p.call(`/api/games/${g.id}/action`, { action: { type: "openingOrder", player: i, orders: { HUL: 1 }, card: v.players[i].hand[0] } })).status, 200);
    }
    const before = (await admin.snapshot(g.id)).view!.players[1];

    assert.equal((await admin.call("/api/admin/users", { username: "Sid", password: "sid-pass-1" })).status, 200);
    const sid = new Client();
    await sid.login("Sid", "sid-pass-1");
    // Only the admin may swap; nobody can be put in twice.
    assert.equal((await players[0].call(`/api/admin/games/${g.id}/seat`, { seat: 1, username: "Sid" })).status, 403);
    assert.equal((await admin.call(`/api/admin/games/${g.id}/seat`, { seat: 1, username: "chitra" })).status, 400);
    assert.equal((await admin.call(`/api/admin/games/${g.id}/seat`, { seat: 1, username: "nobody" })).status, 404);
    const r = await admin.call(`/api/admin/games/${g.id}/seat`, { seat: 1, username: "sid" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { from: "bilal", to: "Sid" });

    const mine = await sid.snapshot(g.id);
    assert.equal(mine.mySeat, 1);
    const now = mine.view!.players[1];
    assert.equal(now.name, "Sid");
    assert.equal(now.cash, before.cash);
    assert.deepEqual(now.shares, before.shares);
    assert.deepEqual(now.hand, before.hand);
    assert.ok(mine.events.list.some((e) => e.text.includes("Sid")));
    assert.ok(!mine.events.list.some((e) => e.text.includes("bilal")));
    // Bilal is out: the game is no longer theirs to watch or play.
    const old = await fetch(`${base}/api/games/${g.id}/stream`, { headers: { Cookie: players[1].cookie } });
    assert.equal(old.status, 403);
    assert.ok(!((await players[1].call("/api/games")).data as GameSummary[]).some((x) => x.id === g.id));
    // And Sid plays on from where Bilal left off.
    const live = await sid.snapshot(g.id);
    assert.ok(live.waiting.length > 0);
    await admin.call(`/api/admin/games/${g.id}/abandon`, {});
  });
});

describe("computer players", () => {
  test("two people and a computer player play a game to the end", async () => {
    const [a, b] = [players[0], players[2]]; // asha and chitra
    const g: GameSummary = (await a.call("/api/games", { rounds: 6, maxPlayers: 3 })).data;
    await b.call("/api/games/join", { code: g.code });
    assert.equal((await a.call(`/api/games/${g.id}/start`, {})).status, 400); // only two
    assert.equal((await b.call(`/api/games/${g.id}/add-bot`, {})).status, 403); // only the host
    assert.equal((await a.call(`/api/games/${g.id}/add-bot`, {})).status, 200);
    assert.equal((await a.call(`/api/games/${g.id}/add-bot`, {})).status, 400); // full
    const lobby = await a.snapshot(g.id);
    const bot = lobby.seats.find((s) => s.isBot)!;
    assert.equal(bot.username, "Kabir (bot)");
    // The bot can't be signed in to, and isn't listed with the accounts.
    assert.equal((await new Client().login("Kabir (bot)", "bot")).status, 401);
    assert.ok(!((await admin.call("/api/admin/users")).data as { username: string }[]).some((u) => u.username.includes("(bot)")));
    // Removed and added back.
    assert.equal((await a.call(`/api/games/${g.id}/remove-bot`, { seat: 0 })).status, 404); // not a bot
    assert.equal((await a.call(`/api/games/${g.id}/remove-bot`, { seat: bot.seat })).status, 200);
    assert.equal((await a.snapshot(g.id)).seats.length, 2);
    assert.equal((await a.call(`/api/games/${g.id}/add-bot`, {})).status, 200);
    assert.equal((await a.call(`/api/games/${g.id}/start`, {})).status, 200);

    const people = [a, b];
    const rng = new Rng(9);
    let botMoved = false;
    for (let guard = 0; guard < 3000; guard++) {
      const snaps = await Promise.all(people.map((p) => p.snapshot(g.id)));
      const s0 = snaps[0];
      if (s0.view!.phase.kind === "ended") break;
      const who = people.findIndex((_, i) => s0.waiting.includes(snaps[i].mySeat!));
      if (who < 0) {
        // Only the computer player is up: it moves by itself.
        botMoved = true;
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      const seat = snaps[who].mySeat!;
      let done = false;
      for (const act of STRATEGIES.favour.candidates(snaps[who].view!, seat, rng)) {
        if ((await people[who].call(`/api/games/${g.id}/action`, { action: act })).status === 200) {
          done = true;
          break;
        }
      }
      assert.ok(done);
    }
    const end = await a.snapshot(g.id);
    assert.equal(end.view!.phase.kind, "ended");
    assert.ok(botMoved);
    assert.ok(end.events.list.some((e) => e.text.includes("Kabir (bot)")));
    assert.equal(end.view!.standings!.length, 3);
  });
});

describe("signing up", () => {
  const signup = (body: unknown, ip = "192.0.2.50") =>
    fetch(`${base}/api/signup`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body) });

  test("anyone can make an account with an email, then sign in with either", async () => {
    assert.deepEqual((await new Client().call("/api/config")).data, { openSignup: true, mail: true });
    const r = await signup({ email: "Neha@Example.com", username: "neha", password: "neha-pass" });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(((await me.json()) as { username: string }).username, "neha");
    // Signed in straight away, and can create a game like anyone else.
    const c = new Client();
    c.cookie = cookie;
    assert.equal((await c.call("/api/games", { rounds: 6, maxPlayers: 3 })).status, 200);
    // Either the email (any case) or the name works to sign in.
    assert.equal((await new Client().login("neha@example.COM", "neha-pass")).status, 200);
    assert.equal((await new Client().login("NEHA", "neha-pass")).status, 200);
    assert.equal((await new Client().login("neha@example.com", "wrong-pass")).status, 401);
    // The admin sees the account and its email.
    const users = (await admin.call("/api/admin/users")).data as { username: string; email?: string }[];
    assert.equal(users.find((u) => u.username === "neha")?.email, "Neha@Example.com");
  });

  test("a taken email or name, or a bad one, is refused", async () => {
    assert.equal((await signup({ email: "neha@example.com", username: "neha2", password: "neha-pass" })).status, 409);
    assert.equal((await signup({ email: "other@example.com", username: "Neha", password: "neha-pass" })).status, 409);
    assert.equal((await signup({ email: "other@example.com", username: "asha", password: "x-pass-1" })).status, 409);
    assert.equal((await signup({ email: "not-an-email", username: "okname", password: "ok-pass-1" })).status, 400);
    assert.equal((await signup({ email: "a@b.co", username: "Kabir (bot)", password: "ok-pass-1" })).status, 400);
    assert.equal((await signup({ email: "a@b.co", username: "okname", password: "123" })).status, 400);
  });

  test("one address can't make accounts without limit", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await signup({ email: `p${i}@flood.test`, username: `flood${i}`, password: "flood-pass" }, "198.51.100.200")).status);
    assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(codes[6], 429);
  });

  test("sign-up can be switched off", async () => {
    const { server } = createApp({ store, trustProxy: true, openSignup: false });
    await new Promise<void>((r) => server.listen(0, r));
    const other = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.deepEqual(await (await fetch(`${other}/api/config`)).json(), { openSignup: false, mail: false });
    const r = await fetch(`${other}/api/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "z@z.zz", username: "zzz", password: "zzz-pass" }) });
    assert.equal(r.status, 403);
    server.close();
  });
});

describe("confirming emails", () => {
  const linkTo = async (email: string) => {
    for (let i = 0; i < 50 && !mail.sent.some((m) => m.to === email); i++) await new Promise((r) => setTimeout(r, 10));
    const m = [...mail.sent].reverse().find((x) => x.to === email);
    assert.ok(m, `an email went to ${email}`);
    const link = m.text.match(/https:\/\/bullrun\.test\/#\/verify\/([A-Za-z0-9_-]+)/);
    assert.ok(link, m.text);
    return link[1];
  };
  const verify = (token: string) => fetch(`${base}/api/verify-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });

  test("signing up sends a link, and the link confirms the address once", async () => {
    const r = await fetch(`${base}/api/signup`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.77" }, body: JSON.stringify({ email: "kiran@example.com", username: "kiran", password: "kiran-pass" }) });
    assert.equal(r.status, 200);
    const c = new Client();
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await c.call("/api/me")).data.emailVerified, false);
    const token = await linkTo("kiran@example.com");
    // Opened on another device, signed out: still works, once.
    const ok = await verify(token);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { email: string }).email, "kiran@example.com");
    assert.equal((await verify(token)).status, 400);
    assert.equal((await verify("not-a-real-token-at-all")).status, 400);
    assert.equal((await c.call("/api/me")).data.emailVerified, true);
    const users = (await admin.call("/api/admin/users")).data as { username: string; emailVerified?: boolean }[];
    assert.equal(users.find((u) => u.username === "kiran")?.emailVerified, true);
  });

  test("an older account adds its email; changing it later needs the password", async () => {
    const c = new Client();
    await c.login("chitra", "chitra-pw1");
    assert.equal((await c.call("/api/me")).data.email, null);
    assert.equal((await c.call("/api/me/email", { email: "nope" })).status, 400);
    assert.equal((await c.call("/api/me/email", { email: "kiran@example.com" })).status, 409); // someone else's
    const added = await c.call("/api/me/email", { email: "chitra@example.com" });
    assert.equal(added.status, 200);
    assert.equal(added.data.email, "chitra@example.com");
    assert.equal(added.data.emailVerified, false);
    assert.equal((await verify(await linkTo("chitra@example.com"))).status, 200);
    assert.equal((await c.call("/api/me")).data.emailVerified, true);
    // Signing in with the new email works too.
    assert.equal((await new Client().login("CHITRA@example.com", "chitra-pw1")).status, 200);
    // A different address needs the password, and starts unconfirmed.
    assert.equal((await c.call("/api/me/email", { email: "c2@example.com", password: "wrong" })).status, 400);
    const changed = await c.call("/api/me/email", { email: "c2@example.com", password: "chitra-pw1" });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.emailVerified, false);
    // An old link for the previous address no longer confirms anything.
    const resent = await c.call("/api/me/email/resend", {});
    assert.equal(resent.status, 200);
    assert.equal((await verify(await linkTo("c2@example.com"))).status, 200);
    // Asking again and again is capped.
    await c.call("/api/me/email", { email: "c3@example.com", password: "chitra-pw1" });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await c.call("/api/me/email/resend", {})).status);
    assert.ok(codes.includes(429), codes.join(","));
  });
});
