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

const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

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
  const [error, setError] = useState("");

  function start() {
    const players = names.slice(0, count).map((n, i) => n.trim() || `Player ${i + 1}`);
    if (new Set(players).size !== players.length) return setError("Give every player a different name.");
    const startPrices = START_LAYOUTS[layout].prices;
    onStart({ players, rounds, seed: Number(seed) | 0, ...(startPrices ? { startPrices } : {}), ...(ipo ? {} : { ipo: false }) });
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
      <h1>
        Bull Run <span className="muted">play-test</span>
      </h1>
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
  const shown = who !== null && viewer === who;

  // A new actor hides everything private until they say it is them.
  useEffect(() => {
    if (who !== viewer) setViewer(null);
  }, [who]); // eslint-disable-line react-hooks/exhaustive-deps

  function play(a: Action) {
    const err = act(a);
    setFlash(err ?? "");
  }

  const [quitting, setQuitting] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const recordText = JSON.stringify(record);
  function copyRecord() {
    navigator.clipboard?.writeText(recordText).then(
      () => setFlash("Game record copied. Paste it on the setup screen to replay this game."),
      () => setShowRecord(true),
    ) ?? setShowRecord(true);
  }

  return (
    <div className="game">
      <header className="top">
        <strong className="brand">Bull Run</strong>
        <RoundTracker s={s} />
        <div className="tools">
          <button onClick={copyRecord} title="Seed and action log; loading it replays the game exactly">
            Copy record
          </button>
          <button onClick={undo} disabled={record.actions.length === 0} title="Take back the last action (play-test only)">
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

      <div className="layout">
        <Board s={s} />
        <aside className="side">
          {s.phase.kind === "ended" ? (
            <EndScreen s={s} onNew={quit} />
          ) : who === null ? null : !shown ? (
            <PassDevice s={s} seat={who} onReady={() => setViewer(who)} />
          ) : (
            <Private s={s} seat={who} play={play} flash={flash} clear={() => setFlash("")} />
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

// ─── Board ──────────────────────────────────────────────────────────────────────────────

function band(p: number): string {
  if (p >= 400) return "b3";
  if (p >= 225) return "b2";
  if (p >= 120) return "b1";
  return "b0";
}

function Board({ s }: { s: GameState }) {
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
          <div key={c} className={`track ${st.listed ? "" : "unlisted"}`} style={{ ["--co" as string]: co.colour }}>
            <div className="track-head">
              <div className="co-name">{co.short}</div>
              <div className="muted small">{co.sector}</div>
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
              </td>
              <td className="holdings">
                {COMPANY_IDS.filter((c) => p.shares[c] || openShorts(s, c, i).length).map((c) => (
                  <span key={c} className="chip" style={{ ["--co" as string]: COMPANIES[c].colour }}>
                    {COMPANIES[c].short} {p.shares[c] || ""}
                    {openShorts(s, c, i).length ? ` S${openShorts(s, c, i).length}` : ""}
                  </span>
                ))}
              </td>
              <td className="num">{i === viewer ? rs(p.cash) : "₹ hidden"}</td>
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

function NewsCardView({ id, children }: { id: number; children?: ReactNode }) {
  const k = card(id);
  return (
    <div className={`card ${k.type}`}>
      <div className="card-type">{TYPE_LABEL[k.type]}</div>
      <div className="card-title">{k.title}</div>
      <div className="effects">
        {(Object.entries(k.effects) as [CompanyId, number][]).length === 6 ? (
          <span className="eff">All {signed(Object.values(k.effects)[0]!)}</span>
        ) : (
          (Object.entries(k.effects) as [CompanyId, number][]).map(([c, v]) => (
            <span key={c} className="eff" style={{ ["--co" as string]: COMPANIES[c].colour }}>
              {COMPANIES[c].short} <b>{signed(v)}</b>
            </span>
          ))
        )}
      </div>
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

function Private({ s, seat, play, flash, clear }: { s: GameState; seat: Seat; play: (a: Action) => void; flash: string; clear: () => void }) {
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
      {flash && (
        <p className="error" onClick={clear}>
          {flash}
        </p>
      )}
      {body}
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
          <div key={c} style={{ ["--co" as string]: COMPANIES[c].colour }} className="order">
            <span>
              {COMPANIES[c].short} <span className="muted">{rs(price(s, c))}</span>
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
              <button key={c} className={c === company ? "on" : ""} style={{ ["--co" as string]: COMPANIES[c].colour }} onClick={() => setCompany(c)}>
                {COMPANIES[c].short}
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
      <h3>2 · Play a news card <span className="muted small">(mandatory, applies at once)</span></h3>
      <div className="cards">
        {p.hand.map((id) => (
          <NewsCardView key={id} id={id}>
            <button className="play" onClick={() => play({ type: "playNews", player: seat, card: id })}>
              Play
            </button>
          </NewsCardView>
        ))}
      </div>
      <MyPosition s={s} seat={seat} />
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
            <NewsCardView key={slot} id={id}>
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
          <div key={c} className="order" style={{ ["--co" as string]: COMPANIES[c].colour }}>
            <span>
              {COMPANIES[c].short} × {p.shares[c]} <span className="muted">{rs(price(s, c))}</span>
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
  return (
    <p className="small muted">
      Net worth now {rs(nw.netWorth)} = cash {rs(nw.cash)} + shares {rs(nw.sharesValue)} − shorts to cover {rs(nw.shortsCost)}
    </p>
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
              <td>{x.rank === 1 ? "🏆" : x.rank}</td>
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
