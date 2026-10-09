import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CHAIRMAN_MULTIPLIER,
  CHAIRMAN_SHARES,
  COMPANIES,
  DIVIDEND_BANDS,
  dividendPerShare,
  COMPANY_IDS,
  DIVIDEND_ROUNDS,
  GAME_LENGTHS,
  HANDOVER_START_PRICES,
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
import { CompanyBadge } from "./logos.tsx";
import { Avatar, Confetti, Icon } from "./ui.tsx";
import { changeSinceLastRound, priceHistory, type PricePoint } from "./history.ts";

export const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
export const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
export const signedRs = (n: number) => (n > 0 ? `+${rs(n)}` : n < 0 ? `−${rs(-n)}` : "±₹0");
/** Company colours are theme tokens (--co-HUL…), so dark mode gets its own validated steps. */
/** What a share of `c` pays at today's price under this game's rules. */
export const paysNow = (s: GameState, c: CompanyId) => dividendPerShare(c, price(s, c), s.config.dividendBands, s.config.ipoPaysDividend === true && COMPANIES[c].ipo === true);
export const paysNoDividend = (s: GameState, c: CompanyId) => COMPANIES[c].noDividend === true && s.config.ipoPaysDividend !== true;
export const coStyle = (c: CompanyId) => ({ ["--co" as string]: `var(--co-${c})` });

/** Up/down/flat as an arrow and a word as well as a colour, so it never relies on colour alone. */
export function Change({ d }: { d: number | null }) {
  if (d === null) return null;
  const dir = d > 0 ? "up" : d < 0 ? "down" : "flat";
  return (
    <span className={`chg ${dir}`}>
      <span aria-hidden="true">{d > 0 ? "▲" : d < 0 ? "▼" : "■"}</span> {d === 0 ? "flat" : signedRs(d)}
    </span>
  );
}

/** Rupee effect of a card on a seat's position at today's prices (ignores caps and thresholds). */
/** Whether this is the last round, when a face-down card is never revealed. */
export const lastRound = (s: GameState) => s.round >= s.config.rounds;

