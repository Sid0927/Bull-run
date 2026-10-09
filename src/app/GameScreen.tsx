/** One online game: the waiting room before it starts, then the board for everyone. */
import { useEffect, useMemo, useRef, useState } from "react";
import { COMPANIES, COMPANY_IDS, THRESHOLDS, TOP, TRACK, capIndex, openShorts, outstanding, price, type Action, type GameEvent, type GameState, type Seat } from "../engine/index.ts";
import type { GameUpdate, Me } from "../shared/api.ts";
import { api, follow } from "./api.ts";
import { go } from "./App.tsx";
import { changeSinceLastRound, priceHistory, type PricePoint } from "./history.ts";
import { CompanyBadge } from "./logos.tsx";
import { Board, Change, EndScreen, Log, Market, MyPosition, NewsCardView, Players, Private, RoundTracker, Sparkline, Ticker, band, cardImpact, coStyle, paysNow, rs } from "./parts.tsx";

type Tab = "play" | "board" | "players" | "cards" | "log";

export function GameScreen({ id, me, onRules }: { id: number; me: Me; onRules: () => void }) {
  const [u, setU] = useState<GameUpdate | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<Tab>("play");

  useEffect(() => {
    setU(null);
    setEvents([]);
    return follow(
      id,
      (next) => {
        setU(next);
        setEvents((have) => (next.events.from === 0 ? next.events.list : [...have.slice(0, next.events.from), ...next.events.list]));
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
          <>
            <p className="error">{error}</p>
            <a href="#/">Back to my games</a>
          </>
        ) : (
          <p className="muted">Connecting…</p>
        )}
      </main>
    );
  if (u.game.status === "abandoned")
    return (
      <main className="page">
        <h1 className="page-title">Game {u.game.code}</h1>
        <p>This game was abandoned.</p>
        <a href="#/">Back to my games</a>
      </main>
    );
  if (!s || !hist) return <WaitingRoom u={u} me={me} onError={setError} error={error} />;

  const names = (seats: Seat[]) => seats.map((x) => s.players[x].name).join(", ");
  const play = (a: Action) => {
    setToast("");
    api.act(id, a).catch((e) => setToast((e as Error).message));
  };

  let status: string;
  if (s.phase.kind === "ended") status = "Game over";
  else if (myMove) status = s.debt ? "You must sell shares to pay" : s.phase.kind === "opening" ? "Write your opening orders" : s.phase.kind === "ipo" ? "Place your IPO bid" : "Your move";
  else if (s.phase.kind === "opening" || s.phase.kind === "ipo") status = `Waiting for ${names(u.waiting)}`;
  else status = `${names(u.waiting)}'s move`;

  const action =
    s.phase.kind === "ended" ? (
      <EndScreen s={s} onNew={() => go("#/")} />
    ) : mySeat === null ? (
      <section className="panel">
        <h2>Watching</h2>
        <p className="muted">You are not a player in this game.</p>
      </section>
    ) : myMove ? (
      <Private s={s} seat={mySeat} play={play} />
    ) : (
      <Waiting s={s} seat={mySeat} who={names(u.waiting)} />
    );

  return (
    <div className={`game tab-${tab}`}>
      <div className="game-head">
        <RoundTracker s={s} />
        <div className={`status-line ${myMove ? "mine" : ""}`} role="status">
          {status}
        </div>
      </div>
      {!connected && <div className="offline">Reconnecting to the game…</div>}
      {toast && (
        <div className="toast" role="alert" onClick={() => setToast("")}>
          {toast} <span className="muted small">(tap to close)</span>
        </div>
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
            <Players s={s} viewer={mySeat} />
          </div>
          <div className="pane pane-cards">
            <Market s={s} />
          </div>
          <div className="pane pane-log">
            <Log events={events} />
          </div>
        </aside>
      </div>

      <nav className="tabbar only-narrow" aria-label="Game sections">
        {(
          [
            ["play", myMove ? "● Play" : "Play"],
            ["board", "Prices"],
            ["players", "Players"],
            ["cards", "Market"],
            ["log", "Log"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? "on" : ""} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <button onClick={onRules}>Rules</button>
      </nav>
    </div>
  );
}

/** While somebody else is deciding: your cards and your position, read-only. */
function Waiting({ s, seat, who }: { s: GameState; seat: Seat; who: string }) {
  const p = s.players[seat];
  return (
    <section className="panel private">
      <h2>
        {p.name} <span className="cash">{rs(p.cash)}</span>
      </h2>
      <p className="waiting-note">Waiting for {who}.</p>
      {s.pendingNews[seat] !== null && s.pendingNews[seat] !== undefined && (
        <>
          <h3>Your face-down card</h3>
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
                  {ch !== null && <span className="chair">★ {s.players[ch].name}</span>}
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
  const share = async () => {
    const text = `Join my Bull Run game with code ${g.code}: ${location.origin}`;
    try {
      if (navigator.share) await navigator.share({ title: "Bull Run", text });
      else {
        await navigator.clipboard.writeText(g.code);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <main className="page">
      <section className="panel waiting-room">
        <p className="muted">Game code</p>
        <div className="big-code" aria-label={`Game code ${g.code.split("").join(" ")}`}>
          {g.code}
        </div>
        <button onClick={share}>{copied ? "Code copied" : "Share the code"}</button>
        <p className="small muted">
          {g.rounds} rounds · up to {g.maxPlayers} players · standard rules
        </p>
        <h2>
          Players ({u.seats.length}/{g.maxPlayers})
        </h2>
        <ol className="seat-list">
          {u.seats.map((p) => (
            <li key={p.seat}>
              {p.username}
              {p.username === g.createdBy && <span className="tag">host</span>}
              {p.username === me.username && <span className="tag">you</span>}
            </li>
          ))}
        </ol>
        {error && <p className="error">{error}</p>}
        {isCreator || me.isAdmin ? (
          <>
            <button className="primary big" disabled={u.seats.length < 3} onClick={() => api.start(g.id).catch((e) => onError(e.message))}>
              {u.seats.length < 3 ? `Need ${3 - u.seats.length} more to start` : "Start the game"}
            </button>
            {isCreator && (
              <button className="link" onClick={() => api.leave(g.id).then(() => go("#/"), (e) => onError(e.message))}>
                Cancel this game
              </button>
            )}
          </>
        ) : (
          <>
            <p>Waiting for {g.createdBy} to start the game.</p>
            {u.mySeat !== null && (
              <button className="link" onClick={() => api.leave(g.id).then(() => go("#/"), (e) => onError(e.message))}>
                Leave this game
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
