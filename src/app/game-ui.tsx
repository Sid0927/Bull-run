/** The game screen's reading aids: the header, what just happened, turn notifications and prices. */
import { useEffect, useState } from "react";
import { COMPANIES, COMPANY_IDS, DIVIDEND_ROUNDS, IPO_ROUND, THRESHOLDS, TRACK, capIndex, ipoEnabled, openShorts, outstanding, price, type CompanyId, type GameState, type Seat } from "../engine/index.ts";
import type { Summary } from "./activity.ts";
import type { PricePoint } from "./history.ts";
import { changeSinceLastRound } from "./history.ts";
import { CompanyBadge } from "./logos.tsx";
import { Change, Sparkline, band, chairOf, coStyle, paysNow, rs } from "./parts.tsx";
import { Avatar, Icon, clock } from "./ui.tsx";

/** One line above everything: the round, what this round holds, whose move, and your cash. */
export function Hud({ s, status, sub, mine, mySeat, waitingOn }: { s: GameState; status: string; sub: string; mine: boolean; mySeat: Seat | null; waitingOn: Seat[] }) {
  const ended = s.phase.kind === "ended";
  const isDiv = (DIVIDEND_ROUNDS as readonly number[]).includes(s.round) && s.round <= s.config.rounds;
  const notes = [
    s.round === 0 && !ended ? "Opening" : null,
    !ended && s.round > 0 && s.round === IPO_ROUND && ipoEnabled(s.config) ? "Oracle IPO this round — its news cards join the deck" : null,
    !ended && s.round > 0 && isDiv ? "Dividends after this round" : null,
    !ended && s.round === s.config.rounds ? "Final round" : null,
  ].filter(Boolean);
  return (
    <div className={`hud ${mine ? "mine" : ""} ${ended ? "over" : ""}`}>
      <div className="hud-round" aria-label={ended ? "Game over" : `Round ${s.round} of ${s.config.rounds}`}>
        <span className="hud-r">{ended ? "End" : s.round === 0 ? "R0" : `R${s.round}`}</span>
        <span className="hud-of">of {s.config.rounds}</span>
      </div>
      <div className="hud-status" role="status">
        <b>
          {mine && <span className="pulse-dot light" />}
          {!mine && !ended && waitingOn.length > 0 && <Avatar name={s.players[waitingOn[0]].name} seat={waitingOn[0]} size={20} />}
          {status}
        </b>
        <span className="hud-sub">{[sub, ...notes].filter(Boolean).join(" · ")}</span>
      </div>
      {mySeat !== null && (
        <div className="hud-cash">
          <span>Cash</span>
          <b>{rs(s.players[mySeat].cash)}</b>
        </div>
      )}
    </div>
  );
}

