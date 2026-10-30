/** Talking to the Hidden Hand routes. The session cookie says who is asking. */
import type { CardRoomSummary, Config, RoomView } from "../../cards/types.ts";

export class CardsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/cards${path}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CardsError(0, "Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) location.reload(); // signed out elsewhere: back to the sign-in screen
  if (!res.ok) throw new CardsError(res.status, data.error ?? "Something went wrong.");
  return data as T;
}

type TimerAction = "start" | "pause" | "reset" | "next" | "prev";
const post = (code: string, what: string, body: unknown = {}) => call<RoomView>("POST", `/rooms/${code}/${what}`, body);

export const cardsApi = {
  mine: () => call<CardRoomSummary[]>("GET", "/rooms"),
  create: () => call<{ code: string }>("POST", "/rooms", {}),
  view: (code: string) => call<RoomView>("GET", `/rooms/${code}`),
  join: (code: string) => post(code, "join"),
  config: (code: string, config: Config) => post(code, "config", { config }),
  deal: (code: string) => post(code, "deal"),
  collect: (code: string) => post(code, "collect"),
  reveal: (code: string, on: boolean) => post(code, "reveal", { on }),
  timer: (code: string, action: TimerAction) => post(code, "timer", { action }),
  move: (code: string, playerId: number) => post(code, "move", { playerId }),
  kick: (code: string, playerId: number) => post(code, "kick", { playerId }),
  host: (code: string, playerId: number) => post(code, "host", { playerId }),
  leave: (code: string) => call<{ ok: true }>("POST", `/rooms/${code}/leave`, {}),
  events: (code: string) => new EventSource(`/api/cards/rooms/${code}/events`),
};