export function cardImpact(s: GameState, seat: Seat, id: number): number {
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

export function RoundTracker({ s }: { s: GameState }) {
  const n = s.config.rounds;
  const isDiv = (r: number) => (DIVIDEND_ROUNDS as readonly number[]).includes(r);
  const isIpo = (r: number) => r === IPO_ROUND && ipoEnabled(s.config);
  const ended = s.phase.kind === "ended";
  return (
    <ol className="rail" aria-label={ended ? "Game over" : `Round ${s.round} of ${n}`} style={{ ["--n" as string]: n + 1 }}>
      {Array.from({ length: n + 1 }, (_, r) => {
        const state = ended || r < s.round ? "past" : r === s.round ? "now" : "next";
        const marks = [isDiv(r) && "Dividends at the end", isIpo(r) && "Oracle Group IPO at the start", r === n && "Final round"].filter(Boolean).join(" · ");
        return (
          <li key={r} className={`rail-step ${state} ${r === n ? "final" : ""}`} title={`${r === 0 ? "Round 0: the opening" : `Round ${r}`}${marks ? ` — ${marks}` : ""}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="rail-dot">{r}</span>
            <span className="rail-mark" aria-hidden="true">
              {isIpo(r) ? <Icon name="rocket" size={12} /> : isDiv(r) ? "₹" : r === n ? <Icon name="flag" size={12} /> : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Ticker ─────────────────────────────────────────────────────────────────────────────

export function Ticker({ s, hist }: { s: GameState; hist: Record<CompanyId, PricePoint[]> }) {
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
export function Sparkline({ points, now, label }: { points: PricePoint[]; now: number | null; label: string }) {
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

/** Shade a space by how much a share pays there, under the game's own dividend table. */
export function bandsOf(s: GameState) {
  return [...(s.config.dividendBands ?? DIVIDEND_BANDS)].sort((a, b) => a.from - b.from);
}
export function band(s: GameState, p: number): string {
  const bs = bandsOf(s);
  const here = [...bs].reverse().find((b) => p > 0 && p >= b.from);
  if (!here || here.pays === 0) return "b0";
  // One shade per distinct amount paid, so every change in the dividend shows on the track.
  const levels = [...new Set(bs.map((b) => b.pays).filter((x) => x > 0))].sort((a, b) => a - b);
  return `b${Math.min(4, levels.indexOf(here.pays) + 1)}`;
}
export function dividendLegend(s: GameState): string {
  const bs = bandsOf(s);
  return bs
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.pays > 0)
    .map(({ b, i }) => {
      const next = bs[i + 1];
      const top = next ? TRACK.filter((p) => p < next.from).at(-1)! : TRACK.at(-1)!;
      return `${rs(b.from)}–${rs(top)} ${rs(b.pays)}`;
    })
    .join(" · ");
}

export function Board({ s, hist }: { s: GameState; hist: Record<CompanyId, PricePoint[]> }) {
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
              {paysNoDividend(s, c) && <div className="tag">No dividend</div>}
            </div>
            <ol className="spaces">
              {spaces.map((i) => {
                const p = TRACK[i];
                const here = st.listed && st.priceIndex === i;
                const tokens = shorts.filter((t) => t.openIndex === i);
                return (
                  <li key={i} className={`space ${band(s, p)} ${here ? "here" : ""} ${i === 0 ? "bust" : ""} ${i === TOP ? "ceiling" : ""} ${!co.ipo && p === startPrice(s.config, c) ? "start" : ""}`}>
                    <span className="val">{i === 0 ? "BUST" : p}</span>
                    {tokens.map((t) => (
                      <span key={t.id} className="short-token" title={`${s.players[t.owner].name}'s short, opened at ${rs(p)}${capIndex(t.openIndex) === null ? ", no cap" : `, closes at ${rs(TRACK[capIndex(t.openIndex)!])}`}`}>
                        S{t.owner + 1}·{s.players[t.owner].name.slice(0, 1)}
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
              {st.listed && !st.bankrupt && (
                <div className="small" title="Dividend a share if it were paid now">
                  Pays {rs(paysNow(s, c))}
                </div>
              )}
              <div className="small">Chairman: {ch === null ? "—" : s.players[ch].name}</div>
            </div>
          </div>
        );
      })}
      <div className="legend small muted">
        Dividend a share: {dividendLegend(s)}, nothing below. HUL and HDFC Bank pay double{s.config.ipoPaysDividend ? "" : "; Oracle Group pays none"}. The chairman ({CHAIRMAN_SHARES}+ shares) also gets a bonus of{" "}
        {s.config.chairmanMultiplier ?? CHAIRMAN_MULTIPLIER}× the per-share dividend, on top of their own shares' dividends. Each open short pays the per-share dividend. Paid at the end of rounds {DIVIDEND_ROUNDS.filter((r) => r <= s.config.rounds).join(", ")}.
        {ipoEnabled(s.config) && ` Oracle Group lists by sealed bids at the start of round ${IPO_ROUND}.`}
      </div>
    </section>
    </div>
  );
}

// ─── Public panels ──────────────────────────────────────────────────────────────────────

export function Players({ s, viewer }: { s: GameState; viewer: Seat | null }) {
  const who = actor(s);
  return (
    <section className="panel">
      <h2>Players</h2>
      <ul className="player-list">
        {s.players.map((p, i) => {
          const worth = netWorth(s, i).sharesValue;
          const held = COMPANY_IDS.filter((c) => p.shares[c] || openShorts(s, c, i).length);
          return (
            <li key={i} className={`player-card ${i === who ? "active" : ""} ${i === viewer ? "me" : ""}`}>
              <div className="player-top">
                <Avatar name={p.name} seat={i} size={36} ring={i === who} />
                <div className="player-name">
                  <b>
                    {p.name}
                    {i === viewer && <span className="tag">you</span>}
                  </b>
                  <span className="muted small">
                    {i === who && s.phase.kind !== "ended" ? "Thinking… · " : ""}
                    {p.hand.length} cards
                    {s.startPlayer === i && " · started round 1"}
                  </span>
                </div>
                <div className="player-money">
                  <span className="num">{i === viewer ? rs(p.cash) : "₹ ••••"}</span>
                  <span className="muted small">cash</span>
                </div>
              </div>
              <div className="holdings">
                {held.length === 0 && <span className="muted small">No shares yet</span>}
                {held.map((c) => (
                  <span key={c} className="chip" style={coStyle(c)} title={`${COMPANIES[c].short}: ${p.shares[c]} shares${openShorts(s, c, i).length ? `, ${openShorts(s, c, i).length} short` : ""}`}>
                    <CompanyBadge c={c} size={18} />
                    {p.shares[c] > 0 && <b>{p.shares[c]}</b>}
                    {openShorts(s, c, i).length > 0 && <span className="short-chip">S×{openShorts(s, c, i).length}</span>}
                    {s.chairmen[c] === i && (
                      <span className="chair" title="Chairman">
                        ★
                      </span>
                    )}
                  </span>
                ))}
              </div>
              <div className="player-foot small">
                <span>
                  Shares worth <b className="num">{rs(worth)}</b>
                </span>
                {p.shortBanned && <span className="tag warn">no shorts</span>}
                {s.pendingNews[i] !== null && s.pendingNews[i] !== undefined && <span className="tag">card face-down</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Market({ s }: { s: GameState }) {
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

export const TYPE_LABEL = { positive: "Positive", negative: "Negative", double: "Double-edged", market: "Market-wide" } as const;
const TYPE_ICON = { positive: "▲", negative: "▼", double: "⇅", market: "★" } as const;

/** A news card, laid out like a clipping from the business pages. */
export function NewsCardView({ id, children, impact, picked }: { id: number; children?: ReactNode; impact?: number; picked?: boolean }) {
  const k = card(id);
  return (
    <div className={`card ${k.type} ${picked ? "picked" : ""}`}>
      <div className="card-mast">
        <span className="card-type">
          <span aria-hidden="true">{TYPE_ICON[k.type]}</span> {TYPE_LABEL[k.type]}
        </span>
        <span className="card-no">No. {id}</span>
      </div>
      <div className="card-title">{k.title}</div>
      <div className="effects">
        {k.type === "market" ? (
          <span className="eff">
            <span className="eff-co">All companies</span> <b className={Object.values(k.effects)[0]! > 0 ? "up" : "down"}>{signed(Object.values(k.effects)[0]!)}</b>
          </span>
        ) : (
          (Object.entries(k.effects) as [CompanyId, number][]).map(([c, v]) => (
            <span key={c} className="eff">
              <CompanyBadge c={c} size={18} /> <span className="eff-co">{COMPANIES[c].short}</span> <b className={v > 0 ? "up" : "down"}>{signed(v)}</b>
            </span>
          ))
        )}
      </div>
      {impact !== undefined && (
        <div className={`impact ${impact > 0 ? "up" : impact < 0 ? "down" : "flat"}`} title="Effect on your holdings and shorts at today's prices">
          For you today {impact === 0 ? "±₹0" : signedRs(impact)}
        </div>
      )}
      {picked && (
        <span className="picked-mark" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      )}
      {children}
    </div>
  );
}

export function Log({ events }: { events: GameEvent[] }) {
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

export function Private({ s, seat, play, busy }: { s: GameState; seat: Seat; play: (a: Action) => void; busy?: boolean }) {
  const p = s.players[seat];
  let body: ReactNode;
  if (s.debt) body = <ForcedSale s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "opening") body = <Opening s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "ipo") body = <IpoBidForm s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "openingDraw" || (s.phase.kind === "turn" && s.phase.step === "draw")) body = <Draw s={s} seat={seat} play={play} />;
  else if (s.phase.kind === "turn") body = <Turn s={s} seat={seat} play={play} />;
  return (
    <section className="panel private">
      <DeskHead s={s} seat={seat} />
      {/* A disabled fieldset turns off every control inside it while a move is on its way. */}
      <fieldset className="desk-controls" disabled={busy} aria-busy={busy}>
        {body}
      </fieldset>
      {s.phase.kind === "turn" && !s.debt && <MyPosition s={s} seat={seat} />}
    </section>
  );
}

/** The top of your desk: who you are and the cash you have. */
export function DeskHead({ s, seat, note }: { s: GameState; seat: Seat; note?: string }) {
  const p = s.players[seat];
  return (
    <div className="desk-head">
      <Avatar name={p.name} seat={seat} size={40} />
      <div className="desk-who">
        <b>{p.name}</b>
        <span className="muted small">{note ?? "Your desk"}</span>
      </div>
      <div className="desk-cash">
        <span className="muted small">Cash</span>
        <span className="cash">{rs(p.cash)}</span>
      </div>
    </div>
  );
}

export function Opening({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const p = s.players[seat];
  const [orders, setOrders] = useState<Partial<Holdings>>({});
  const [pick, setPick] = useState<number | null>(null);
  const total = Object.values(orders).reduce((a, b) => a + (b ?? 0), 0);
  const listed = COMPANY_IDS.filter((c) => s.companies[c].listed);
  const cost = listed.reduce((n, c) => n + (orders[c] ?? 0) * price(s, c), 0);
  return (
    <>
      <div className="step-head">
        <span className="step-no">1</span>
        <div>
          <b>Buy up to {OPENING_MAX_SHARES} shares</b>
          <span className="muted small">At the starting prices. Oversubscribed companies are shared out in seat order.</span>
        </div>
      </div>
      <div className="orders">
        {listed.map((c) => (
          <div key={c} style={coStyle(c)} className={`order ${(orders[c] ?? 0) > 0 ? "has" : ""}`}>
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
      <div className="meter" aria-label={`${total} of ${OPENING_MAX_SHARES} shares`}>
        {Array.from({ length: OPENING_MAX_SHARES }, (_, i) => (
          <span key={i} className={i < total ? "on" : ""} />
        ))}
        <span className="meter-text small">
          {total === 0 ? "No shares yet — buying none is allowed" : `${total} of ${OPENING_MAX_SHARES} · up to ${rs(cost)}${cost > p.cash ? " — more than your cash" : ""}`}
        </span>
      </div>
      <div className="step-head">
        <span className="step-no">2</span>
        <div>
          <b>Place one news card face-down</b>
          <span className="muted small">Everything is revealed together.</span>
        </div>
      </div>
      <div className="cards">
        {p.hand.map((id) => (
          <button key={id} type="button" className="pickable" aria-pressed={pick === id} onClick={() => setPick(id)}>
            <NewsCardView id={id} picked={pick === id} />
          </button>
        ))}
      </div>
      <div className="dock">
        <button className="primary big" disabled={pick === null || cost > p.cash} onClick={() => pick !== null && play({ type: "openingOrder", player: seat, orders, card: pick })}>
          {pick === null ? "Pick a card to place" : cost > p.cash ? "Not enough cash" : "Seal my orders"}
        </button>
      </div>
    </>
  );
}

export function IpoBidForm({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const band = ipoBandOf(s.config);
  const max = ipoMaxBidOf(s.config);
  const cash = s.players[seat].cash;
  const [qty, setQty] = useState(0);
  const [bid, setBid] = useState(band[0]);
  const cost = qty * bid;
  return (
    <>
      <div className="step-head">
        <span className="step-no">
          <Icon name="rocket" size={16} />
        </span>
        <div>
          <b>Oracle Group IPO — your sealed bid</b>
          <span className="muted small">Price band {rs(band[0])}–{rs(band[band.length - 1])}</span>
        </div>
      </div>
      <ul className="ipo-rules small">
        <li>Bid for 0–{max} shares at one price. Everyone's bid is revealed together.</li>
        <li>The listing price is the highest price where the shares bid at it or above reach 12 ({rs(band[0])} if they never do).</li>
        <li>Bids above it are filled in full; bids at it share what's left, one at a time from the start player; bids below get nothing.</li>
        <li>Everyone pays the listing price, not their bid. Then the price rises a step for each of 3, 6, 9 and 12 shares sold.</li>
        <li>
          {s.config.ipoPaysDividend ? "Oracle Group pays dividends like the others" : "Oracle Group pays no dividend"}, and it can't be shorted until round {IPO_ROUND + 1}.
        </li>
      </ul>
      <div className="field">
        <span className="field-label">Shares</span>
        <div className="seg" role="group" aria-label="Shares to bid for">
          {Array.from({ length: max + 1 }, (_, n) => (
            <button key={n} className={n === qty ? "on" : ""} onClick={() => setQty(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Price per share</span>
        <div className="seg seg-fill" role="group" aria-label="Bid price">
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
      <div className="dock">
        <button className="primary big" disabled={cost > cash} onClick={() => play({ type: "ipoBid", player: seat, qty, price: qty ? bid : 0 })}>
          {qty === 0 ? "Seal my bid (no shares)" : "Seal my bid"}
        </button>
      </div>
    </>
  );
}

export function Turn({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
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
      <div className="step-head">
        <span className="step-no">1</span>
        <div>
          <b>Trade</b>
          <span className="muted small">Up to 2 actions — {left} left</span>
        </div>
        <span className="pips" aria-hidden="true">
          <span className={left >= 1 ? "on" : ""} />
          <span className={left >= 2 ? "on" : ""} />
        </span>
      </div>
      {left > 0 ? (
        <div className="trade">
          <div className="seg seg-fill kinds" role="group" aria-label="Trade">
            {(["buy", "sell", "short", "cover"] as TradeKind[]).map((k) => (
              <button key={k} className={`kind-${k} ${k === kind ? "on" : ""}`} aria-pressed={k === kind} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
          <div className="seg co-grid" role="group" aria-label="Company">
            {COMPANY_IDS.filter((c) => s.companies[c].listed).map((c) => (
              <button key={c} className={`co-btn ${c === company ? "on" : ""}`} style={coStyle(c)} aria-pressed={c === company} onClick={() => setCompany(c)}>
                <CompanyBadge c={c} size={20} />
                <span className="co-btn-text">
                  <span>{COMPANIES[c].short}</span>
                  <span className="num small">{s.companies[c].bankrupt ? "bust" : rs(price(s, c))}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="field inline">
            <span className="field-label">Shares</span>
            <div className="seg seg-fill" role="group" aria-label="Number of shares">
              {[1, 2, 3].map((n) => (
                <button key={n} className={n === qty ? "on" : ""} aria-pressed={n === qty} onClick={() => setQty(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className={`preview kind-${kind}`}>
            {pv.ok ? (
              <>
                <div className="preview-main">
                  <span className="muted">{kind === "buy" || kind === "cover" ? "You pay" : "You receive"}</span>
                  <b className="preview-total">{rs(pv.preview.total)}</b>
                </div>
                {pv.preview.prices.length > 1 && <div className="small muted">{pv.preview.prices.map(rs).join(" + ")}</div>}
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
          <button className={`primary big confirm-${kind}`} disabled={!legal.ok} onClick={() => play(action)}>
            Confirm {kind} {qty} {COMPANIES[company].short}
          </button>
        </div>
      ) : (
        <p className="done-note">
          <Icon name="check" size={16} /> Both actions used — now play a card.
        </p>
      )}
      <div className="step-head">
        <span className="step-no">2</span>
        <div>
          <b>Play a news card</b>
          <span className="muted small">{s.config.delayedNews === false ? "Required. It applies at once." : lastRound(s) ? "Required. It goes face-down, but this is the final round: the game ends before it is revealed." : "Required. It goes face-down and takes effect at the start of your next turn."}</span>
        </div>
      </div>
      <div className="cards">
        {p.hand.map((id) => (
          <NewsCardView key={id} id={id} impact={cardImpact(s, seat, id)}>
            <button className="play primary" onClick={() => play({ type: "playNews", player: seat, card: id })}>
              {s.config.delayedNews !== false ? "Place face-down" : "Play this card"}
            </button>
          </NewsCardView>
        ))}
      </div>
    </>
  );
}

export function Draw({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const p = s.players[seat];
  return (
    <>
      <div className="step-head">
        <span className="step-no">{s.phase.kind === "openingDraw" ? <Icon name="plus" size={16} /> : 3}</span>
        <div>
          <b>{s.phase.kind === "openingDraw" ? "Draw back up to 4" : "Draw a card"}</b>
          <span className="muted small">Take one from the market, or draw blind from the deck.</span>
        </div>
      </div>
      <div className="cards">
        {s.market.map((id, slot) =>
          id === null ? null : (
            <NewsCardView key={slot} id={id} impact={cardImpact(s, seat, id)}>
              <button className="play primary" onClick={() => play({ type: "draw", player: seat, from: "market", slot })}>
                Take
              </button>
            </NewsCardView>
          ),
        )}
        <div className="card back">
          <div className="deck-face" aria-hidden="true">
            <span>?</span>
          </div>
          <div className="deck-count small">{s.deck.length || s.discard.length} cards in the deck</div>
          <button className="play primary" onClick={() => play({ type: "draw", player: seat, from: "deck" })}>
            Draw blind
          </button>
        </div>
      </div>
      {s.pendingNews[seat] !== null && (
        <>
          <h3>Your face-down card <span className="muted small">({lastRound(s) ? "the game ends before it is revealed" : "takes effect at the start of your next turn"})</span></h3>
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

export function ForcedSale({ s, seat, play }: { s: GameState; seat: Seat; play: (a: Action) => void }) {
  const p = s.players[seat];
  const d = s.debt!;
  return (
    <>
      <p className="alert">
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

export function MyPosition({ s, seat }: { s: GameState; seat: Seat }) {
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

export function EndScreen({ s, viewer, onNew }: { s: GameState; viewer: Seat | null; onNew: () => void }) {
  const st = s.standings!;
  const podium = [st[1], st[0], st[2]].filter(Boolean);
  const mine = viewer === null ? null : st.find((x) => x.seat === viewer);
  const winners = st.filter((x) => x.rank === 1).map((x) => x.name);
  return (
    <section className="panel end">
      {mine?.rank === 1 && <Confetti />}
      <div className="end-head">
        <Icon name="trophy" size={34} />
        <div>
          <p className="eyebrow">Closing bell</p>
          <h2>{mine ? (mine.rank === 1 ? (winners.length > 1 ? "A shared win!" : "You won the market!") : `You finished #${mine.rank}`) : `${winners.join(" & ")} won`}</h2>
        </div>
      </div>
      <div className="podium" aria-hidden="true">
        {podium.map((x) => (
          <div key={x.seat} className={`podium-col p${x.rank}`}>
            <Avatar name={x.name} seat={x.seat} size={x.rank === 1 ? 52 : 40} ring={x.rank === 1} />
            <b className="podium-name">{x.name}</b>
            <span className="num small">{rs(x.netWorth)}</span>
            <div className="podium-block">{x.rank}</div>
          </div>
        ))}
      </div>
      <table className="standings">
        <thead>
          <tr>
            <th></th>
            <th>Player</th>
            <th className="num">Cash</th>
            <th className="num">Shares</th>
            <th className="num">Shorts</th>
            <th className="num">Net worth</th>
          </tr>
        </thead>
        <tbody>
          {st.map((x) => (
            <tr key={x.seat} className={`${x.rank === 1 ? "winner" : ""} ${x.seat === viewer ? "me" : ""}`}>
              <td>
                <span className={`rank r${x.rank}`}>{x.rank === 1 ? "1st" : `#${x.rank}`}</span>
              </td>
              <td>{x.name}</td>
              <td className="num">{rs(x.cash)}</td>
              <td className="num">{rs(x.sharesValue)}</td>
              <td className="num">{x.shortsCost ? `−${rs(x.shortsCost)}` : "—"}</td>
              <td className="num">
                <b>{rs(x.netWorth)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Net worth = cash + shares × current price − cost to cover open shorts. Ties go to more cash; still tied is a shared win.</p>
      <button className="primary big" onClick={onNew}>
        Back to my games
      </button>
    </section>
  );
}
