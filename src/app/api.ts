/** Talking to the game server (same site, so the sign-in cookie goes along). */
import type { Action } from "../engine/index.ts";
import type { AdminUser, GameSummary, GameUpdate, Me } from "../shared/api.ts";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Can't reach the game server. Check your connection; if the server was asleep it can take half a minute to wake.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `The server said ${res.status}.`);
  return data as T;
}

export const api = {
  me: () => call<Me>("/api/me"),
  login: (username: string, password: string) => call<Me>("/api/login", { username, password }),
  logout: () => call<{ ok: true }>("/api/logout", {}),
  changePassword: (current: string, next: string) => call<{ ok: true }>("/api/me/password", { current, next }),
  games: () => call<GameSummary[]>("/api/games"),
  create: (rounds: number, maxPlayers: number) => call<GameSummary>("/api/games", { rounds, maxPlayers }),
  join: (code: string) => call<GameSummary>("/api/games/join", { code }),
  leave: (id: number) => call<{ ok: true }>(`/api/games/${id}/leave`, {}),
  start: (id: number) => call<{ ok: true }>(`/api/games/${id}/start`, {}),
  act: (id: number, action: Action) => call<{ ok: true }>(`/api/games/${id}/action`, { action }),
  users: () => call<AdminUser[]>("/api/admin/users"),
  createUser: (username: string, password: string, isAdmin: boolean) => call<AdminUser>("/api/admin/users", { username, password, isAdmin }),
  updateUser: (id: number, patch: { password?: string; active?: boolean }) => call<AdminUser>(`/api/admin/users/${id}`, patch),
  allGames: () => call<GameSummary[]>("/api/admin/games"),
  abandon: (id: number) => call<{ ok: true }>(`/api/admin/games/${id}/abandon`, {}),
};

/**
 * Follow a game live. Reconnects by itself (a phone locking its screen or a server waking up
 * drops the connection) and asks only for the events it hasn't got.
 */
export function follow(gameId: number, onUpdate: (u: GameUpdate) => void, onStatus: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let have = 0;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const open = () => {
    if (stopped) return;
    es = new EventSource(`/api/games/${gameId}/stream?since=${have}`);
    es.onopen = () => onStatus(true);
    es.onmessage = (m) => {
      const u = JSON.parse(m.data) as GameUpdate;
      have = u.events.from + u.events.list.length;
      onUpdate(u);
    };
    es.onerror = () => {
      onStatus(false);
      es?.close();
      if (!stopped) retry = setTimeout(open, 2000);
    };
  };
  open();
  // Coming back to the tab is the moment a phone's connection is most likely stale.
  const onVisible = () => {
    if (document.visibilityState === "visible" && es?.readyState !== EventSource.OPEN) {
      es?.close();
      if (retry) clearTimeout(retry);
      open();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    es?.close();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
