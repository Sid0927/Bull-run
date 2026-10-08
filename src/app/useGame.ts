/**
 * Holds a game as its record (config + actions) and the state derived from it. The record
 * is saved in localStorage, so a refresh resumes the game, and it can be downloaded and
 * replayed exactly.
 */
import { useCallback, useEffect, useState } from "react";
import { apply, newGame, replay, type Action, type GameConfig, type GameEvent, type GameRecord, type GameState } from "../engine/index.ts";

const KEY = "bull-run:record";

interface Live {
  record: GameRecord;
  state: GameState;
  events: GameEvent[];
}

function load(): Live | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as GameRecord;
    return { record, ...replay(record) };
  } catch {
    return null;
  }
}

export function useGame() {
  const [live, setLive] = useState<Live | null>(load);

  useEffect(() => {
    try {
      if (live) localStorage.setItem(KEY, JSON.stringify(live.record));
      else localStorage.removeItem(KEY);
    } catch {
      /* private window: the game still works, it just won't survive a refresh */
    }
  }, [live]);

  const start = useCallback((config: GameConfig) => {
    const g = newGame(config);
    setLive({ record: { config, actions: [] }, ...g });
  }, []);

  const loadRecord = useCallback((record: GameRecord) => setLive({ record, ...replay(record) }), []);

  /** Apply an action; returns the engine's refusal, or null if it was played. */
  const act = useCallback(
    (a: Action): string | null => {
      if (!live) return "No game";
      const r = apply(live.state, a);
      if (!r.ok) return r.error;
      setLive({ record: { ...live.record, actions: [...live.record.actions, a] }, state: r.state, events: [...live.events, ...r.events] });
      return null;
    },
    [live],
  );

  const undo = useCallback(() => {
    if (!live || live.record.actions.length === 0) return;
    const record = { ...live.record, actions: live.record.actions.slice(0, -1) };
    setLive({ record, ...replay(record) });
  }, [live]);

  const quit = useCallback(() => setLive(null), []);

  return { live, start, loadRecord, act, undo, quit };
}
