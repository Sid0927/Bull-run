/** HTTP routes. JSON in and out; live game updates over Server-Sent Events. */
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { Action } from "../src/engine/index.ts";
import type { AdminUser, Me } from "../src/shared/api.ts";
import { LoginLimiter, SESSION_DAYS, checkNewPassword, checkPassword, checkUsername, hashPassword, newToken } from "./auth.ts";
import { GameError, Hub } from "./hub.ts";
import type { Store, User } from "./store.ts";

export interface AppOptions {
  store: Store;
  /** Folder with the built app (vite build). Omit to serve the API only. */
  staticDir?: string;
  /** Mark the session cookie Secure (behind HTTPS in production). */
  secureCookies?: boolean;
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
  const log = opts.log ?? (() => {});

  const me = (u: User): Me => ({ id: u.id, username: u.username, isAdmin: u.isAdmin });
  const adminView = (u: User): AdminUser => ({ id: u.id, username: u.username, isAdmin: u.isAdmin, active: u.active, createdAt: u.createdAt });

  function cookieOf(req: IncomingMessage): string | null {
    const raw = req.headers.cookie ?? "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE) return decodeURIComponent(v.join("="));
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
    return u && u.active ? u : null;
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
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
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!opts.staticDir) return json(res, 404, { error: "Not found." });
    const safe = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, "");
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
      const username = String(b.username ?? "").trim();
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0];
      const keys = [`u:${username.toLowerCase()}`, `ip:${ip}`];
      if (limiter.blocked(...keys)) throw new HttpError(429, "Too many wrong passwords. Wait ten minutes and try again.");
      const u = await store.userByName(username);
      if (!u || !u.active || !(await checkPassword(String(b.password ?? ""), u.passwordHash))) {
        limiter.fail(...keys);
        throw new HttpError(401, "That username and password don't match.");
      }
      limiter.clear(...keys);
      const token = newToken();
      await store.createSession(token, u.id, new Date(Date.now() + SESSION_DAYS * 86400_000));
      setCookie(res, token, SESSION_DAYS * 86400);
      return json(res, 200, me(u));
    }
    if (path === "/api/logout" && method === "POST") {
      const token = cookieOf(req);
      if (token) await store.deleteSession(token);
      setCookie(res, "", 0);
      return json(res, 200, { ok: true });
    }

    const user = await userOf(req);
    if (!user) throw new HttpError(401, "Please sign in.");

    if (path === "/api/me" && method === "GET") return json(res, 200, me(user));
    if (path === "/api/me/password" && method === "POST") {
      const b = await body(req);
      if (!(await checkPassword(String(b.current ?? ""), user.passwordHash))) throw new HttpError(400, "Your current password is wrong.");
      const bad = checkNewPassword(String(b.next ?? ""));
      if (bad) throw new HttpError(400, bad);
      await store.updateUser(user.id, { passwordHash: await hashPassword(String(b.next)) });
      return json(res, 200, { ok: true });
    }

    // ── Admin ──
    if (path.startsWith("/api/admin/")) {
      if (!user.isAdmin) throw new HttpError(403, "Only the admin can do that.");
      if (path === "/api/admin/users" && method === "GET") return json(res, 200, (await store.listUsers()).map(adminView));
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
      const m = path.match(/^\/api\/admin\/users\/(\d+)$/);
      if (m && method === "POST") {
        const target = await store.userById(Number(m[1]));
        if (!target) throw new HttpError(404, "No such account.");
        const b = await body(req);
        if (b.password !== undefined) {
          const bad = checkNewPassword(String(b.password));
          if (bad) throw new HttpError(400, bad);
          await store.updateUser(target.id, { passwordHash: await hashPassword(String(b.password)) });
          await store.deleteSessionsFor(target.id); // signed out everywhere
        }
        if (b.active !== undefined) {
          if (target.id === user.id && b.active === false) throw new HttpError(400, "You can't switch off your own account.");
          await store.updateUser(target.id, { active: b.active === true });
          if (b.active === false) await store.deleteSessionsFor(target.id);
        }
        return json(res, 200, adminView((await store.userById(target.id))!));
      }
      if (path === "/api/admin/games" && method === "GET") {
        const games = await store.allGames();
        return json(res, 200, await Promise.all(games.map((g) => hub.summary(g, user.id))));
      }
      const ab = path.match(/^\/api\/admin\/games\/(\d+)\/abandon$/);
      if (ab && method === "POST") {
        await hub.abandon(Number(ab[1]));
        return json(res, 200, { ok: true });
      }
    }

    // ── Games ──
    if (path === "/api/games" && method === "GET") {
      const games = (await store.gamesFor(user.id)).filter((g) => g.status !== "abandoned");
      return json(res, 200, await Promise.all(games.map((g) => hub.summary(g, user.id))));
    }
    if (path === "/api/games" && method === "POST") {
      const b = await body(req);
      const g = await hub.create(user, Number(b.rounds ?? 9), Number(b.maxPlayers ?? 5));
      return json(res, 200, await hub.summary(g, user.id));
    }
    if (path === "/api/games/join" && method === "POST") {
      const b = await body(req);
      const g = await hub.join(user, String(b.code ?? ""));
      return json(res, 200, await hub.summary(g, user.id));
    }
    const gm = path.match(/^\/api\/games\/(\d+)\/(leave|start|action|stream)$/);
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
        const since = Math.max(0, Number(url.searchParams.get("since") ?? 0) || 0);
        await hub.mustSee(id, user); // refuse before the stream's headers go out
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 2000\n\n");
        const stop = await hub.watch(id, user, since, (u) => res.write(`data: ${JSON.stringify(u)}\n\n`));
        // A comment every 25s keeps proxies from closing a quiet connection.
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          stop();
        });
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
  if (users.some((u) => u.isAdmin)) return;
  const bad = checkUsername(username) ?? checkNewPassword(password);
  if (bad) throw new Error(`ADMIN_USERNAME / ADMIN_PASSWORD: ${bad}`);
  await store.createUser(username, await hashPassword(password), true);
  log(`Created the admin account "${username}".`);
}
