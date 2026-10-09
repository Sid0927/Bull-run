/**
 * Starts the Bull Run game server.
 *
 *   DATABASE_URL    Postgres connection string (Neon). Without it, everything is kept in memory
 *                   and lost on restart: fine for trying it out, not for real games.
 *   ADMIN_USERNAME  The admin account created on first start, if there is no admin yet.
 *   ADMIN_PASSWORD
 *   PORT            Defaults to 3000.
 */
import { fileURLToPath } from "node:url";
import { createApp, ensureAdmin } from "./app.ts";
import { MemoryStore, PgStore } from "./store.ts";

const log = (m: string) => console.log(`[bull-run] ${m}`);
const production = process.env.NODE_ENV === "production";
const url = process.env.DATABASE_URL;

if (production && !url) {
  console.error("DATABASE_URL is not set. Games and accounts would be lost on every restart, so the server will not start in production without it.");
  process.exit(1);
}

const store = url ? new PgStore(url) : new MemoryStore();
await store.init();

const adminUser = process.env.ADMIN_USERNAME ?? (production ? "" : "admin");
const adminPass = process.env.ADMIN_PASSWORD ?? (production ? "" : "admin123");
if (!adminUser || !adminPass) {
  if (!(await store.listUsers()).some((u) => u.isAdmin)) {
    console.error("Set ADMIN_USERNAME and ADMIN_PASSWORD so the first admin account can be created.");
    process.exit(1);
  }
} else await ensureAdmin(store, adminUser, adminPass, log);

const staticDir = fileURLToPath(new URL("../dist", import.meta.url));
const { server } = createApp({ store, staticDir, secureCookies: production, log });
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => log(`Listening on port ${port}${url ? "" : " (memory store: nothing is saved)"}`));

// Last line of defence: log a stray failure rather than let it take every game down with the server.
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));
