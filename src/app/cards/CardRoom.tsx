/** One room: the waiting room before the deal, then this phone's card, the timer and the host's tools. */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildDeck, deckSummary } from "../../cards/deck.ts";
import { CARDS_NAME, MAX_TEST_PLAYERS, SHOW_LABELS, type Card, type Config, type PlayerView, type RoomView } from "../../cards/types.ts";
import type { Me } from "../../shared/api.ts";
import { Avatar, Icon } from "../ui.tsx";
import { CardsError, cardsApi } from "./api.ts";
import { CardBack, CardFace, ShowScreen, teamOf, teamStyle } from "./CardArt.tsx";
import { Setup } from "./Setup.tsx";

/** The room, kept fresh by the server's change pings (with a slow poll in case the stream drops). */
function useRoom(code: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  const offset = useRef(0);
  const wasIn = useRef(false);
  const take = useCallback((v: RoomView) => {
    wasIn.current = true;
    offset.current = v.serverNow - Date.now();
    // An older view never replaces a newer one, except across a restart, when versions start again.
    setView((old) => (old && old.boot === v.boot && old.version > v.version ? old : v));
    setError(null);
  }, []);
  const load = useCallback(
    () =>
      cardsApi.view(code).then(take, (e: CardsError) => {
        if (e.status !== 404) return setError({ status: e.status, text: e.message });
        // Not in it (the server says so the same way as "no such room"). The first time, a shared
        // link joins by itself. After having been in it, the room closed or the host removed this
        // player: joining would say which, but must never quietly put them back.
        if (wasIn.current) {
          return cardsApi.join(code).then(
            take,
            (j: CardsError) => setError({ status: j.status === 403 ? 403 : 404, text: j.status === 403 ? j.message : "This room has closed." }),
          );
        }
        return cardsApi.join(code).then(take, (j: CardsError) => setError({ status: j.status, text: j.message }));
      }),
    [code, take],
  );
  // Out of the room (closed, or removed): stop the stream and the poll, or a dead tab keeps asking.
  const out = error !== null && (error.status === 403 || error.status === 404);
  const inRoom = view !== null && !out;
  const [stream, setStream] = useState(0);
  useEffect(() => {
    if (!inRoom) return;
    let es: EventSource | null = null;
    let retry = 0;
    try {
      es = cardsApi.events(code);
      es.onmessage = () => load();
      es.addEventListener("gone", () => load());
      // A refused reconnect (the server restarting behind a proxy) closes it for good: open a new one.
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) retry = window.setTimeout(() => setStream((n) => n + 1), 3000);
      };
    } catch {
      /* no stream: the poll carries it */
    }
    return () => {
      window.clearTimeout(retry);
      es?.close();
    };
  }, [code, inRoom, load, stream]);
  useEffect(() => {
    if (out) return;
    load();
    const t = setInterval(load, 20_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, load, out]);
  return { view, error, take, load, offset };
}