/** A summary as a card: who, what they did, and how prices moved. */
export function SummaryCard({ x, s, at, latest, max }: { x: Summary; s: GameState; at: string | null; latest?: boolean; max?: number }) {
  // A long summary on the Latest card is cut short; the rest is a tap away under What happened.
  const cut = max !== undefined && x.lines.length > max + 1;
  // A payout keeps its "In all" line, which is the one everybody looks for.
  const lines = !cut ? x.lines : x.kind === "dividends" ? [...x.lines.slice(0, max - 1), x.lines[x.lines.length - 1]] : x.lines.slice(0, max);
  return (
    <article className={`sum ${latest ? "latest" : ""} ${x.done ? "" : "live"} sum-${x.kind}`}>
      <header>
        {x.player !== null ? <Avatar name={s.players[x.player].name} seat={x.player} size={26} /> : <span className="sum-icon"><Icon name={x.kind === "dividends" ? "coin" : x.kind === "ipo" ? "rocket" : "flag"} size={16} /></span>}
        <b>{x.title}</b>
        <span className="sum-meta">
          {!x.done && <span className="sum-live">now</span>}
          {x.round > 0 && <span>R{x.round}</span>}
          {at && <time dateTime={at}>{clock(at)}</time>}
        </span>
      </header>
      {x.lines.length > 0 && (
        <ul>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
          {cut && <li className="sum-more">and {x.lines.length - max!} more — tap to see all</li>}
        </ul>
      )}
      {x.moves.length > 0 && (
        <div className="sum-moves">
          {x.moves.map((m) => (
            <span key={m.company} className={`move ${m.to > m.from ? "up" : "down"}`} style={coStyle(m.company)}>
              <CompanyBadge c={m.company} size={16} /> {COMPANIES[m.company].short} {rs(m.from)} → <b>{rs(m.to)}</b>
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/** Everything that has happened, newest first, a summary per turn. */
export function Activity({ sums, s, times, limit }: { sums: Summary[]; s: GameState; times: (string | null)[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? sums.slice(0, limit) : sums;
  return (
    <section className="panel activity" aria-label="What happened">
      <h2>
        <Icon name="book" /> What happened
      </h2>
      {sums.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <div className="sum-list">
          {shown.map((x, i) => (
            <SummaryCard key={x.id} x={x} s={s} at={times[x.last] ?? null} latest={i === 0} />
          ))}
        </div>
      )}
      {limit && sums.length > limit && (
        <button className="ghost-link" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${sums.length}`}
        </button>
      )}
    </section>
  );
}

/** Pop-ups for turns that just finished, so nobody misses what changed. They fade after a while. */
export function Notifications({ items, onClose }: { items: { key: number; x: Summary }[]; onClose: (key: number) => void }) {
  return (
    <div className="notes" aria-live="polite">
      {items.map(({ key, x }) => (
        <Note key={key} x={x} onClose={() => onClose(key)} />
      ))}
    </div>
  );
}

function Note({ x, onClose }: { x: Summary; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <button className="note" onClick={onClose} aria-label={`${x.title}: ${x.lines.join(". ")}. Tap to close.`}>
      <b>{x.title}</b>
      <span className="note-lines">{x.lines.slice(-4).join(" · ")}</span>
      {x.moves.length > 0 && (
        <span className="note-moves">
          {x.moves.map((m) => (
            <span key={m.company} className={m.to > m.from ? "up" : "down"}>
              {COMPANIES[m.company].short} {m.to > m.from ? "▲" : "▼"} {rs(m.to)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/** Prices as a table: a row per company with the track strip, so the whole market fits a screen. */
export function MarketTable({ s, hist }: { s: GameState; hist: Record<CompanyId, PricePoint[]> }) {
  const tracks = COMPANY_IDS.filter((c) => !COMPANIES[c].ipo || ipoEnabled(s.config));
  return (
    <section className="panel mtable" aria-label="Prices">
      <h2>
        <Icon name="chart" /> Prices
      </h2>
      <div className="mrows">
        {tracks.map((c) => {
          const co = COMPANIES[c];
          const st = s.companies[c];
          const out = outstanding(s, c);
          const shorts = openShorts(s, c);
          const chair = chairOf(s, c);
          return (
            <div key={c} className={`mrow ${st.listed ? "" : "unlisted"}`} style={coStyle(c)}>
              <div className="mrow-top">
                <CompanyBadge c={c} size={30} />
                <div className="mrow-name">
                  <b>{co.short}</b>
                  <span className="muted small">
                    {co.sector}
                    {co.doubleDividend ? " · 2× dividend" : co.noDividend ? " · no dividend" : ""}
                  </span>
                </div>
                {st.listed && st.priceIndex > 0 && <Sparkline points={hist[c]} now={s.phase.kind === "ended" ? null : price(s, c)} label={`${co.short} price history`} />}
                <div className="mrow-price">
                  <b>{!st.listed ? `IPO R${IPO_ROUND}` : st.bankrupt ? "BUST" : rs(price(s, c))}</b>
                  <Change d={changeSinceLastRound(s, hist[c], c)} />
                </div>
              </div>
              {st.listed && (
                <>
                  <div className="strip" aria-hidden="true">
                    {TRACK.map((p, i) => (
                      <span key={i} className={`cell ${band(s, p)} ${i === st.priceIndex ? "here" : ""} ${i === 0 ? "bust" : ""} ${shorts.some((t) => t.openIndex === i) ? "has-short" : ""} ${shorts.some((t) => capIndex(t.openIndex) === i) ? "cap" : ""}`} />
                    ))}
                  </div>
                  <div className="mrow-facts small">
                    <span className="thresholds" title="Shares held minus shorts. The price moves when this crosses 3, 6, 9 or 12.">
                      {THRESHOLDS.map((t) => (
                        <span key={t} className={out >= t ? "hit" : ""}>
                          {t}
                        </span>
                      ))}
                    </span>
                    <span>{out} held</span>
                    {!st.bankrupt && <span>pays {rs(paysNow(s, c))}</span>}
                    {shorts.length > 0 && <span className="short-chip">{shorts.length} short</span>}
                    {chair && <span className="chair">★ {chair}</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
