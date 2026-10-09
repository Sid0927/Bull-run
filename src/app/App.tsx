import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CHAIRMAN_MULTIPLIER,
  COMPANIES,
  COMPANY_IDS,
  DIVIDEND_ROUNDS,
  GAME_LENGTHS,
  OPENING_MAX_SHARES,
  THRESHOLDS,
  TOP,
  TRACK,
  actor,
  apply,
  bankShares,
  capIndex,
  card,
  netWorth,
  openShorts,
  outstanding,
  previewTrade,
  price,
  startPrice,
  IPO_ROUND,
  ipoBandOf,
  ipoEnabled,
  ipoMaxBidOf,
  type Action,
  type CompanyId,
  type GameConfig,
  type GameEvent,
  type GameLength,
  type GameRecord,
  type GameState,
  type Holdings,
  type Seat,
  type TradeKind,
} from "../engine/index.ts";
import { useGame } from "./useGame.ts";
import { BullLogo, CompanyBadge } from "./logos.tsx";
import { changeSinceLastRound, priceHistory, type PricePoint } from "./history.ts";

const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
const signedRs = (n: number) => (n > 0 ? `+${rs(n)}` : n < 0 ? `−${rs(-n)}` : "±₹0");
/** Company colours are theme tokens (--co-HUL…), so dark mode gets its own validated steps. */
const coStyle = (c: CompanyId) => ({ ["--co" as string]: `var(--co-${c})` });

/** Up/down/flat as an arrow and a word as well as a colour, so it never relies on colour alone. */
function Change({ d }: { d: number | null }) {
  if (d === null) return null;
  const dir = d > 0 ? "up" : d < 0 ? "down" : "flat";
  return (
    <span className={`chg ${dir}`}>
      <span aria-hidden="true">{d > 0 ? "▲" : d < 0 ? "▼" : "■"}</span> {d === 0 ? "flat" : signedRs(d)}
    </span>
  );
}

/** Rupee effect of a card on a seat's position at today's prices (ignores caps and thresholds). */
function cardImpact(s: GameState, seat: Seat, id: number): number {
  let v = 0;
  for (const [c, steps] of Object.entries(card(id).effects) as [CompanyId, number][]) {
    const st = s.companies[c];
    if (!st.listed || st.bankrupt) continue;
    const to = Math.max(0, Math.min(TOP, st.priceIndex + steps));
    const net = s.players[seat].shares[c] - openShorts(s, c, seat).length;
    v += (TRACK[to] - TRACK[st.priceIndex]) * net;
  }
  return v;
}

export function App() {
  const g = useGame();
  if (!g.live) return <Setup onStart={g.start} onLoad={g.loadRecord} />;
  return <Game {...g} live={g.live} />;
}

// ─── Setup ──────────────────────────────────────────────────────────────────────────────

/** Starting-price variants to play-test. "Tiered" is the simulator's suggestion (Oct 2026). */
const START_LAYOUTS = {
  handover: { label: "Handover", prices: undefined },
  tiered: { label: "Tiered (volatile start high)", prices: { SUN: 120, INFY: 120, ONGC: 100, DLF: 100, HUL: 80, HDFC: 80 } as Partial<Record<CompanyId, number>> },
} as const;