/** Keeps the screen awake while the cards are out, where the browser allows it. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<Lock> } }).wakeLock;
    if (!on || !wl) return;
    let lock: Lock | null = null;
    let live = true;
    const get = () =>
      wl.request("screen").then(
        (l) => (live ? (lock = l) : void l.release()),
        () => {},
      );
    get();
    const again = () => document.visibilityState === "visible" && get();
    document.addEventListener("visibilitychange", again);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", again);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

export function CardRoom({ code, me, go }: { code: string; me: Me; go: (hash: string) => void }) {
  const { view, error, take, offset } = useRoom(code);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useWakeLock(!!view?.dealt);

  const act = async (f: () => Promise<RoomView | { ok: true }>, done?: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const v = await f();
      if ("code" in v) take(v);
      if (done) setNote({ ok: true, text: done });
      return true;
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && (!view || error.status === 403 || error.status === 404))
    return (
      <main className="page hh">
        <div className="empty-state">
          <Icon name="cards" size={36} />
          <h1 className="page-title">{error.status === 404 ? (view ? "This room has closed" : "Room not found") : "Can't open this room"}</h1>
          <p>{error.text}</p>
          <a className="button primary" href="#/cards">
            Back to {CARDS_NAME}
          </a>
        </div>
      </main>
    );
  if (!view)
    return (
      <main className="page hh">
        <div className="hh-loading">
          <CardBack />
        </div>
      </main>
    );

  if (editing && view.host && !view.dealt)
    return (
      <main className="page hh">
        <Setup
          initial={view.config}
          players={view.players.length}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (c) => {
            if (await act(() => cardsApi.config(code, c), "Setup saved.")) setEditing(false);
          }}
        />
        {note && !note.ok && (
          <p className="error banner hh-float-note" role="alert">
            {note.text}
          </p>
        )}
      </main>
    );

  const host = view.players.find((p) => p.host);
  return (
    <main className={`page hh hh-room ${view.dealt ? "dealt" : ""}`}>
      <RoomHead view={view} />
      {note && (
        <p className={note.ok ? "notice" : "error banner"} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      )}
      {view.hostAway && (
        <div className="notice hh-host-away" role="status">
          <span>
            <b>{host?.name ?? "The host"}</b> hasn't been seen for a while. If their phone has gone, someone can take over.
          </span>
          <button disabled={busy} onClick={() => act(() => cardsApi.claimHost(code), "You're the host now.")}>
            <Icon name="crown" size={16} /> Take over
          </button>
        </div>
      )}
      {view.revealed ? (
        <RevealBoard view={view} />
      ) : view.dealt ? (
        <Dealt view={view} me={me} />
      ) : (
        <Waiting view={view} hostName={host?.name ?? ""} onEdit={() => setEditing(true)} />
      )}
      {view.host && view.dealt && !view.revealed && view.players.some((p) => p.test) && <TestCards view={view} />}
      {view.dealt && view.config.rounds.length > 0 && <Countdown view={view} offset={offset.current} busy={busy} act={act} />}
      {view.config.notes.trim() && <HouseRules notes={view.config.notes} open={!view.dealt} />}
      <Players view={view} act={act} busy={busy} />
      {view.host || (view.canReveal && view.dealt) ? <HostBar view={view} act={act} busy={busy} /> : null}
      {!view.dealt && (
        <button
          className="ghost-link danger-text hh-leave"
          disabled={busy}
          onClick={() => {
            if (confirm("Leave this room?")) act(() => cardsApi.leave(code)).then((ok) => ok && go("#/cards"));
          }}
        >
          <Icon name="out" size={16} /> Leave room
        </button>
      )}
    </main>
  );
}

function RoomHead({ view }: { view: RoomView }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/#/cards/${view.code}`;
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      await nav.share({ title: view.config.title || CARDS_NAME, text: `Join my ${CARDS_NAME} room: ${view.code}`, url: link }).catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <section className="hh-roomhead">
      <a href="#/cards" className="icon-btn" aria-label={`Back to ${CARDS_NAME}`}>
        <Icon name="back" />
      </a>
      <div className="hh-roomhead-title">
        <p className="eyebrow">{view.dealt ? (view.revealed ? "Cards revealed" : `Deal ${view.deal}`) : "Waiting room"}</p>
        <h1 className="truncate">{view.config.title || CARDS_NAME}</h1>
      </div>
      <button className="hh-code" onClick={share} aria-label={`Room code ${view.code}. Share the room`}>
        <span className="ticket-label">{copied ? "Link copied" : "Room"}</span>
        <span className="game-code">{view.code}</span>
        <Icon name="share" size={16} />
      </button>
    </section>
  );
}

/* ── Before the deal ──────────────────────────────────────────────────────────── */

