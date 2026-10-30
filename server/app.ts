/** HTTP routes. JSON in and out; live game updates over Server-Sent Events. */
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { Action } from "../src/engine/index.ts";
import type { AdminUser, Me } from "../src/shared/api.ts";
import { DUMMY_HASH, LoginLimiter, SESSION_DAYS, checkNewPassword, checkPassword, checkUsername, hashPassword, newToken } from "./auth.ts";
import { GameError, Hub } from "./hub.ts";
import { CardRooms, RoomError } from "./cards.ts";
import type { Store, User } from "./store.ts";
import { createHash } from "node:crypto";
import { mailerFromEnv, type Mailer } from "./mail.ts";

export interface AppOptions {
  /** Sends the confirmation emails (default: none, the link is logged). */
  mailer?: Mailer;
  /** The site's address for links in emails, e.g. https://bull-run.onrender.com (default: from the request). */
  appUrl?: string;
  /** Let anyone create an account with an email (default). False: only the admin makes accounts. */
  openSignup?: boolean;
  /** Override how long computer players pause before moving (tests). */
  botDelayMs?: number;
  store: Store;
  /** Undercover rooms (made here if not given; the server passes one it has read back from the store). */
  cards?: CardRooms;
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

export function createApp(opts: AppOptions): { server: Server; hub: Hub; cards: CardRooms } {
  const { store } = opts;
  const hub = new Hub(store, { botDelayMs: opts.botDelayMs });
  const cards = opts.cards ?? new CardRooms(store, opts.log);
  const limiter = new LoginLimiter();
  const joinLimiter = new LoginLimiter(10);
  const codeLimiter = new LoginLimiter(30);
  const ipLimiter = new LoginLimiter(30);
  // New accounts from one address: a few at a time is a family on one Wi-Fi; more is a script.
  const signupLimiter = new LoginLimiter(5);
  const openSignup = opts.openSignup !== false;
  const log = opts.log ?? (() => {});
  const mailer = opts.mailer ?? mailerFromEnv({}, log);
  const mailLimiter = new LoginLimiter(3);
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  function siteUrl(req: IncomingMessage): string {
    if (opts.appUrl) return opts.appUrl.replace(/\/+$/, "");
    const proto = opts.trustProxy ? String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim() : "http";
    return `${proto}://${req.headers.host ?? "localhost"}`;
  }

  /** Email a one-time link that confirms the address belongs to this player. Never fails the request. */
  async function sendConfirmation(u: User, email: string, req: IncomingMessage) {
    try {
      const token = newToken();
      await store.saveEmailToken(sha256(token), u.id, email, new Date(Date.now() + 3 * 86400_000));
      const link = `${siteUrl(req)}/#/verify/${token}`;
      const text = `Hi ${u.username},\n\nConfirm this email for your Sid's Arcade account by opening this link:\n${link}\n\nThe link works for 3 days. If you didn't sign up for Sid's Arcade, you can ignore this email.`;
      const html = `<p>Hi ${escapeHtml(u.username)},</p><p>Confirm this email for your Sid's Arcade account:</p><p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#0b7a4b;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Confirm my email</a></p><p style="color:#666;font-size:13px">Or open this link: ${link}<br>It works for 3 days. If you didn't sign up for Sid's Arcade, you can ignore this email.</p>`;
      await mailer.send(email, "Confirm your email for Sid's Arcade", text, html);
    } catch (e) {
      log(`Could not send the confirmation email to ${email}: ${(e as Error).message}`);
    }
  }

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

  const me = (u: User): Me => ({ id: u.id, username: u.username, isAdmin: u.isAdmin, email: u.email ?? null, emailVerified: !!u.emailVerifiedAt });
  const adminView = (u: User, devices = 0): AdminUser => ({
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    emailVerified: !!u.emailVerifiedAt,
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
      // A missing build file is a 404, not the app: a tab from before a deploy then reloads cleanly
      // instead of trying to run a web page as a script.
      if (safe.replace(/\\/g, "/").startsWith("/assets/")) return json(res, 404, { error: "Not found." });
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
              ...(opts.secureCookies ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
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
    if (path === "/api/config" && method === "GET") return json(res, 200, { openSignup, mail: mailer.live });

    // ── The link in the confirmation email (works signed out, on any device) ──
    if (path === "/api/verify-email" && method === "POST") {
      const b = await body(req);
      const token = String(b.token ?? "").slice(0, 200);
      const t = token ? await store.takeEmailToken(sha256(token)) : null;
      if (!t || t.expiresAt.getTime() < Date.now()) throw new HttpError(400, "This link has expired or was already used. Sign in and ask for a new one.");
      if (!(await store.confirmEmail(t.userId, t.email))) throw new HttpError(400, "That email is no longer the one on the account.");
      return json(res, 200, { ok: true, email: t.email });
    }

    // ── Sign up ──
    if (path === "/api/signup" && method === "POST") {
      if (!openSignup) throw new HttpError(403, "New accounts are made by the game's admin.");
      const b = await body(req);
      const email = String(b.email ?? "").trim().slice(0, 254);
      const username = String(b.username ?? "").trim();
      const password = String(b.password ?? "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That doesn't look like an email address.");
      const bad = checkUsername(username) ?? checkNewPassword(password);
      if (bad) throw new HttpError(400, bad);
      const ip = clientIp(req);
      if (signupLimiter.blocked(`ip:${ip}`)) throw new HttpError(429, "Too many new accounts from here. Wait ten minutes and try again.");
      if (await store.userByEmail(email)) throw new HttpError(409, "There is already an account with that email. Sign in instead.");
      if (await store.userByName(username)) throw new HttpError(409, `The name ${username} is taken. Pick another.`);
      let u: User;
      try {
        u = await store.createUser(username, await hashPassword(password), false, email);
      } catch (e) {
        // Two sign-ups racing for the same name or email: the database's unique index decides.
        if ((e as { code?: string }).code === "23505") throw new HttpError(409, "That name or email was just taken. Try another.");
        throw e;
      }
      signupLimiter.fail(`ip:${ip}`);
      await store.recordLogin({ userId: u.id, username: u.username, result: "ok", device: deviceOf(req) }).catch(() => {});
      log(`${u.username} signed up`);
      void sendConfirmation(u, email, req);
      const token = newToken();
      await store.createSession(token, u.id, new Date(Date.now() + SESSION_DAYS * 86400_000));
      setCookie(res, token, SESSION_DAYS * 86400);
      return json(res, 200, me(u));
    }

    // ── Sign in ──
    if (path === "/api/login" && method === "POST") {
      const b = await body(req);
      const username = String(b.username ?? "").trim().slice(0, 254);
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
      // Either the player name or, for accounts made by signing up, the email.
      const u = username.includes("@") ? await store.userByEmail(username) : await store.userByName(username);
      // Always do the slow hash, so the time taken doesn't reveal whether the name exists.
      const ok = await checkPassword(String(b.password ?? "").slice(0, 200), u?.passwordHash ?? DUMMY_HASH);
      if (!u || !u.active || u.isBot || !ok) {
        await attempt(u && ok ? "off" : "wrong", u?.id ?? null);
        // Accounts the admin made have no email until the player adds one, so a player trying
        // theirs gets told to use their name instead (without saying whether the email exists).
        throw new HttpError(
          401,
          username.includes("@")
            ? "That email and password don't match. If the admin made your account, sign in with your player name; you can add your email once you're in."
            : "That player name and password don't match.",
        );
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
    // Add an email (accounts the admin made have none), or change it. Changing needs the password,
    // so somebody at an unlocked phone can't move the account to their own address.
    if (path === "/api/me/email" && method === "POST") {
      const b = await body(req);
      const email = String(b.email ?? "").trim().slice(0, 254);
      if (!emailOk(email)) throw new HttpError(400, "That doesn't look like an email address.");
      if (user.email && user.email.toLowerCase() !== email.toLowerCase()) {
        const key = `pw:${user.id}`;
        if (limiter.blocked(key)) throw new HttpError(429, "Too many wrong passwords. Wait ten minutes and try again.");
        if (!(await checkPassword(String(b.password ?? "").slice(0, 200), user.passwordHash))) {
          limiter.fail(key);
          throw new HttpError(400, "Your password is needed to change your email, and that one doesn't match.");
        }
      }
      const other = await store.userByEmail(email);
      if (other && other.id !== user.id) throw new HttpError(409, "Another account already uses that email.");
      try {
        await store.setEmail(user.id, email);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new HttpError(409, "Another account already uses that email.");
        throw e;
      }
      const now = (await store.userById(user.id))!;
      if (!now.emailVerifiedAt && !mailLimiter.blocked(`mail:${user.id}`)) {
        mailLimiter.fail(`mail:${user.id}`);
        void sendConfirmation(now, email, req);
      }
      return json(res, 200, me(now));
    }
    if (path === "/api/me/email/resend" && method === "POST") {
      if (!user.email) throw new HttpError(400, "Add an email first.");
      if (user.emailVerifiedAt) return json(res, 200, me(user));
      if (mailLimiter.blocked(`mail:${user.id}`)) throw new HttpError(429, "A few emails have gone out already. Check your spam folder, or wait ten minutes and try again.");
      mailLimiter.fail(`mail:${user.id}`);
      await sendConfirmation(user, user.email, req);
      return json(res, 200, me(user));
    }
    // A crash on someone's screen, so it shows up in the server log instead of only as a blank page.
    if (path === "/api/client-error" && method === "POST") {
      const b = await body(req);
      const key = `err:${user.id}`;
      if (!limiter.blocked(key)) {
        limiter.fail(key);
        const clip = (x: unknown, n: number) => String(x ?? "").replace(/[\r\n]+/g, " | ").slice(0, n);
        console.error(`Screen error for ${user.username} at ${clip(b.where, 100)}: ${clip(b.message, 300)} :: ${clip(b.stack, 1500)}`);
      }
      return json(res, 200, { ok: true });
    }
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
        const email = String(b.email ?? "").trim().slice(0, 254);
        if (!emailOk(email)) throw new HttpError(400, "Every account needs an email address.");
        const bad = checkUsername(username) ?? checkNewPassword(String(b.password ?? ""));
        if (bad) throw new HttpError(400, bad);
        if (await store.userByName(username)) throw new HttpError(409, `There is already an account called ${username}.`);
        if (await store.userByEmail(email)) throw new HttpError(409, `There is already an account with ${email}.`);
        const u = await store.createUser(username, await hashPassword(String(b.password)), b.isAdmin === true, email);
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
      const sw = path.match(/^\/api\/admin\/games\/(\d{1,9})\/seat$/);
      if (sw && method === "POST") {
        const b = await body(req);
        const seat = Number(b.seat);
        if (!Number.isInteger(seat) || seat < 0 || seat > 9 || typeof b.username !== "string") throw new HttpError(400, "Say which seat and which account.");
        return json(res, 200, await hub.replaceSeat(user, Number(sw[1]), seat, b.username.slice(0, 40)));
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
    // ── Undercover (secret role cards) ──
    if (path === "/api/cards/rooms" && method === "GET") return json(res, 200, cards.mine(user));
    if (path === "/api/cards/rooms" && method === "POST") return json(res, 200, { code: cards.create(user) });
    const cm = path.match(/^\/api\/cards\/rooms\/([A-Za-z]{5})(?:\/([a-z]+))?$/);
    if (cm) {
      const code = cm[1].toUpperCase();
      const what = cm[2] ?? "";
      // Wrong codes count against the account, so live codes can't be found by trying them all.
      const guessKey = `cards:${user.id}`;
      if ((what === "" || what === "join") && codeLimiter.blocked(guessKey)) throw new HttpError(429, "Too many wrong room codes. Wait ten minutes and try again.");
      try {
        return await cardRoute(code, what, user);
      } catch (e) {
        if (e instanceof RoomError && e.status === 404 && (what === "" || what === "join")) codeLimiter.fail(guessKey);
        throw e;
      }
    }
    async function cardRoute(code: string, what: string, user: User) {
      if (method === "GET" && what === "") return json(res, 200, cards.view(code, user));
      if (method === "GET" && what === "events") {
        let stop: (() => void) | null = null;
        let ping: ReturnType<typeof setInterval> | null = null;
        const alive = () => !res.destroyed && !res.writableEnded;
        const send = () => {
          if (!alive()) return;
          try {
            res.write(`data: ${cards.view(code, user).version}\n\n`);
          } catch {
            res.write("event: gone\ndata: {}\n\n");
            end();
          }
        };
        const end = () => {
          stop?.();
          if (ping) clearInterval(ping);
          if (alive()) res.end();
        };
        stop = cards.watch(code, user, send); // refuses a stranger before the stream opens
        req.on("close", end);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write("retry: 2000\n\n");
        send();
        ping = setInterval(() => alive() && res.write(": ping\n\n"), 25_000);
        return;
      }
      if (method !== "POST") throw new HttpError(405, "Not allowed.");
      const b = await body(req);
      const pid = Number(b.playerId);
      switch (what) {
        case "join":
          cards.join(code, user);
          break;
        case "config":
          cards.setConfig(code, user, b.config);
          break;
        case "deal":
          cards.deal(code, user, b.again === true);
          break;
        case "collect":
          cards.collect(code, user);
          break;
        case "reveal":
          cards.reveal(code, user, b.on !== false);
          break;
        case "timer":
          cards.timer(code, user, String(b.action ?? ""));
          break;
        case "kick":
          cards.kick(code, user, pid);
          break;
        case "host":
          cards.makeHost(code, user, pid);
          break;
        case "claim":
          cards.claimHost(code, user);
          break;
        case "unkick":
          cards.unkick(code, user, pid);
          break;
        case "tests":
          if (b.remove === true) cards.removeTestPlayers(code, user);
          else cards.addTestPlayers(code, user, Number(b.count ?? 1));
          break;
        case "leave":
          cards.leave(code, user);
          return json(res, 200, { ok: true });
        default:
          throw new HttpError(404, "Not found.");
      }
      return json(res, 200, cards.view(code, user));
    }

    const gm = path.match(/^\/api\/games\/(\d{1,9})\/(leave|start|action|stream|add-bot|remove-bot)$/);
    if (gm) {
      const id = Number(gm[1]);
      if (gm[2] === "leave" && method === "POST") {
        await hub.leave(user, id);
        return json(res, 200, { ok: true });
      }
      if (gm[2] === "add-bot" && method === "POST") {
        await hub.addBot(user, id);
        return json(res, 200, { ok: true });
      }
      if (gm[2] === "remove-bot" && method === "POST") {
        const b = await body(req);
        const seat = Number(b.seat);
        if (!Number.isInteger(seat) || seat < 0 || seat > 9) throw new HttpError(400, "Say which seat.");
        await hub.removeBot(user, id, seat);
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
        // Signed out or switched off while this was opening: the disconnect missed it, so end it here.
        const still = alive() && (await store.sessionUser(cookieOf(req) ?? ""));
        if (!alive() || !still || still.id !== user.id) {
          stop();
          if (alive()) res.end();
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
      const status = e instanceof HttpError || e instanceof GameError || e instanceof RoomError ? e.status : 500;
      if (status === 500) log(`error: ${(e as Error).stack ?? e}`);
      if (res.headersSent) return res.end();
      json(res, status, { error: status === 500 ? "Something went wrong on the server." : (e as Error).message });
    });
  });
  const sweeper = setInterval(() => cards.sweep(), 10 * 60_000);
  sweeper.unref();
  server.on("close", () => clearInterval(sweeper));
  return { server, hub, cards };
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