function Setup({ onStart, onLoad }: { onStart: (c: GameConfig) => void; onLoad: (r: GameRecord) => void }) {
  const [count, setCount] = useState(4);
  const [names, setNames] = useState(["", "", "", "", ""]);
  const [rounds, setRounds] = useState<GameLength>(9);
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1e9)));
  const [layout, setLayout] = useState<keyof typeof START_LAYOUTS>("handover");
  const [ipo, setIpo] = useState(true);
  const [delayed, setDelayed] = useState(false);
  const [error, setError] = useState("");

  function start() {
    const players = names.slice(0, count).map((n, i) => n.trim() || `Player ${i + 1}`);
    if (new Set(players).size !== players.length) return setError("Give every player a different name.");
    const startPrices = START_LAYOUTS[layout].prices;
    onStart({ players, rounds, seed: Number(seed) | 0, ...(startPrices ? { startPrices } : {}), ...(ipo ? {} : { ipo: false }), ...(delayed ? { delayedNews: true } : {}) });
  }

  function load(file: File) {
    file.text().then((t) => {
      try {
        onLoad(JSON.parse(t) as GameRecord);
      } catch (e) {
        setError(`That file is not a Bull Run game record: ${(e as Error).message}`);
      }
    });
  }

  return (
    <main className="setup">
      <div className="hero">
        <BullLogo size={56} />
        <div>
          <h1>Bull Run</h1>
          <p className="muted">Play-test edition · 3–5 players on one device</p>
        </div>
      </div>
      <div className="hero-strip" aria-hidden="true">
        {COMPANY_IDS.map((c) => (
          <CompanyBadge key={c} c={c} size={28} />
        ))}
      </div>
      <section className="panel">
        <div className="field">
          Players
          <div className="seg" role="group" aria-label="Players">
            {[3, 4, 5].map((n) => (
              <button
                key={n}
                className={n === count ? "on" : ""}
                onClick={() => {
                  setCount(n);
                  if (n === 5 && rounds === 12) setRounds(9);
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {Array.from({ length: count }, (_, i) => (
          <label key={i}>
            Seat {i + 1}
            <input value={names[i]} placeholder={`Player ${i + 1}`} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
          </label>
        ))}
        <div className="field">
          Game length
          <div className="seg" role="group" aria-label="Game length">
            {GAME_LENGTHS.map((n) => (
              <button key={n} className={n === rounds ? "on" : ""} onClick={() => setRounds(n)}>
                {n} rounds
              </button>
            ))}
          </div>
          {count === 5 && rounds === 12 && <span className="muted small">9 rounds is recommended for 5 players: 12 leaves a wide gap between first and last.</span>}
        </div>
        <div className="field">
          Starting prices
          <div className="seg" role="group" aria-label="Starting prices">
            {(Object.keys(START_LAYOUTS) as (keyof typeof START_LAYOUTS)[]).map((k) => (
              <button key={k} className={k === layout ? "on" : ""} onClick={() => setLayout(k)}>
                {START_LAYOUTS[k].label}
              </button>
            ))}
          </div>
          <span className="muted small">
            {COMPANY_IDS.filter((c) => !COMPANIES[c].ipo).map((c) => `${COMPANIES[c].short} ₹${START_LAYOUTS[layout].prices?.[c] ?? COMPANIES[c].startPrice}`).join(" · ")}
          </span>
        </div>
        <label className="check">
          <input type="checkbox" id="ipo" checked={ipo} onChange={(e) => setIpo(e.target.checked)} />
          Zomato IPO at the start of round {IPO_ROUND}
        </label>
        <label className="check">
          <input type="checkbox" id="delayed" checked={delayed} onChange={(e) => setDelayed(e.target.checked)} />
          Test rule: news takes effect one lap later (played face-down)
        </label>
        <label>
          Seed
          <input value={seed} inputMode="numeric" onChange={(e) => setSeed(e.target.value.replace(/[^0-9-]/g, ""))} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" onClick={start}>
            Start game
          </button>
          <label className="file">
            Load a record file…
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          </label>
        </div>
        <label>
          Or paste a game record
          <textarea
            id="paste-record"
            rows={2}
            onChange={(e) => {
              const t = e.target.value.trim();
              if (!t) return;
              try {
                onLoad(JSON.parse(t) as GameRecord);
              } catch (err) {
                setError(`That is not a Bull Run game record: ${(err as Error).message}`);
              }
            }}
          />
        </label>
      </section>
      <p className="muted small">One device, passed round the table. Cash and hands are shown only to the player whose turn it is.</p>
    </main>
  );
}

// ─── Game ───────────────────────────────────────────────────────────────────────────────

function Game({ live, act, undo, quit }: ReturnType<typeof useGame> & { live: NonNullable<ReturnType<typeof useGame>["live"]> }) {
  const { state: s, events, record } = live;
  const who = actor(s);
  const [viewer, setViewer] = useState<Seat | null>(null);
  const [flash, setFlash] = useState("");
  const [quitting, setQuitting] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const shown = who !== null && viewer === who;
  const hist = useMemo(() => priceHistory(s, events), [s, events]);

  // A new actor hides everything private until they say it is them, and nothing on screen from
  // the previous player's turn (a message, a half-made quit) is carried over to them.
  useEffect(() => {
    if (who !== viewer) setViewer(null);
    setQuitting(false);
  }, [who]); // eslint-disable-line react-hooks/exhaustive-deps

  function play(a: Action) {
    const err = act(a);
    setFlash(err ?? "");
  }

  const recordText = JSON.stringify(record);
  // The record holds sealed opening orders and IPO bids, and its seed reveals every hand.
  const sealing = s.phase.kind === "opening" || s.phase.kind === "ipo";
  function copyRecord() {
    navigator.clipboard?.writeText(recordText).then(
      () => setFlash("Game record copied. Paste it on the setup screen to replay this game."),
      () => setShowRecord(true),
    ) ?? setShowRecord(true);
  }

  return (
    <div className="game">
      <header className="top">
        <span className="brand">
          <BullLogo size={30} /> Bull Run
        </span>
        <RoundTracker s={s} />
        <div className="tools">
          <button
            onClick={copyRecord}
            disabled={sealing}
            title={sealing ? "Not while orders or bids are sealed: the record would reveal them" : "Seed and action log; loading it replays the game exactly"}
          >
            Copy record
          </button>
          <button
            onClick={() => {
              setFlash("");
              undo();
            }}
            disabled={record.actions.length === 0}
            title="Take back the last action (play-test only)"
          >
            Undo
          </button>
          {quitting ? (
            <>
              <button className="danger" onClick={quit}>
                Abandon game
              </button>
              <button onClick={() => setQuitting(false)}>Keep playing</button>
            </>
          ) : (
            <button onClick={() => setQuitting(true)}>Quit</button>
          )}
        </div>
      </header>
      {showRecord && (
        <div className="record-box">
          <label htmlFor="record-text">Game record — select all and copy it</label>
          <textarea id="record-text" readOnly value={recordText} onFocus={(e) => e.target.select()} />
          <button onClick={() => setShowRecord(false)}>Close</button>
        </div>
      )}

      <Ticker s={s} hist={hist} />
      {flash && (
        <div className="toast" role="status" onClick={() => setFlash("")}>
          {flash} <span className="muted small">(tap to dismiss)</span>
        </div>
      )}
      <div className="layout">
        <Board s={s} hist={hist} />
        <aside className="side">
          {s.phase.kind === "ended" ? (
            <EndScreen s={s} onNew={quit} />
          ) : who === null ? null : !shown ? (
            <PassDevice s={s} seat={who} onReady={() => setViewer(who)} />
          ) : (
            <Private s={s} seat={who} play={play} />
          )}
          <Players s={s} viewer={shown ? who : null} />
          <Market s={s} />
          <Log events={events} />
        </aside>
      </div>
    </div>
  );
}

function RoundTracker({ s }: { s: GameState }) {
  const n = s.config.rounds;
  return (
    <ol className="rounds" aria-label="Round tracker">
      <li className={s.round === 0 ? "now" : "past"} title="Round 0: the opening">
        0
      </li>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((r) => (
        <li
          key={r}
          className={[r === s.round ? "now" : r < s.round ? "past" : "", r > n ? "unused" : "", (DIVIDEND_ROUNDS as readonly number[]).includes(r) ? "div" : "", r === n ? "final" : "", r === IPO_ROUND && ipoEnabled(s.config) ? "ipo" : ""].join(" ")}
          title={`${(DIVIDEND_ROUNDS as readonly number[]).includes(r) ? "Dividend round. " : ""}${r === IPO_ROUND && ipoEnabled(s.config) ? "Zomato IPO at the start. " : ""}${r === n ? "Final round." : ""}`}
        >
          {r}
        </li>
      ))}
    </ol>
  );
}

// ─── Ticker ─────────────────────────────────────────────────────────────────────────────

function Ticker({ s, hist }: { s: GameState; hist: Record<CompanyId, PricePoint[]> }) {
  const live = COMPANY_IDS.filter((c) => s.companies[c].listed);
  return (
    <div className="ticker" aria-label="Prices and change this round">
      <span className="tick tick-label">{s.phase.kind === "ended" ? "Final round" : s.round === 0 ? "Opening" : `Round ${s.round}`}</span>
      {live.map((c) => (
        <span key={c} className="tick">
          <CompanyBadge c={c} size={18} />
          <span className="tick-name">{COMPANIES[c].short}</span>
          <b className="tick-price">{s.companies[c].bankrupt ? "BUST" : rs(price(s, c))}</b>
          <Change d={changeSinceLastRound(s, hist[c], c)} />
        </span>
      ))}
    </div>
  );
}

/** One company's price at each round end; 2px line, endpoint dot, a native tooltip per point. */
function Sparkline({ points, now, label }: { points: PricePoint[]; now: number | null; label: string }) {
  const pts = now === null ? points : [...points, { round: (points.at(-1)?.round ?? 0) + 0.5, price: now }];
  if (pts.length < 2) return <div className="spark-empty small muted">No history yet</div>;
  const W = 120, H = 34, P = 4;
  const xs = pts.map((p) => p.round), ys = pts.map((p) => p.price);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (r: number) => P + ((r - x0) / Math.max(1e-9, x1 - x0)) * (W - 2 * P);
  const Y = (v: number) => (y1 === y0 ? H / 2 : H - P - ((v - y0) / (y1 - y0)) * (H - 2 * P));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.round).toFixed(1)},${Y(p.price).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${pts.map((p) => rs(p.price)).join(", ")}`}>
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="spark-base" />
      <path d={d} fill="none" stroke="var(--co)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={X(p.round)} cy={Y(p.price)} r="7" fill="transparent">
          <title>{`${p.label ?? (p.round % 1 ? "Now" : `End of round ${p.round}`)}: ${rs(p.price)}`}</title>
        </circle>
      ))}
      <circle cx={X(last.round)} cy={Y(last.price)} r="3.5" fill="var(--co)" stroke="var(--panel)" strokeWidth="2" />
    </svg>
  );
}

// ─── Board ──────────────────────────────────────────────────────────────────────────────

function band(p: number): string {
  if (p >= 400) return "b3";
  if (p >= 225) return "b2";
  if (p >= 120) return "b1";
  return "b0";
}

function Board({ s, hist }: { s: GameState; hist: Record<CompanyId, PricePoint[]> }) {
  const spaces = [...TRACK.keys()].reverse();
  const tracks = COMPANY_IDS.filter((c) => !COMPANIES[c].ipo || ipoEnabled(s.config));
  return (
    <div className="board-scroll">
    <section className="board" aria-label="Price tracks" style={{ ["--tracks" as string]: tracks.length }}>
      {tracks.map((c) => {
        const co = COMPANIES[c];
        const st = s.companies[c];
        const out = outstanding(s, c);
        const ch = s.chairmen[c];
        const shorts = openShorts(s, c);
        return (
          <div key={c} className={`track ${st.listed ? "" : "unlisted"}`} style={coStyle(c)}>
            <div className="track-head">
              <div className="co-title">
                <CompanyBadge c={c} size={26} />
                <div>
                  <div className="co-name">{co.short}</div>
                  <div className="muted small">{co.sector}</div>
                </div>
              </div>
              {co.doubleDividend && <div className="tag">Double dividend</div>}
              {co.noDividend && <div className="tag">No dividend</div>}
            </div>
            <ol className="spaces">
              {spaces.map((i) => {
                const p = TRACK[i];
                const here = st.listed && st.priceIndex === i;
                const tokens = shorts.filter((t) => t.openIndex === i);
                return (
                  <li key={i} className={`space ${band(p)} ${here ? "here" : ""} ${i === 0 ? "bust" : ""} ${i === TOP ? "ceiling" : ""} ${!co.ipo && p === startPrice(s.config, c) ? "start" : ""}`}>
                    <span className="val">{i === 0 ? "BUST" : p}</span>
                    {tokens.map((t) => (
                      <span key={t.id} className="short-token" title={`${s.players[t.owner].name}'s short, opened at ${rs(p)}${capIndex(t.openIndex) === null ? ", no cap" : `, closes at ${rs(TRACK[capIndex(t.openIndex)!])}`}`}>
                        S·{s.players[t.owner].name.slice(0, 2)}
                      </span>
                    ))}
                    {here && <span className="marker" aria-label="current price" />}
                  </li>
                );
              })}
            </ol>
            <div className="track-foot">
              <div className="big">{!st.listed ? `IPO R${IPO_ROUND}` : st.bankrupt ? "Bankrupt" : rs(price(s, c))}</div>
              <Change d={changeSinceLastRound(s, hist[c], c)} />
              {st.listed && <Sparkline points={hist[c]} now={s.phase.kind === "ended" ? null : price(s, c)} label={`${co.short} price history`} />}
              <div title="Shares held by players minus open shorts">
                Outstanding <b>{out}</b>
              </div>
              <div className="thresholds">
                {THRESHOLDS.map((t) => (
                  <span key={t} className={out >= t ? "hit" : ""}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="muted small">Bank {bankShares(s, c)} · shorts {shorts.length}/3</div>
              <div className="small">Chairman: {ch === null ? "—" : s.players[ch].name}</div>
            </div>
          </div>
        );
      })}
      <div className="legend small muted">
        Dividend bands: <span className="sw b0" /> below ₹120 · <span className="sw b1" /> ₹120–200 ₹10 · <span className="sw b2" /> ₹225–350 ₹20 ·{" "}
        <span className="sw b3" /> ₹400–500 ₹30 (HUL, HDFC Bank double). Chairman (6+ shares) gets {CHAIRMAN_MULTIPLIER}× the per-share dividend.
        {ipoEnabled(s.config) && ` Zomato lists by sealed bids at the start of round ${IPO_ROUND} and pays no dividend.`}
      </div>
    </section>
    </div>
  );
}