function Waiting({ view, hostName, onEdit }: { view: RoomView; hostName: string; onEdit: () => void }) {
  const c = view.config;
  const n = view.players.length;
  const summary = deckSummary(c, n);
  const fits = "cards" in buildDeck(c, n);
  return (
    <>
      <section className="hh-waiting">
        <div className="hh-waiting-cards" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {view.host ? (
          <>
            <h2>Everyone in?</h2>
            <p className="muted">
              Share the code <b className="hh-inline-code">{view.code}</b> and deal when the table is ready.
            </p>
          </>
        ) : (
          <>
            <h2>
              Waiting for {hostName} to deal<span className="dots" aria-hidden="true"><i /><i /><i /></span>
            </h2>
            <p className="muted">Your card will appear here. Keep this screen open.</p>
          </>
        )}
      </section>
      <section className="panel hh-setup-card">
        <div className="hh-section-head">
          <h2>
            <Icon name="cards" /> The deck
          </h2>
          {view.host && (
            <button className="ghost-link" onClick={onEdit}>
              <Icon name="gear" size={18} /> Edit setup
            </button>
          )}
        </div>
        <p className={fits || n < 2 ? "muted small" : "error small"}>{n < 2 ? "The deck is worked out once more players join." : summary}</p>
        {/* Every side's goal, before the deal: nobody should pick up a card not knowing what each side is after. */}
        <ul className="hh-sides">
          {c.teams.map((t) => (
            <li key={t.id} style={teamStyle(t)}>
              <span className="hh-side-name">
                <span className="hh-dot" aria-hidden="true" /> {t.name}
              </span>
              <span className={t.goal ? "hh-side-goal" : "hh-side-goal muted"}>{t.goal || (t.fills ? "No goal written yet." : "Each plays for the goal on their own card.")}</span>
            </li>
          ))}
        </ul>
        {c.roles.filter((r) => r.count > 0).length > 0 && (
          <ul className="hh-role-list">
            {/* One row per role, with a dot for each side holding it: two Leaders read as one role. */}
            {[...new Set(c.roles.filter((r) => r.count > 0).map((r) => r.libId))].map((libId) => {
              const held = c.roles.filter((r) => r.libId === libId && r.count > 0);
              const r = held[0];
              return (
                <li key={libId}>
                  <span className="hh-role-dots" aria-hidden="true">
                    {held.map((h) => (
                      <span key={h.id} className="hh-dot" style={teamStyle(teamOf(c, h.teamId))} />
                    ))}
                  </span>
                  <span className="hh-role-text">
                    <b>
                      {r.name}
                      <span className="muted small hh-role-sides">
                        {held.map((h) => `${h.count > 1 ? `${h.count} ` : ""}${teamOf(c, h.teamId)?.name ?? ""}`).join(" · ")}
                      </span>
                    </b>
                    <span className="muted small">{r.description}</span>
                  </span>
                  {r.show !== "any" && <span className="tag">{SHOW_LABELS[r.show]}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <ul className="hh-facts">
          {c.groups && (
            <li>
              <Icon name="swap" size={16} /> Two groups: {c.groupNames[0]} and {c.groupNames[1]}
            </li>
          )}
          {c.rounds.length > 0 && (
            <li>
              <Icon name="timer" size={16} /> {c.rounds.length} {c.rounds.length === 1 ? "round" : "rounds"}: {c.rounds.map((r) => (r.minutes < 1 ? `${r.minutes * 60}s` : `${r.minutes}m`)).join(", ")}
            </li>
          )}
          {c.setAside && (
            <li>
              <Icon name="lock" size={16} /> One card set aside, unseen
            </li>
          )}
          {c.oddRoleId && (
            <li>
              <Icon name="sparkle" size={16} /> Odd number of players: adds {c.roles.find((r) => r.id === c.oddRoleId)?.name}
            </li>
          )}
        </ul>
      </section>
    </>
  );
}

/* ── This phone's card ────────────────────────────────────────────────────────── */

function Dealt({ view, me }: { view: RoomView; me: Me }) {
  const card = view.myCard as Card;
  const [open, setOpen] = useState(false);
  const [showing, setShowing] = useState<"team" | "full" | null>(null);
  const [refused, setRefused] = useState(false);
  const [faceDrawn, setFaceDrawn] = useState(false);
  useEffect(() => {
    if (open) return setFaceDrawn(true);
    const t = window.setTimeout(() => setFaceDrawn(false), 650); // after the turn back has finished
    return () => window.clearTimeout(t);
  }, [open]);
  const refusedTimer = useRef<number>(0);
  const timer = useRef<number>(0);
  // A new deal turns the card face down again, and brings it into view: the host dealt from the
  // bottom of the page, and everybody else may have scrolled down to read the house rules.
  useEffect(() => {
    setOpen(false);
    setShowing(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [view.deal]);
  const flip = () => {
    window.clearTimeout(timer.current);
    if (!open) timer.current = window.setTimeout(() => setOpen(false), 8000);
    setOpen(!open);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(refusedTimer.current);
    },
    [],
  );
  if (!card) return null;
  const canTeam = card.show === "any" || card.show === "team";
  const refuse = () => {
    window.clearTimeout(refusedTimer.current);
    setRefused(true);
    refusedTimer.current = window.setTimeout(() => setRefused(false), 3500);
  };
  const canFull = card.show === "any" || card.show === "full";
  const group = view.myGroup;
  return (
    <section className="hh-mycard">
      {view.config.groups && group !== null && (
        <p className={`hh-group-badge g${group}`}>
          <Icon name="swap" size={16} /> You start in <b>{view.config.groupNames[group]}</b>
        </p>
      )}
      {/* Open, the button's name is the card itself, so a screen reader reads the role out. */}
      <button className={`hh-flip ${open ? "open" : ""}`} onClick={flip} aria-label={open ? undefined : "Look at your card"} aria-pressed={open}>
        <span className="hh-flip-inner">
          <span className="hh-flip-side back" aria-hidden={open}>
            <CardBack>
              <span className="hh-back-hint">
                <Icon name="eye" size={16} /> Tap to look
              </span>
            </CardBack>
          </span>
          <span className="hh-flip-side front" aria-hidden={!open}>
            {/* Only drawn while turned over: some browsers (iOS Safari with a scrolling layer)
                ignore a hidden back face, which would mirror the role through the face-down card. */}
            {faceDrawn ? <CardFace card={card} config={view.config} /> : <div className="hh-card hh-face-blank" />}
          </span>
        </span>
      </button>
      <p className="muted small center hh-flip-note">{open ? "Tap the card to hide it. It hides by itself after a few seconds." : "Only you can see this. Shield the screen when you look."}</p>
      {/* Both buttons look the same on every card: a disabled one would tell a neighbour the card is
          Silent or a Veil. A card that can't be shown that way says so only when it is asked to. */}
      <div className="hh-show-btns">
        <button className="hh-show-btn team" onClick={() => (canTeam ? setShowing("team") : refuse())}>
          <Icon name="shield" /> <span>Show team</span>
        </button>
        <button className="hh-show-btn full" onClick={() => (canFull ? setShowing("full") : refuse())}>
          <Icon name="card" /> <span>Show card</span>
        </button>
      </div>
      <p className="muted small center hh-refusal" role="status">
        {refused && (
          <>
            <Icon name="lock" size={14} /> {card.show === "none" ? "Your card can't be shown to anyone." : card.show === "team" ? "Your card can only show its team." : "Your card can only be shown whole."}
          </>
        )}
      </p>
      {showing && <ShowScreen card={card} config={view.config} mode={showing} name={me.username} onClose={() => setShowing(null)} />}
    </section>
  );
}

/* ── The shared countdown ─────────────────────────────────────────────────────── */

function Countdown({ view, offset, busy, act }: { view: RoomView; offset: number; busy: boolean; act: (f: () => Promise<RoomView>) => Promise<boolean | undefined> }) {
  const { timer, config } = view;
  const round = config.rounds[timer.round];
  const total = round ? round.minutes * 60_000 : 1;
  const [now, setNow] = useState(() => Date.now() + offset);
  const running = timer.endsAt !== null;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now() + offset); // at once, or the first frame counts from a stale time
    const t = setInterval(() => setNow(Date.now() + offset), 200);
    return () => clearInterval(t);
  }, [running, offset]);
  const left = running ? Math.max(0, (timer.endsAt as number) - now) : timer.remaining;
  const done = running && left === 0;
  const buzzed = useRef("");
  useEffect(() => {
    const key = `${view.deal}:${timer.round}:${timer.endsAt}`;
    if (done && buzzed.current !== key) {
      buzzed.current = key;
      navigator.vibrate?.([300, 120, 300, 120, 500]);
    }
  }, [done, view.deal, timer.round, timer.endsAt]);
  const secs = Math.ceil(left / 1000);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");
  const frac = Math.min(1, left / total);
  const R = 52;
  const C = 2 * Math.PI * R;
  const last = timer.round >= config.rounds.length - 1;
  const swap = config.groups && round ? round.swap : 0;
  return (
    <section className={`panel hh-timer ${done ? "done" : ""} ${running ? "running" : ""} ${secs <= 10 && running ? "urgent" : ""}`} aria-label="Round timer">
      <div className="hh-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="hh-ring-bg" />
          <circle cx="60" cy="60" r={R} className="hh-ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
        </svg>
        <div className="hh-ring-text">
          <span className="hh-clock" role="timer" aria-live={done ? "assertive" : "off"}>
            {done ? "Time" : `${mm}:${ss}`}
          </span>
          <span className="muted small">
            Round {timer.round + 1} of {config.rounds.length}
          </span>
        </div>
      </div>
      <div className="hh-timer-side">
        <p className="hh-timer-status">{done ? (swap ? `Time's up. Each group sends ${swap} ${swap === 1 ? "player" : "players"} across.` : "Time's up.") : running ? "Round in play" : timer.remaining < total ? "Paused" : "Ready to start"}</p>
        {swap > 0 && !done && (
          <p className="muted small">
            <Icon name="swap" size={14} /> Then each group sends {swap} across
          </p>
        )}
        {view.host && (
          <div className="hh-timer-ctl">
            <button className="icon-btn" aria-label="Previous round" disabled={busy || timer.round === 0} onClick={() => act(() => cardsApi.timer(view.code, "prev"))}>
              <Icon name="prev" size={18} />
            </button>
            {running && !done ? (
              <button className="hh-play" disabled={busy} onClick={() => act(() => cardsApi.timer(view.code, "pause"))}>
                <Icon name="pause" /> Pause
              </button>
            ) : done ? (
              <button className="hh-play" disabled={busy || last} onClick={() => act(() => cardsApi.timer(view.code, "next"))}>
                <Icon name="next" /> {last ? "Last round" : "Next round"}
              </button>
            ) : (
              <button className="hh-play" disabled={busy} onClick={() => act(() => cardsApi.timer(view.code, "start"))}>
                <Icon name="play" /> {timer.remaining < total ? "Resume" : "Start"}
              </button>
            )}
            <button className="icon-btn" aria-label="Restart this round" disabled={busy} onClick={() => act(() => cardsApi.timer(view.code, "reset"))}>
              <Icon name="reset" size={18} />
            </button>
            <button className="icon-btn" aria-label="Next round" disabled={busy || last} onClick={() => act(() => cardsApi.timer(view.code, "next"))}>
              <Icon name="next" size={18} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Groups, players, rules ───────────────────────────────────────────────────── */

function HouseRules({ notes, open }: { notes: string; open: boolean }) {
  return (
    <details className="panel hh-rules" open={open}>
      <summary>
        <Icon name="book" /> House rules <Icon name="chevron" size={18} className="hh-chev" />
      </summary>
      <p>{notes}</p>
    </details>
  );
}

function Players({ view, act, busy }: { view: RoomView; act: (f: () => Promise<RoomView>) => Promise<boolean | undefined>; busy: boolean }) {
  const [menu, setMenu] = useState<number | null>(null);
  const tests = view.players.filter((p) => p.test).length;
  return (
    <section className="panel hh-players">
      <div className="hh-section-head">
        <h2>
          <Icon name="users" /> Players <span className="count">{view.players.length}</span>
        </h2>
        {view.host && !view.dealt && tests > 0 && (
          <button className="ghost-link danger-text" disabled={busy} onClick={() => act(() => cardsApi.removeTests(view.code))}>
            Remove test players
          </button>
        )}
      </div>
      <ul>
        {view.players.map((p: PlayerView) => (
          <li key={p.id}>
            {p.test ? (
              <span className="hh-test-avatar" aria-hidden="true">
                <Icon name="robot" size={18} />
              </span>
            ) : (
              <Avatar name={p.name} size={34} />
            )}
            <span className="hh-player-name truncate">
              {p.name}
              {p.id === view.me && <span className="muted small"> (you)</span>}
            </span>
            {p.test && <span className="tag hh-test-tag">Test</span>}
            {p.host && (
              <span className="hh-host-tag">
                <Icon name="crown" size={14} /> Host
              </span>
            )}
            {view.host && p.id !== view.me && (
              <span className="hh-player-menu">
                <button className="icon-btn" aria-label={`Options for ${p.name}`} aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? null : p.id)}>
                  <Icon name="gear" size={18} />
                </button>
                {menu === p.id && (
                  <span className="hh-player-actions">
                    {!p.test && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setMenu(null);
                          act(() => cardsApi.host(view.code, p.id));
                        }}
                      >
                        <Icon name="crown" size={16} /> Make host
                      </button>
                    )}
                    {!view.dealt && (
                      <button
                        className="danger-outline"
                        disabled={busy}
                        onClick={() => {
                          setMenu(null);
                          act(() => cardsApi.kick(view.code, p.id));
                        }}
                      >
                        <Icon name="x" size={16} /> Remove
                      </button>
                    )}
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {view.removed.length > 0 && (
        <div className="hh-removed">
          <span className="field-label">Removed</span>
          <ul>
            {view.removed.map((r) => (
              <li key={r.id}>
                <span className="truncate">{r.name}</span>
                <button disabled={busy} onClick={() => act(() => cardsApi.letBackIn(view.code, r.id))}>
                  Let back in
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.canTest && !view.dealt && (
        <div className="hh-test-add">
          <p className="muted small">
            <Icon name="robot" size={16} /> Nobody to play with? Add test players and open their cards from your phone.
          </p>
          <div className="row">
            <button disabled={busy || tests >= MAX_TEST_PLAYERS} onClick={() => act(() => cardsApi.addTests(view.code, 1))}>
              <Icon name="plus" size={16} /> 1 test player
            </button>
            <button disabled={busy || tests >= MAX_TEST_PLAYERS} onClick={() => act(() => cardsApi.addTests(view.code, 5))}>
              <Icon name="plus" size={16} /> 5
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** For the host trying a game alone: each test player's card, face down until opened. */
function TestCards({ view }: { view: RoomView }) {
  const [open, setOpen] = useState<PlayerView | null>(null);
  const [showing, setShowing] = useState<"team" | "full" | null>(null);
  const tests = view.players.filter((p) => p.test && p.testCard);
  useEffect(() => {
    setOpen(null);
    setShowing(null);
  }, [view.deal]);
  const card = open?.testCard;
  return (
    <section className="panel hh-testcards">
      <h2>
        <Icon name="robot" /> Test players' cards
      </h2>
      <p className="muted small">Only you see these. Open one to play its part: look at it, or hold it up as that player would.</p>
      <ul>
        {tests.map((p) => (
          <li key={p.id}>
            <span className="hh-player-name truncate">{p.name}</span>
            <button onClick={() => setOpen(p)}>
              <Icon name="eye" size={16} /> Open
            </button>
          </li>
        ))}
      </ul>
      {open && card && (
        <div className="hh-sheet-backdrop" onClick={() => setOpen(null)}>
          <div className="hh-sheet" role="dialog" aria-modal="true" aria-label={`${open.name}'s card`} onClick={(e) => e.stopPropagation()}>
            <div className="hh-sheet-head">
              <b>{open.name}</b>
              <button className="icon-btn" aria-label="Close" onClick={() => setOpen(null)}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <CardFace card={card} config={view.config} />
            <div className="hh-show-btns">
              <button className="hh-show-btn team" disabled={card.show === "full" || card.show === "none"} onClick={() => setShowing("team")}>
                <Icon name="shield" /> <span>Show team</span>
              </button>
              <button className="hh-show-btn full" disabled={card.show === "team" || card.show === "none"} onClick={() => setShowing("full")}>
                <Icon name="card" /> <span>Show card</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {open && card && showing && <ShowScreen card={card} config={view.config} mode={showing} name={open.name} onClose={() => setShowing(null)} />}
    </section>
  );
}

/* ── The end ──────────────────────────────────────────────────────────────────── */

function RevealBoard({ view }: { view: RoomView }) {
  const c: Config = view.config;
  return (
    <section className="hh-reveal">
      <h2 className="hh-reveal-title">
        <Icon name="eye" /> Everyone's cards
      </h2>
      {c.teams.map((t) => {
        const people = view.players.filter((p) => p.card?.teamId === t.id);
        if (people.length === 0) return null;
        return (
          <div key={t.id} className="hh-reveal-team" style={teamStyle(t)}>
            <h3>
              <span className="hh-dot" aria-hidden="true" /> {t.name} <span className="count">{people.length}</span>
            </h3>
            <ul>
              {people.map((p) => (
                <li key={p.id} className={p.card && !p.card.roleId.startsWith("member:") ? "special" : ""}>
                  <span className="truncate">{p.name}</span>
                  <b className="truncate">{p.card?.name}</b>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {view.setAside && (
        <div className="hh-reveal-aside">
          <span className="field-label">Set aside</span>
          <CardFace card={view.setAside} config={c} compact />
        </div>
      )}
    </section>
  );
}

function HostBar({ view, act, busy }: { view: RoomView; act: (f: () => Promise<RoomView>, done?: string) => Promise<boolean | undefined>; busy: boolean }) {
  const n = view.players.length;
  if (!view.dealt && view.host)
    return (
      <div className="hh-hostbar">
        <button className="primary big shine" disabled={busy || n < 2} onClick={() => act(() => cardsApi.deal(view.code))}>
          <Icon name="shuffle" /> {n < 2 ? "Waiting for players" : `Deal ${n} cards`}
        </button>
      </div>
    );
  return (
    <section className="panel hh-hosttools">
      <h2>
        <Icon name="crown" /> {view.host ? "Host" : "Admin"}
      </h2>
      <div className="hh-hosttools-grid">
        {/* Revealing every card is an admin's call, whoever hosts. */}
        {view.canReveal && (
          <button disabled={busy} onClick={() => act(() => cardsApi.reveal(view.code, !view.revealed))}>
            <Icon name="eye" size={18} /> {view.revealed ? "Hide cards again" : "Reveal all cards"}
          </button>
        )}
        {view.host && (
          <>
        <button
          disabled={busy}
          onClick={() => {
            if (confirm("Shuffle and deal new cards to everyone?")) act(() => cardsApi.deal(view.code, true), "New cards dealt.");
          }}
        >
          <Icon name="shuffle" size={18} /> Deal again
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (confirm("Take everyone's cards back? You can then change the setup or the players.")) act(() => cardsApi.collect(view.code));
          }}
        >
          <Icon name="reset" size={18} /> Collect cards
        </button>
          </>
        )}
      </div>
    </section>
  );
}
