/** One online game: the waiting room before it starts, then the board for everyone. */
import { useEffect, useMemo, useRef, useState } from "react";
import { COMPANIES, COMPANY_IDS, THRESHOLDS, TOP, TRACK, capIndex, openShorts, outstanding, price, type Action, type GameEvent, type GameState, type Seat } from "../engine/index.ts";
import type { GameUpdate, Me } from "../shared/api.ts";
import { api, follow } from "./api.ts";
import { go } from "./App.tsx";
import { changeSinceLastRound, priceHistory, type PricePoint } from "./history.ts";
import { CompanyBadge } from "./logos.tsx";
import { AdminDesks, Board, chairOf, Change, DeskHead, lastRound, EndScreen, Log, Market, MyPosition, NewsCardView, Players, Private, RoundTracker, Sparkline, Ticker, band, cardImpact, coStyle, paysNow, rs } from "./parts.tsx";
import { Avatar, Icon, type IconName } from "./ui.tsx";

type Tab = "play" | "board" | "players" | "cards" | "log";

export function GameScreen({ id, me }: { id: number; me: Me; onRules: () => void }) {
  const [u, setU] = useState<GameUpdate | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [times, setTimes] = useState<(string | null)[]>([]);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<Tab>("play");
  const [busy, setBusy] = useState(false);
  // A "can't reach the server" notice is out of date once the connection is back.
  useEffect(() => {
    if (connected) setToast((t) => (t.startsWith("Can't reach") ? "" : t));
  }, [connected]);
  // A new section starts at its top, not wherever the last one was scrolled to.
  useEffect(() => window.scrollTo(0, 0), [tab]);

  useEffect(() => {
    setU(null);
    setEvents([]);
    setTimes([]);
    return follow(
      id,
      (next) => {
        setU(next);
        setEvents((have) => (next.events.from === 0 ? next.events.list : [...have.slice(0, next.events.from), ...next.events.list]));
        setTimes((have) => (next.events.from === 0 ? next.events.times : [...have.slice(0, next.events.from), ...next.events.times]));
      },
      setConnected,
      (status, message) => {
        if (status === 401) location.reload(); // signed out: back to the sign-in screen
        else setError(message);
      },
    );
  }, [id]);

  const s = u?.view ?? null;
  const mySeat = u?.mySeat ?? null;
  const myMove = !!(u && mySeat !== null && u.waiting.includes(mySeat));

  // Tell the player when it becomes their move, even if they are looking at another tab.
  const was = useRef(false);
  useEffect(() => {
    if (myMove && !was.current) {
      navigator.vibrate?.(200);
      setTab("play");
    }
    was.current = myMove;
    document.title = myMove ? "● Your move · Bull Run" : "Bull Run";
    return () => {
      document.title = "Bull Run";
    };
  }, [myMove]);

  const hist = useMemo(() => (s ? priceHistory(s, events) : null), [s, events]);

  if (!u)
    return (
      <main className="page">
        {error ? (
          <div className="empty-state">
            <Icon name="x" size={32} />
            <p className="error">{error}</p>
            <a className="button primary" href="#/">
              Back to my games
            </a>
          </div>
        ) : (
          <div className="empty-state">
            <span className="spinner big" />
            <p className="muted">Opening the trading floor…</p>
          </div>
        )}
      </main>
    );
  if (u.game.status === "abandoned")
    return (
      <main className="page">
        <div className="empty-state">
          <Icon name="flag" size={32} />
          <h1 className="page-title">Game {u.game.code}</h1>
          <p>{u.game.startedAt ? "This game was ended by the admin before it finished." : "This game was cancelled before it started."}</p>
          <a className="button primary" href="#/">
            Back to my games
          </a>
        </div>
      </main>
    );
  if (!s || !hist) return <WaitingRoom u={u} me={me} onError={setError} error={error} />;

  const names = (seats: Seat[]) => seats.map((x) => s.players[x].name).join(", ");
  // One move at a time: the controls stay off until the server has answered and sent the new state,
  // so a double tap can't spend both actions on the same trade.
  const play = (a: Action) => {
    if (busy) return;
    setToast("");
    setBusy(true);
    api
      .act(id, a)
      .catch((e) => setToast((e as Error).message))
      .finally(() => setBusy(false));
  };

  let status: string;
  let sub = "";
  if (s.phase.kind === "ended") status = "Closing bell — game over";
  else if (myMove) {
    status = s.debt ? "You must sell shares to pay" : s.phase.kind === "opening" ? "Write your opening orders" : s.phase.kind === "ipo" ? "Place your IPO bid" : "Your move";
    sub = s.debt ? "" : s.phase.kind === "turn" ? (s.phase.step === "draw" ? "Draw a card to finish your turn" : "Trade, then play a news card") : s.phase.kind === "openingDraw" ? "Draw back up to 4 cards" : "";
  } else if (s.phase.kind === "opening" || s.phase.kind === "ipo") status = `Waiting for ${names(u.waiting)}`;
  else if (s.debt) status = `${names(u.waiting)} is selling shares to pay`;
  else if (s.phase.kind === "openingDraw" || (s.phase.kind === "turn" && s.phase.step === "draw")) status = `${names(u.waiting)} is drawing a card`;
  else status = `${names(u.waiting)} is trading`;

  const action =
    s.phase.kind === "ended" ? (
      <EndScreen s={s} viewer={mySeat} onNew={() => go("#/")} />
    ) : mySeat === null ? (
      u.revealed ? (
        <AdminDesks s={s} />
      ) : (
        <section className="panel">
          <h2>Watching</h2>
          <p className="muted">You are not a player in this game.</p>
        </section>
      )
    ) : myMove ? (
      <Private s={s} seat={mySeat} play={play} busy={busy} />
    ) : (
      <Waiting s={s} seat={mySeat} who={names(u.waiting)} />
    );

  return (
    <div className={`game tab-${tab}`}>
      <h1 className="sr-only">Game {u.game.code}</h1>
      <div className="game-head">
        <RoundTracker s={s} />
        <div className={`status-line ${myMove ? "mine" : ""} ${s.phase.kind === "ended" ? "over" : ""}`} role="status">
          {myMove ? <span className="pulse-dot light" /> : s.phase.kind !== "ended" && u.waiting.length > 0 && <Avatar name={s.players[u.waiting[0]].name} seat={u.waiting[0]} size={22} />}
          <span className="status-text">
            <b>{status}</b>
            {sub && <span className="status-sub">{sub}</span>}
          </span>
          {!myMove && s.phase.kind !== "ended" && (
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      </div>
      {u.revealed && (
        <div className="admin-chip" role="note">
          <Icon name="shield" size={16} /> Admin view: every player's cash and cards are shown to you.
        </div>
      )}
      {!connected && (
        <div className="offline" role="status">
          <span className="spinner" /> Reconnecting to the game…
        </div>
      )}
      {toast && (
        <button className="toast" onClick={() => setToast("")}>
          <span role="alert">{toast}</span> <span className="muted small">(tap to close)</span>
        </button>
      )}
      <Ticker s={s} hist={hist} />

      <div className="layout">
        <div className="col-board">
          <div className="only-wide">
            <Board s={s} hist={hist} />
          </div>
          <div className="only-narrow pane pane-board">
            <CompactBoard s={s} hist={hist} />
          </div>
        </div>
        <aside className="side">
          <div className="pane pane-play">{action}</div>
          <div className="pane pane-players">
            <Players s={s} viewer={mySeat} reveal={u.revealed} />
          </div>
          <div className="pane pane-cards">
            <Market s={s} />
          </div>
          <div className="pane pane-log">
            <Log events={events} times={times} />
          </div>
        </aside>
      </div>

      <nav className="tabbar only-narrow" aria-label="Game sections">
        {(
          [
            ["play", "Play", "home"],
            ["board", "Prices", "chart"],
            ["players", "Players", "users"],
            ["cards", "Market", "copy"],
            ["log", "Log", "book"],
          ] as [Tab, string, IconName][]
        ).map(([t, label, icon]) => (
          <button key={t} className={`${tab === t ? "on" : ""} ${t === "play" && myMove ? "tab-alert" : ""}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** While somebody else is deciding: your cards and your position, read-only. */
function Waiting({ s, seat, who }: { s: GameState; seat: Seat; who: string }) {
  const p = s.players[seat];
  return (
    <section className="panel private waiting">
      <DeskHead s={s} seat={seat} note={`Waiting for ${who}`} />
      {s.pendingNews[seat] !== null && s.pendingNews[seat] !== undefined && (
        <>
          <h3>
            Your face-down card <span className="muted small">({lastRound(s) ? "the game ends before it is revealed" : "takes effect at the start of your next turn"})</span>
          </h3>
          <div className="cards">
            <NewsCardView id={s.pendingNews[seat]!} />
          </div>
        </>
      )}
      <h3>Your hand</h3>
      <div className="cards">
        {p.hand.map((id) => (
          <NewsCardView key={id} id={id} impact={cardImpact(s, seat, id)} />
        ))}
      </div>
      {s.phase.kind === "turn" && <MyPosition s={s} seat={seat} />}
    </section>
  );
}

/** The board as one row per company, for phones: price, change, a strip of the track, and the counts. */
function CompactBoard({ s, hist }: { s: GameState; hist: Record<string, PricePoint[]> }) {
  const tracks = COMPANY_IDS.filter((c) => !COMPANIES[c].ipo || s.config.ipo !== false);
  return (
    <section className="panel compact-board" aria-label="Prices">
      {tracks.map((c) => {
        const co = COMPANIES[c];
        const st = s.companies[c];
        const out = outstanding(s, c);
        const ch = s.chairmen[c];
        const shorts = openShorts(s, c);
        return (
          <div key={c} className={`crow ${st.listed ? "" : "unlisted"}`} style={coStyle(c)}>
            <div className="crow-top">
              <CompanyBadge c={c} size={28} />
              <div className="crow-name">
                <b>{co.short}</b>
                <span className="muted small">
                  {co.sector}
                  {co.doubleDividend ? " · double dividend" : co.noDividend ? " · no dividend" : ""}
                </span>
              </div>
              <div className="crow-price">
                <b>{!st.listed ? "IPO R4" : st.bankrupt ? "BUST" : rs(price(s, c))}</b>
                <Change d={changeSinceLastRound(s, hist[c], c)} />
              </div>
            </div>
            {st.listed && (
              <>
                <div className="strip" aria-hidden="true">
                  {TRACK.map((p, i) => (
                    <span key={i} className={`cell ${band(s, p)} ${i === st.priceIndex ? "here" : ""} ${i === 0 ? "bust" : ""} ${shorts.some((t) => t.openIndex === i) ? "has-short" : ""} ${shorts.some((t) => capIndex(t.openIndex) === i) ? "cap" : ""} ${i === TOP ? "top" : ""}`} />
                  ))}
                </div>
                <div className="crow-facts small">
                  <span className="thresholds" title="Shares outstanding: the price moves at 3, 6, 9 and 12">
                    {THRESHOLDS.map((t) => (
                      <span key={t} className={out >= t ? "hit" : ""}>
                        {t}
                      </span>
                    ))}
                  </span>
                  <span>Out {out}</span>
                  {!st.bankrupt && <span>Pays {rs(paysNow(s, c))}</span>}
                  {shorts.length > 0 && <span className="short-chip">short ×{shorts.length}</span>}
                  {chairOf(s, c) && <span className="chair">★ {chairOf(s, c)}</span>}
                </div>
                <Sparkline points={hist[c]} now={s.phase.kind === "ended" ? null : price(s, c)} label={`${co.short} price history`} />
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Before the game starts: the code to share, who has joined, and the start button. */
function WaitingRoom({ u, me, onError, error }: { u: GameUpdate; me: Me; onError: (e: string) => void; error: string }) {
  const g = u.game;
  const isCreator = g.createdBy === me.username;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const share = async () => {
    const text = `Join my Bull Run game with code ${g.code}: ${location.origin}`;
    try {
      if (navigator.share) await navigator.share({ title: "Bull Run", text });
      else {
        await navigator.clipboard.writeText(g.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      // Cancelling the share sheet is fine; anything else means nothing was shared or copied.
      if ((e as Error)?.name !== "AbortError") onError(`Couldn't share or copy. The code is ${g.code}.`);
    }
  };
  const act = (f: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    f().then(
      () => after?.(),
      (e) => onError((e as Error).message),
    ).finally(() => setBusy(false));
  };
  const need = Math.max(0, 3 - u.seats.length);
  return (
    <main className="page">
      <section className="waiting-room">
        <p className="eyebrow">Waiting room</p>
        <div className="ticket-big">
          <span className="ticket-label">Game code</span>
          <div className="big-code" aria-label={`Game code ${g.code.split("").join(" ")}`}>
            {g.code.split("").map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </div>
          <button className="share-btn" onClick={share}>
            <Icon name={copied ? "check" : "share"} size={18} /> {copied ? "Code copied" : "Share the code"}
          </button>
        </div>
        <p className="small muted">
          {g.rounds} rounds · up to {g.maxPlayers} players · standard rules
        </p>

        <div className="seats">
          {Array.from({ length: g.maxPlayers }, (_, i) => {
            const p = u.seats[i];
            return p ? (
              <div key={i} className="seat filled">
                <Avatar name={p.username} seat={p.seat} size={48} />
                <b>{p.username}</b>
                <span className="small muted">{p.username === g.createdBy ? "host" : p.username === me.username ? "you" : "ready"}</span>
              </div>
            ) : (
              <div key={i} className="seat empty">
                <span className="seat-ring" />
                <span className="small muted">{i < 3 ? "needed" : "open seat"}</span>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {isCreator || me.isAdmin ? (
          <>
            <button className="primary big" disabled={need > 0 || busy} onClick={() => act(() => api.start(g.id))}>
              {need > 0 ? `Need ${need} more to start` : "Start the game"}
            </button>
            {isCreator && (
              <button className="ghost-link danger-text" disabled={busy} onClick={() => act(() => api.leave(g.id), () => go("#/"))}>
                Cancel this game
              </button>
            )}
          </>
        ) : (
          <>
            <p className="waiting-note">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>{" "}
              Waiting for {g.createdBy} to start the game
            </p>
            {u.mySeat !== null && (
              <button className="ghost-link danger-text" disabled={busy} onClick={() => act(() => api.leave(g.id), () => go("#/"))}>
                Leave this game
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
