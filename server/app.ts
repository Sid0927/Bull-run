/** HTTP routes. JSON in and out; live game updates over Server-Sent Events. */
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { Action } from "../src/engine/index.ts";
import type { AdminUser, Me } from "../src/shared/api.ts";
import { DUMMY_HASH, LoginLimiter, SESSION_DAYS, checkNewPassword, checkPassword, checkUsername, hashPassword, newToken } from "./auth.ts";
import { GameError, Hub } from "./hub.ts";
import type { Store, User } from "./store.ts";

export interface AppOptions {
  store: Store;
  /** Folder with the built app (vite build). Omit to serve the API only. */
  staticDir?: string;
  /** Mark the session cookie Secure (behind HTTPS in production). */
  secureCookies?: boolean;
  /**
   * Behind a proxy that adds the caller's address to X-Forwarded-For (Render does). Without one,
   * that header is whatever the caller typed, so it is ignored.
   */
  trustProxy?: boolean;
  log?: (msg: string) => void;
}

const COOKIE = "br_session";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApp(opts: AppOptions): { server: Server; hub: Hub } {
  const { store } = opts;
  const hub = new Hub(store);
  const limiter = new LoginLimiter();
  const joinLimiter = new LoginLimiter(10);
  const ipLimiter = new LoginLimiter(30);
  const log = opts.log ?? (() => {});

  /** Render's proxy appends the real address as the last X-Forwarded-For entry; earlier ones are the client's to forge. */
  /** A plain description of the device a request came from, for the admin's sign-in history. */
  function deviceOf(req: IncomingMessage): string {
    const ua = String(req.headers["user-agent"] ?? "");
    const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
    const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
    return [os, browser].filter(Boolean).join(" · ") || "Unknown device";
  }

  const blockedNoted = new Map<string, number>();

  // Last-seen times are written at most every two minutes per person, not on every request.
  const touched = new Map<number, number>();
  function touch(userId: number) {
    const now = Date.now();
    if (now - (touched.get(userId) ?? 0) < 120_000) return;
    touched.set(userId, now);
    store.touchUser(userId).catch(() => {});
  }

  function clientIp(req: IncomingMessage): string {
    if (!opts.trustProxy) return req.socket.remoteAddress ?? "";
    const xff = String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    return xff.at(-1) ?? req.socket.remoteAddress ?? "";
  }

  /** Sign a user out everywhere, end their live games, and give this request a fresh session. */
  async function rotateSessions(res: ServerResponse | null, userId: number) {
    await store.deleteSessionsFor(userId);
    hub.disconnectUser(userId);
    if (res) {
      const token = newToken();
      await store.createSession(token, userId, new Date(Date.now() + SESSION_DAYS * 86400_000));
      setCookie(res, token, SESSION_DAYS * 86400);
    }
  }

  const me = (u: User): Me => ({ id: u.id, username: u.username, isAdmin: u.isAdmin });
  const adminView = (u: User, devices = 0): AdminUser => ({
    id: u.id,
    username: u.username,
    isAdmin: u.isAdmin,
    active: u.active,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    lastSeenAt: u.lastSeenAt,
    devices,
  });

  function cookieOf(req: IncomingMessage): string | null {
    const raw = req.headers.cookie ?? "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE) {
        try {
          return decodeURIComponent(v.join("="));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function setCookie(res: ServerResponse, token: string, maxAge: number) {
    const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
    if (opts.secureCookies) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  async function userOf(req: IncomingMessage): Promise<User | null> {
    const token = cookieOf(req);
    if (!token) return null;
    const u = await store.sessionUser(token);
    if (!u || !u.active) return null;
    touch(u.id);
    return u;
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "Requests must be JSON.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) throw new HttpError(413, "Request too large.");
      chunks.push(c as Buffer);
    }
    if (!chunks.length) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return v && typeof v === "object" ? v : {};
    } catch {
      throw new HttpError(400, "That request was not valid JSON.");
    }
  }

  function json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(data));
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!opts.staticDir) return json(res, 404, { error: "Not found." });
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      decoded = "/";
    }
    const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    let file = join(opts.staticDir, safe);
    try {
      if (!(await stat(file)).isFile()) throw new Error();
    } catch {
      file = join(opts.staticDir, "index.html"); // the app handles its own screens
    }
    try {
      const data = await readFile(file);
      const immutable = file.includes(`${join(opts.staticDir, "assets")}`);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...(extname(file) === ".html"
          ? {
              // Only this site's own scripts; the fonts come from Google; no framing by other sites.
              "Content-Security-Policy":
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
              "Referrer-Policy": "same-origin",
            }
          : {}),
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      json(res, 404, { error: "Not found." });
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (!path.startsWith("/api/")) return serveStatic(req, res, path);

    if (path === "/api/health") return json(res, 200, { ok: true });

    // ── Sign in ──
    if (path === "/api/login" && method === "POST") {
      const b = await body(req);
      const username = String(b.username ?? "").trim().slice(0, 64);
      const ip = clientIp(req);
      // 5 tries per name from one address (so a stranger can't lock a player out), and a looser
      // cap per address that a success doesn't reset (a table on one Wi-Fi shares an address).
      const keys = [`u:${username.toLowerCase()}|${ip}`];
      const attempt = async (result: "ok" | "wrong" | "blocked" | "off", userId: number | null) =>
        store.recordLogin({ userId, username: username.slice(0, 40) || "(blank)", result, device: deviceOf(req) }).catch(() => {});
      if (limiter.blocked(...keys) || ipLimiter.blocked(`ip:${ip}`)) {
        // One "blocked" line per name and address every ten minutes, so a flood of guesses can't
        // bury the real sign-ins in the history.
        const key = `${username.toLowerCase()}|${ip}`;
        if (Date.now() - (blockedNoted.get(key) ?? 0) > 600_000) {
          blockedNoted.set(key, Date.now());
          if (blockedNoted.size > 5000) blockedNoted.clear();
          await attempt("blocked", null);
        }
        throw new HttpError(429, "Too many wrong passwords. Wait ten minutes and try again.");
      }
      limiter.fail(...keys); // counted before checking, so parallel guesses can't slip past
      ipLimiter.fail(`ip:${ip}`);
      const u = await store.userByName(username);
      // Always do the slow hash, so the time taken doesn't reveal whether the name exists.
      const ok = await checkPassword(String(b.password ?? "").slice(0, 200), u?.passwordHash ?? DUMMY_HASH);
      if (!u || !u.active || !ok) {
        await attempt(u && ok ? "off" : "wrong", u?.id ?? null);
        throw new HttpError(401, "That username and password don't match.");
      }
      await attempt("ok", u.id);
      limiter.clear(...keys);
      const token = newToken();
      await store.createSession(token, u.id, new Date(Date.now() + SESSION_DAYS * 86400_000));
      setCookie(res, token, SESSION_DAYS * 86400);
      return json(res, 200, me(u));
    }
    if (path === "/api/logout" && method === "POST") {
      const token = cookieOf(req);
      if (token) {
        await store.deleteSession(token);
        hub.disconnectToken(token);
      }
      setCookie(res, "", 0);
      return json(res, 200, { ok: true });
    }

    const user = await userOf(req);
    if (!user) throw new HttpError(401, "Please sign in.");

    if (path === "/api/me" && method === "GET") return json(res, 200, me(user));
    if (path === "/api/me/password" && method === "POST") {
      const b = await body(req);
      const key = `pw:${user.id}`;
      if (limiter.blocked(key)) throw new HttpError(429, "Too many wrong passwords. Wait ten minutes and try again.");
      if (!(await checkPassword(String(b.current ?? "").slice(0, 200), user.passwordHash))) {
        limiter.fail(key);
        throw new HttpError(400, "Your current password is wrong.");
      }
      limiter.clear(key);
      const bad = checkNewPassword(String(b.next ?? ""));
      if (bad) throw new HttpError(400, bad);
      await store.updateUser(user.id, { passwordHash: await hashPassword(String(b.next)) });
      await rotateSessions(res, user.id); // other phones signed in as you are signed out
      return json(res, 200, { ok: true });
    }

    // ── Admin ──
    if (path.startsWith("/api/admin/")) {
      if (!user.isAdmin) throw new HttpError(403, "Only the admin can do that.");
      if (path === "/api/admin/users" && method === "GET") {
        const counts = await store.sessionCounts();
        return json(res, 200, (await store.listUsers()).map((u) => adminView(u, counts.get(u.id) ?? 0)));
      }
      if (path === "/api/admin/logins" && method === "GET") return json(res, 200, await store.logins(200));
      if (path === "/api/admin/users" && method === "POST") {
        const b = await body(req);
        const username = String(b.username ?? "").trim();
        const bad = checkUsername(username) ?? checkNewPassword(String(b.password ?? ""));
        if (bad) throw new HttpError(400, bad);
        if (await store.userByName(username)) throw new HttpError(409, `There is already an account called ${username}.`);
        const u = await store.createUser(username, await hashPassword(String(b.password)), b.isAdmin === true);
        log(`admin ${user.username} created ${u.username}`);
        return json(res, 200, adminView(u));
      }
      const m = path.match(/^\/api\/admin\/users\/(\d{1,9})$/);
      if (m && method === "POST") {
        const target = await store.userById(Number(m[1]));
        if (!target) throw new HttpError(404, "No such account.");
        const b = await body(req);
        if (b.password !== undefined && typeof b.password !== "string") throw new HttpError(400, "A password must be text.");
        if (b.active !== undefined && typeof b.active !== "boolean") throw new HttpError(400, "Switch on or off with true or false.");
        if (b.password !== undefined) {
          const bad = checkNewPassword(String(b.password));
          if (bad) throw new HttpError(400, bad);
          await store.updateUser(target.id, { passwordHash: await hashPassword(String(b.password)) });
          await rotateSessions(target.id === user.id ? res : null, target.id); // signed out everywhere
        }
        if (b.active !== undefined) {
          if (target.id === user.id && b.active === false) throw new HttpError(400, "You can't switch off your own account.");
          await store.updateUser(target.id, { active: b.active === true });
          if (b.active === false) await rotateSessions(null, target.id);
        }
        return json(res, 200, adminView((await store.userById(target.id))!));
      }
      if (path === "/api/admin/games" && method === "GET") {
        const games = await store.allGames();
        return json(res, 200, await Promise.all(games.map((g) => hub.summary(g, user.id))));
      }
      const ab = path.match(/^\/api\/admin\/games\/(\d{1,9})\/abandon$/);
      if (ab && method === "POST") {
        await hub.abandon(Number(ab[1]));
        return json(res, 200, { ok: true });
      }
    }

    // ── Games ──
    if (path === "/api/games" && method === "GET") {
      const games = await store.gamesFor(user.id);
      return json(res, 200, await Promise.all(games.map((g) => hub.summary(g, user.id))));
    }
    if (path === "/api/games" && method === "POST") {
      const b = await body(req);
      const g = await hub.create(user, Number(b.rounds ?? 9), Number(b.maxPlayers ?? 5));
      return json(res, 200, await hub.summary(g, user.id));
    }
    if (path === "/api/games/join" && method === "POST") {
      const b = await body(req);
      const key = `join:${user.id}`;
      if (joinLimiter.blocked(key)) throw new HttpError(429, "Too many wrong codes. Wait ten minutes and try again.");
      const g = await hub.join(user, String(b.code ?? "")).catch((e) => {
        if (e instanceof GameError && e.status === 404) joinLimiter.fail(key);
        throw e;
      });
      return json(res, 200, await hub.summary(g, user.id));
    }
    const gm = path.match(/^\/api\/games\/(\d{1,9})\/(leave|start|action|stream)$/);
    if (gm) {
      const id = Number(gm[1]);
      if (gm[2] === "leave" && method === "POST") {
        await hub.leave(user, id);
        return json(res, 200, { ok: true });
      }
      if (gm[2] === "start" && method === "POST") {
        await hub.start(user, id);
        return json(res, 200, { ok: true });
      }
      if (gm[2] === "action" && method === "POST") {
        const b = await body(req);
        if (!b.action || typeof b.action !== "object") throw new HttpError(400, "No action given.");
        await hub.act(user, id, b.action as Action);
        return json(res, 200, { ok: true });
      }
      if (gm[2] === "stream" && method === "GET") {
        // Listen for the phone going away before anything is awaited, or a connection dropped
        // while it was opening would never be cleaned up.
        let closed = false;
        let stop: (() => void) | null = null;
        let ping: ReturnType<typeof setInterval> | null = null;
        req.on("close", () => {
          closed = true;
          if (ping) clearInterval(ping);
          stop?.();
        });
        const since = Number(url.searchParams.get("since") ?? 0);
        await hub.mustSee(id, user); // refuse before the stream's headers go out
        if (closed) return;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 2000\n\n");
        const alive = () => !closed && !res.destroyed && !res.writableEnded;
        stop = await hub.watch(id, user, cookieOf(req) ?? "", since, {
          send: (u) => {
            if (alive()) res.write(`data: ${JSON.stringify(u)}\n\n`);
          },
          end: () => {
            if (alive()) res.end();
          },
          alive,
        });
        if (!alive()) {
          stop();
          return;
        }
        // A comment every 25s keeps proxies from closing a quiet connection.
        ping = setInterval(() => {
          if (alive()) res.write(": ping\n\n");
        }, 25_000);
        return;
      }
    }
    throw new HttpError(404, "Not found.");
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e instanceof HttpError || e instanceof GameError ? e.status : 500;
      if (status === 500) log(`error: ${(e as Error).stack ?? e}`);
      if (res.headersSent) return res.end();
      json(res, status, { error: status === 500 ? "Something went wrong on the server." : (e as Error).message });
    });
  });
  return { server, hub };
}

/** Make sure there is an admin account to sign in with. */
export async function ensureAdmin(store: Store, username: string, password: string, log: (m: string) => void) {
  const users = await store.listUsers();
  if (users.some((u) => u.isAdmin && u.active)) return;
  const bad = checkUsername(username) ?? checkNewPassword(password);
  if (bad) throw new Error(`ADMIN_USERNAME / ADMIN_PASSWORD: ${bad}`);
  // No admin can sign in: bring the configured one back (switched on, with the configured password).
  const existing = await store.userByName(username);
  if (existing) {
    await store.updateUser(existing.id, { active: true, isAdmin: true, passwordHash: await hashPassword(password) });
    log(`Restored the admin account "${username}".`);
    return;
  }
  await store.createUser(username, await hashPassword(password), true);
  log(`Created the admin account "${username}".`);
}
