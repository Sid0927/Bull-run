/** Passwords (scrypt, salted) and session tokens. No third-party auth: the admin issues accounts. */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt64, key64] = stored.split("$");
  if (kind !== "scrypt" || !salt64 || !key64) return false;
  const want = Buffer.from(key64, "base64");
  const got = await scrypt(password, Buffer.from(salt64, "base64"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Checked against when the username doesn't exist, so a wrong name takes as long as a wrong password. */
export const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export const SESSION_DAYS = 30;

/** Usernames are what players type to log in: short, no spaces, no lookalike characters. */
export function checkUsername(name: string): string | null {
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(name)) return "Usernames are 3–24 letters, digits, dots, dashes or underscores.";
  return null;
}

export function checkNewPassword(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 6) return "Passwords need at least 6 characters.";
  if (pw.length > 200) return "That password is too long.";
  return null;
}

/** Slows down guessing: after 5 failed logins for a name or address in 10 minutes, refuse for a while. */
export class LoginLimiter {
  private fails = new Map<string, number[]>();
  private windowMs = 10 * 60 * 1000;
  constructor(private limit = 5) {}
  blocked(...keys: string[]): boolean {
    const now = Date.now();
    return keys.some((k) => (this.fails.get(k) ?? []).filter((t) => now - t < this.windowMs).length >= this.limit);
  }
  fail(...keys: string[]) {
    const now = Date.now();
    for (const k of keys) this.fails.set(k, [...(this.fails.get(k) ?? []).filter((t) => now - t < this.windowMs), now]);
    if (this.fails.size > 10_000) this.sweep(now);
  }
  private sweep(now: number) {
    for (const [k, ts] of this.fails) if (!ts.some((t) => now - t < this.windowMs)) this.fails.delete(k);
  }
  clear(...keys: string[]) {
    for (const k of keys) this.fails.delete(k);
  }
}