// ─── Public panels ──────────────────────────────────────────────────────────────────────

function Players({ s, viewer }: { s: GameState; viewer: Seat | null }) {
  const who = actor(s);
  return (
    <section className="panel">
      <h2>Players</h2>
      <table className="players">
        <tbody>
          {s.players.map((p, i) => (
            <tr key={i} className={i === who ? "active" : ""}>
              <td>
                {p.name}
                {s.startPlayer === i && <span className="tag" title="Started round 1">1st</span>}
                {p.shortBanned && <span className="tag warn">no shorts</span>}
                {s.pendingNews[i] !== null && <span className="tag" title="Takes effect at the start of their next turn">card face-down</span>}
              </td>
              <td className="holdings">
                {COMPANY_IDS.filter((c) => p.shares[c] || openShorts(s, c, i).length).map((c) => (
                  <span key={c} className="chip" title={`${COMPANIES[c].short}: ${p.shares[c]} shares${openShorts(s, c, i).length ? `, ${openShorts(s, c, i).length} short` : ""}`}>
                    <CompanyBadge c={c} size={16} />
                    {p.shares[c] > 0 && <b>{p.shares[c]}</b>}
                    {openShorts(s, c, i).length > 0 && <span className="short-chip">short ×{openShorts(s, c, i).length}</span>}
                    {s.chairmen[c] === i && <span className="chair" title="Chairman">★</span>}
                  </span>
                ))}
              </td>
              <td className="num" title="Shares at current prices (public)">{rs(netWorth(s, i).sharesValue)}</td>
              <td className="num">{i === viewer ? rs(p.cash) : "cash hidden"}</td>
              <td className="num muted">{p.hand.length} cards</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Market({ s }: { s: GameState }) {
  return (
    <section className="panel">
      <h2>
        Card market <span className="muted small">· deck {s.deck.length} · played {s.discard.length}</span>
      </h2>
      <div className="cards">
        {s.market.map((id, i) => (id === null ? <div key={i} className="card empty">empty</div> : <NewsCardView key={i} id={id} />))}
      </div>
    </section>
  );
}

const TYPE_LABEL = { positive: "▲ Positive", negative: "▼ Negative", double: "⇅ Double-edged", market: "★ Market-wide" } as const;

function NewsCardView({ id, children, impact }: { id: number; children?: ReactNode; impact?: number }) {
  const k = card(id);
  return (
    <div className={`card ${k.type}`}>
      <div className="card-type">{TYPE_LABEL[k.type]}</div>
      <div className="card-title">{k.title}</div>
      <div className="effects">
        {k.type === "market" ? (
          <span className="eff">
            All companies <b>{signed(Object.values(k.effects)[0]!)}</b>
          </span>
        ) : (
          (Object.entries(k.effects) as [CompanyId, number][]).map(([c, v]) => (
            <span key={c} className="eff">
              <CompanyBadge c={c} size={16} /> {COMPANIES[c].short} <b>{signed(v)}</b>
            </span>
          ))
        )}
      </div>
      {impact !== undefined && (
        <div className={`impact ${impact > 0 ? "up" : impact < 0 ? "down" : "flat"}`} title="Effect on your holdings and shorts at today's prices">
          For you {impact === 0 ? "±₹0" : signedRs(impact)}
        </div>
      )}
      <div className="card-no">#{id}</div>
      {children}
    </div>
  );
}

function Log({ events }: { events: GameEvent[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length]);
  // Blind draws would reveal a card to everyone; the log says only that one was drawn.
  return (
    <section className="panel">
      <h2>Event log</h2>
      <ol className="log" ref={ref}>
        {events.map((e, i) => (
          <li key={i} className={`ev ${e.kind}`}>
            {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── Private: the active player's controls ──────────────────────────────────────────────

function PassDevice({ s, seat, onReady }: { s: GameState; seat: Seat; onReady: () => void }) {
  const why = s.debt ? `${s.players[seat].name} must sell shares to pay a forced close.` : s.phase.kind === "opening" ? "Write your secret opening orders." : s.phase.kind === "openingDraw" ? "Draw back up to 4 cards." : s.phase.kind === "ipo" ? "Place your secret Zomato IPO bid." : "Your turn.";
  return (
    <section className="panel pass">
      <h2>Pass the device to {s.players[seat].name}</h2>
      <p>{why}</p>
      <button className="primary" onClick={onReady}>
        I'm {s.players[seat].name} — show me
      </button>
    </section>
  );
}

function Private({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const p = s.players[seat];
  let body: ReactNode;
  if (s.debt) body = <ForcedSale s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "opening") body = <Opening s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "ipo") body = <IpoBidForm s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "openingDraw" || (s.phase.kind === "turn" && s.phase.step === "draw")) body = <Draw s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "turn") body = <Turn s={s} seat={seat} play={play} />;
  return (
    <section className="panel private">
      <h2>
        {p.name} <span className="cash">{rs(p.cash)}</span>
      </h2>
      {body}
      {s.phase.kind === "turn" && !s.debt && <MyPosition s={s} seat={seat} />}
    </section>
  );
}

function Opening({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const p = s.players[seat];
  const [orders, setOrders] = useState<Partial<Holdings>>({});
  const [pick, setPick] = useState<number | null>(null);
  const total = Object.values(orders).reduce((a, b) => a + (b ?? 0), 0);
  const listed = COMPANY_IDS.filter((c) => s.companies[c].listed);
  const cost = listed.reduce((n, c) => n + (orders[c] ?? 0) * price(s, c), 0);
  return (
    <>
      <p className="small">Round 0 — buy up to {OPENING_MAX_SHARES} shares in total at the starting prices (if a company is oversubscribed, shares are shared out in seat order), and place one news card face-down. Everything is revealed together.</p>
      <div className="orders">
        {listed.map((c) => (
          <div key={c} style={coStyle(c)} className="order">
            <span className="row-co">
              <CompanyBadge c={c} size={18} /> {COMPANIES[c].short} <span className="muted">{rs(price(s, c))}</span>
            </span>
            <span className="stepper">
              <button aria-label={`One fewer ${COMPANIES[c].short}`} onClick={() => setOrders({ ...orders, [c]: Math.max(0, (orders[c] ?? 0) - 1) })}>
                −
              </button>
              <b>{orders[c] ?? 0}</b>
              <button aria-label={`One more ${COMPANIES[c].short}`} disabled={total >= OPENING_MAX_SHARES} onClick={() => setOrders({ ...orders, [c]: (orders[c] ?? 0) + 1 })}>
                +
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="small">
        {total}/{OPENING_MAX_SHARES} shares · up to {rs(cost)} (less if oversubscribed)
      </p>
      <h3>Your hand — pick the card to place</h3>
      <div className="cards">
        {p.hand.map((id) => (
          <div key={id} className={`pickable ${pick === id ? "picked" : ""}`} onClick={() => setPick(id)}>
            <NewsCardView id={id} />
          </div>
        ))}
      </div>
      <button className="primary" disabled={pick === null} onClick={() => pick !== null && play({ type: "openingOrder", player: seat, orders, card: pick })}>
        Seal my orders
      </button>
    </>
  );
}

function IpoBidForm({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const band = ipoBandOf(s.config);
  const max = ipoMaxBidOf(s.config);
  const cash = s.players[seat].cash;
  const [qty, setQty] = useState(0);
  const [bid, setBid] = useState(band[0]);
  const cost = qty * bid;
  return (
    <>
      <h3>Zomato IPO — your sealed bid</h3>
      <p className="small">
        Bid for 0–{max} shares at one price. All bids are revealed together. The listing price is the highest price at which the shares bid at that
        price or more reach 12 (the lowest price if they never do). Bids above it are filled in full, bids at it share what is left one at a time clockwise
        from the start player, and bids below it get nothing. Everyone pays the listing price, then the price rises one step per 3, 6, 9 and 12 shares sold.
        Zomato pays no dividend and cannot be shorted until round {IPO_ROUND + 1}.
      </p>
      <div className="field">
        Shares
        <div className="seg" role="group" aria-label="Shares to bid for">
          {Array.from({ length: max + 1 }, (_, n) => (
            <button key={n} className={n === qty ? "on" : ""} onClick={() => setQty(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        Price per share
        <div className="seg" role="group" aria-label="Bid price">
          {band.map((p) => (
            <button key={p} className={p === bid ? "on" : ""} disabled={qty === 0} onClick={() => setBid(p)}>
              {rs(p)}
            </button>
          ))}
        </div>
      </div>
      <p className="small">
        {qty === 0 ? "No bid." : `Up to ${rs(cost)} if filled in full; you pay the listing price, which may be lower.`}
        {cost > cash && <span className="error"> You have {rs(cash)}.</span>}
      </p>
      <button className="primary" disabled={cost > cash} onClick={() => play({ type: "ipoBid", player: seat, qty, price: qty ? bid : 0 })}>
        Seal my bid
      </button>
    </>
  );
}

function Turn({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const ph = s.phase as Extract<GameState["phase"], { kind: "turn" }>;
  const p = s.players[seat];
  const [kind, setKind] = useState<TradeKind>("buy");
  const [company, setCompany] = useState<CompanyId>("HUL");
  const [qty, setQty] = useState(1);
  const action: Extract<Action, { type: "trade" }> = { type: "trade", player: seat, kind, company, qty };
  const pv = useMemo(() => previewTrade(s, action), [s, kind, company, qty]); // eslint-disable-line react-hooks/exhaustive-deps
  const legal = useMemo(() => apply(s, action), [s, kind, company, qty]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = 2 - ph.actionsUsed;
  return (
    <>
      <h3>1 · Trade <span className="muted small">({left} of 2 actions left)</span></h3>
      {left > 0 ? (
        <div className="trade">
          <div className="seg">
            {(["buy", "sell", "short", "cover"] as TradeKind[]).map((k) => (
              <button key={k} className={k === kind ? "on" : ""} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
          <div className="seg wrap">
            {COMPANY_IDS.filter((c) => s.companies[c].listed).map((c) => (
              <button key={c} className={`co-btn ${c === company ? "on" : ""}`} style={coStyle(c)} onClick={() => setCompany(c)}>
                <CompanyBadge c={c} size={16} /> {COMPANIES[c].short}
              </button>
            ))}
          </div>
          <div className="seg">
            {[1, 2, 3].map((n) => (
              <button key={n} className={n === qty ? "on" : ""} onClick={() => setQty(n)}>
                {n}
              </button>
            ))}
          </div>
          <div className="preview">
            {pv.ok ? (
              <>
                <div>
                  {kind === "buy" || kind === "cover" ? "Pay" : "Receive"} <b>{rs(pv.preview.total)}</b> ({pv.preview.prices.map(rs).join(" + ") || "nothing"})
                </div>
                {pv.preview.crossings.map((x, i) => (
                  <div key={i} className="small crossing">
                    {x}
                  </div>
                ))}
                {pv.preview.bankrupts && <div className="small error">This bankrupts the company.</div>}
              </>
            ) : (
              <div className="small muted">{pv.error}</div>
            )}
            {pv.ok && !legal.ok && <div className="small error">{legal.error}</div>}
          </div>
          <button className="primary" disabled={!legal.ok} onClick={() => play(action)}>
            Confirm {kind} {qty} {COMPANIES[company].short}
          </button>
        </div>
      ) : (
        <p className="small muted">Both actions used.</p>
      )}
      <h3>
        2 · Play a news card{" "}
        <span className="muted small">{s.config.delayedNews ? "(mandatory; goes face-down and takes effect at the start of your next turn)" : "(mandatory, applies at once)"}</span>
      </h3>
      <div className="cards">
        {p.hand.map((id) => (
          <NewsCardView key={id} id={id} impact={cardImpact(s, seat, id)}>
            <button className="play" onClick={() => play({ type: "playNews", player: seat, card: id })}>
              Play
            </button>
          </NewsCardView>
        ))}
      </div>
    </>
  );
}

function Draw({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const p = s.players[seat];
  return (
    <>
      <h3>{s.phase.kind === "openingDraw" ? "Draw back up to 4" : "3 · Draw a card"}</h3>
      <div className="cards">
        {s.market.map((id, slot) =>
          id === null ? null : (
            <NewsCardView key={slot} id={id} impact={cardImpact(s, seat, id)}>
              <button className="play" onClick={() => play({ type: "draw", player: seat, from: "market", slot })}>
                Take
              </button>
            </NewsCardView>
          ),
        )}
        <div className="card back">
          <div className="card-title">Deck</div>
          <div className="muted small">{s.deck.length || s.discard.length} cards</div>
          <button className="play" onClick={() => play({ type: "draw", player: seat, from: "deck" })}>
            Draw blind
          </button>
        </div>
      </div>
      {s.pendingNews[seat] !== null && (
        <>
          <h3>Your face-down card <span className="muted small">(takes effect at the start of your next turn)</span></h3>
          <div className="cards">
            <NewsCardView id={s.pendingNews[seat]!} />
          </div>
        </>
      )}
      <h3>Your hand</h3>
      <div className="cards">
        {p.hand.map((id) => (
          <NewsCardView key={id} id={id} />
        ))}
      </div>
    </>
  );
}

function ForcedSale({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const p = s.players[seat];
  const d = s.debt!;
  return (
    <>
      <p>
        You owe <b>{rs(d.amount)}</b> for a {d.reason} and have <b>{rs(p.cash)}</b>. Sell shares of your choice at current prices (thresholds apply) until you can pay. If you run out of shares you pay everything you have, the bank absorbs the rest, and you may not open shorts again.
      </p>
      <div className="orders">
        {COMPANY_IDS.filter((c) => p.shares[c] > 0 && !s.companies[c].bankrupt).map((c) => (
          <div key={c} className="order" style={coStyle(c)}>
            <span className="row-co">
              <CompanyBadge c={c} size={18} /> {COMPANIES[c].short} × {p.shares[c]} <span className="muted">{rs(price(s, c))}</span>
            </span>
            <button onClick={() => play({ type: "forcedSell", player: seat, company: c, qty: 1 })}>Sell 1</button>
          </div>
        ))}
      </div>
    </>
  );
}

function MyPosition({ s, seat }: { s: GameState; seat: Seat }) {
  const nw = netWorth(s, seat);
  const p = s.players[seat];
  const rows = COMPANY_IDS.filter((c) => p.shares[c] || openShorts(s, c, seat).length);
  return (
    <div className="position">
      <h3>Your position</h3>
      {rows.length === 0 ? (
        <p className="small muted">No shares or shorts yet.</p>
      ) : (
        <table>
          <tbody>
            {rows.map((c) => {
              const shorts = openShorts(s, c, seat);
              return (
                <tr key={c}>
                  <td className="row-co">
                    <CompanyBadge c={c} size={16} /> {COMPANIES[c].short}
                    {s.chairmen[c] === seat && <span className="tag">Chairman</span>}
                  </td>
                  <td className="num">{p.shares[c] ? `${p.shares[c]} × ${rs(price(s, c))}` : ""}</td>
                  <td className="small muted">
                    {shorts.map((t) => {
                      const cap = capIndex(t.openIndex);
                      return (
                        <div key={t.id}>
                          short from {rs(TRACK[t.openIndex])}, {cap === null ? "no cap" : `forced at ${rs(TRACK[cap])}`}
                        </div>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="small muted">
        Net worth {rs(nw.netWorth)} = cash {rs(nw.cash)} + shares {rs(nw.sharesValue)} − shorts to cover {rs(nw.shortsCost)}
      </p>
    </div>
  );
}

function EndScreen({ s, onNew }: { s: GameState; onNew: () => void }) {
  return (
    <section className="panel">
      <h2>Final standings</h2>
      <table className="standings">
        <thead>
          <tr>
            <th></th>
            <th>Player</th>
            <th>Cash</th>
            <th>Shares</th>
            <th>Shorts</th>
            <th>Net worth</th>
          </tr>
        </thead>
        <tbody>
          {s.standings!.map((x) => (
            <tr key={x.seat} className={x.rank === 1 ? "winner" : ""}>
              <td>
                <span className={`rank r${x.rank}`}>{x.rank === 1 ? "Winner" : `#${x.rank}`}</span>
              </td>
              <td>{x.name}</td>
              <td className="num">{rs(x.cash)}</td>
              <td className="num">{rs(x.sharesValue)}</td>
              <td className="num">−{rs(x.shortsCost)}</td>
              <td className="num">
                <b>{rs(x.netWorth)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Net worth = cash + shares × current price − cost to cover open shorts. Ties go to more cash; still tied is a shared win.</p>
      <button className="primary" onClick={onNew}>
        New game
      </button>
    </section>
  );
}
