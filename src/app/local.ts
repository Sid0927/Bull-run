/**
 * A practice game that runs entirely in the browser: you against computer players, with the same
 * engine and the same screen as an online game, but no server and nothing saved. It feeds the game
 * screen the same updates the server would, so what you practise on is what you play on.
 */
import { apply, newGame, type Action, type GameEvent, type GameState, type Seat } from "../engine/index.ts";
import { Rng } from "../engine/rng.ts";
import type { GameUpdate } from "../shared/api.ts";
import { eventsFor, viewFor, waitingOn } from "../shared/view.ts";
import { STRATEGIES, type Strategy } from "../sim/strategies.ts";

export interface GameSource {
  follow(onUpdate: (u: GameUpdate) => void, onStatus: (connected: boolean) => void, onRefused: (status: number, message: string) => void): () => void;
  act(a: Action): Promise<void>;
}

const BOTS = ["Asha", "Bilal", "Chitra", "Dev"];
/** A mix of styles, so the table doesn't all play the same way. */
const STYLES: Strategy[] = [STRATEGIES.favour, STRATEGIES.dividend, STRATEGIES.follower, STRATEGIES.random];
/** How long a computer player "thinks", so you can watch what each one did. */
const TURN_MS = 1100;
const SEALED_MS = 400;

export function localGame(you: string, players: number, rounds: 6 | 9 | 12): GameSource {
  const seed = (Math.random() * 2 ** 31) | 0;
  const names = [you, ...BOTS.filter((b) => b.toLowerCase() !== you.toLowerCase()).slice(0, players - 1)];
  const start = newGame({ players: names, rounds, seed });
  let state: GameState = start.state;
  const events: GameEvent[] = [...start.events];
  const times: (string | null)[] = start.events.map(() => new Date().toISOString());
  const rng = new Rng(seed ^ 0x2f6b);
  const startedAt = new Date().toISOString();
  let listener: ((u: GameUpdate) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const update = (): GameUpdate => {
    const ended = state.phase.kind === "ended";
    const waiting = ended ? [] : waitingOn(state);
    return {
      game: {
        id: 0,
        code: "PRACTICE",
        status: ended ? "ended" : "playing",
        rounds,
        maxPlayers: players,
        createdBy: you,
        players: names,
        yourMove: waiting.includes(0),
        round: state.round,
        waitingFor: waiting.map((s) => names[s]),
        createdAt: startedAt,
        startedAt,
        endedAt: ended ? new Date().toISOString() : null,
        lastMoveAt: times[times.length - 1] ?? null,
      },
      seats: names.map((n, seat) => ({ seat, username: n })),
      mySeat: 0,
      revealed: false,
      view: viewFor(state, 0),
      events: { from: 0, list: eventsFor(events, 0, ended), times: [...times] },
      waiting,
    };
  };

  const record = (next: GameState, evs: GameEvent[]) => {
    state = next;
    const now = new Date().toISOString();
    events.push(...evs);
    times.push(...evs.map(() => now));
    listener?.(update());
    schedule();
  };

  /** If a computer player is up, let them move after a pause. */
  const schedule = () => {
    if (timer || state.phase.kind === "ended") return;
    const bot = waitingOn(state).find((s) => s !== 0);
    if (bot === undefined) return;
    const sealed = state.phase.kind === "opening" || state.phase.kind === "ipo";
    timer = setTimeout(() => {
      timer = null;
      botMove(bot);
    }, sealed ? SEALED_MS : TURN_MS);
  };

  const botMove = (seat: Seat) => {
    if (!listener || !waitingOn(state).includes(seat)) return schedule();
    for (const a of STYLES[(seat - 1) % STYLES.length].candidates(state, seat, rng)) {
      const r = apply(state, a);
      if (r.ok) return record(r.state, r.events);
    }
    console.error(`Practice: ${names[seat]} had no legal move`);
  };

  return {
    follow(onUpdate, onStatus) {
      listener = onUpdate;
      onStatus(true);
      onUpdate(update());
      schedule();
      return () => {
        listener = null;
        if (timer) clearTimeout(timer);
        timer = null;
      };
    },
    act(a) {
      if (a.player !== 0) return Promise.reject(new Error("That isn't your seat."));
      const r = apply(state, a);
      if (!r.ok) return Promise.reject(new Error(r.error));
      record(r.state, r.events);
      return Promise.resolve();
    },
  };
}
