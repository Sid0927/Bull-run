/**
 * A game record is its config (which holds the seed) plus the list of actions taken.
 * Replaying it always reproduces the same game.
 */
import { apply, newGame } from "./engine.ts";
import type { Action, GameConfig, GameEvent, GameState } from "./types.ts";

export interface GameRecord {
  config: GameConfig;
  actions: Action[];
}

export function replay(record: GameRecord): { state: GameState; events: GameEvent[] } {
  let { state, events } = newGame(record.config);
  events = [...events];
  record.actions.forEach((a, i) => {
    const r = apply(state, a);
    if (!r.ok) throw new Error(`Action ${i + 1} (${a.type}) is illegal on replay: ${r.error}`);
    state = r.state;
    events.push(...r.events);
  });
  return { state, events };
}
