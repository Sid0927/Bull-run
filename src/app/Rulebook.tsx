/**
 * The instructions book. Most numbers are read from the rules engine; the worked examples and a few
 * figures in the prose are written by hand and must be checked whenever the rules change.
 */
import {
  ACTIONS_PER_TURN,
  ALL_CARDS,
  CHAIRMAN_MULTIPLIER,
  CHAIRMAN_SHARES,
  COMPANIES,
  COMPANY_IDS,
  DIVIDEND_BANDS,
  dividendPerShare,
  DIVIDEND_ROUNDS,
  GAME_LENGTHS,
  HAND_SIZE,
  IPO_BAND,
  IPO_CARDS,
  IPO_MAX_BID,
  IPO_MAX_BID_3P,
  IPO_ROUND,
  MARKET_SIZE,
  MAX_QTY_PER_ACTION,
  NEWS_CARDS,
  OPENING_MAX_SHARES,
  RELIST_INDEX,
  SHARES_PER_COMPANY,
  SHORT_CAP_STEPS,
  SHORTS_PER_COMPANY,
  STARTING_CASH,
  THRESHOLDS,
  TRACK,
  type CompanyId,
} from "../engine/index.ts";
import { BullLogo, CompanyBadge } from "./logos.tsx";
import { Icon } from "./ui.tsx";

const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
/** The worked dividend example: what HUL pays a share at ₹250. */
const EX_HUL = dividendPerShare("HUL", 250);
const LISTED = COMPANY_IDS.filter((c) => !COMPANIES[c].ipo);
const IPO_CO = COMPANY_IDS.find((c) => COMPANIES[c].ipo)!;

/** The dividend table as rows of "price range → rupees". */
function bandRows() {
  const bands = [...DIVIDEND_BANDS].sort((a, b) => a.from - b.from);
  const rows: { range: string; pays: number }[] = [{ range: `Below ${rs(bands[0].from)}`, pays: 0 }];
  bands.forEach((b, i) => {
    const next = bands[i + 1];
    const top = next ? TRACK.filter((p) => p < next.from).at(-1)! : TRACK.at(-1)!;
    rows.push({ range: `${rs(b.from)}–${rs(top)}`, pays: b.pays });
  });
  return rows;
}

const SECTIONS = [
  ["goal", "The goal"],
  ["companies", "The companies"],
  ["setup", "How a game starts"],
  ["opening", "Round 0: the opening"],
  ["turn", "Your turn"],
  ["prices", "How trading moves prices"],
  ["shorts", "Short selling"],
  ["dividends", "Dividends and chairmen"],
  ["ipo", "The Oracle Group IPO"],
  ["bankruptcy", "Bankruptcy"],
  ["end", "End of the game"],
  ["cards", "The news cards"],
] as const;

export function Rulebook({ onClose }: { onClose: () => void }) {
  return (
    <div className="rulebook">
      <div className="rulebook-bar">
        <span className="brand">
          <BullLogo size={28} />
          <span className="brand-word">
            Bull<span>Run</span>
          </span>
          <span className="rules-tag">Rulebook</span>
        </span>
        <button className="primary" onClick={onClose}>
          <Icon name="x" size={18} /> Close
        </button>
      </div>
      <article
        className="rules"
        onClick={(e) => {
          // Links within the book scroll to their section; the address is left alone, because the app reads it as a route.
          const a = (e.target as HTMLElement).closest("a");
          const id = a?.getAttribute("href");
          if (id?.startsWith("#") && !id.startsWith("#/")) {
            e.preventDefault();
            document.getElementById(id.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }}
      >
        <header className="rules-hero">
          <p className="eyebrow">How to play</p>
          <h1>
            Bull <span>Run</span>
          </h1>
          <p className="lede">
            A stock market game for 3–5 players. Buy, sell and short shares in seven Indian companies, move their prices with the news you hold, and finish the
            richest.
          </p>
          <ul className="hero-facts">
            <li>3–5 players</li>
            <li>{rs(STARTING_CASH)} each</li>
            <li>{GAME_LENGTHS.join(" / ")} rounds</li>
          </ul>
        </header>

        <section className="quick" aria-label="The game in 30 seconds">
          <h2>The game in 30 seconds</h2>
          <ol className="quick-steps">
            <li>
              <span className="quick-no">1</span>
              <b>Trade</b>
              <span>Make up to {ACTIONS_PER_TURN} trades. Each trade is one company and 1–{MAX_QTY_PER_ACTION} shares: buy, sell, short (bet it falls) or cover (close a short).</span>
            </li>
            <li>
              <span className="quick-no">2</span>
              <b>Play news</b>
              <span>Place one card from your hand face-down. It moves prices at the start of your next turn, so everyone gets a lap to guess what you hold.</span>
            </li>
            <li>
              <span className="quick-no">3</span>
              <b>Draw</b>
              <span>Take a face-up card from the market, or a blind one from the deck.</span>
            </li>
          </ol>
          <p className="muted small">
            Buying pushes a price up, selling pushes it down, and every third round pays dividends. After the last round, the richest player wins.
          </p>
        </section>

        <nav className="toc" aria-label="Contents">
          <h2>Contents</h2>
          <ol>
            {SECTIONS.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <section id="goal">
          <h2>The goal</h2>
          <p>
            Have the highest <b>net worth</b> when the last round ends: your cash, plus your shares at their final prices, minus what it would cost to buy back any
            shares you have sold short. Your cash is secret; the shares you hold are public.
          </p>
        </section>

        <section id="companies">
          <h2>The companies</h2>
          <div className="table-scroll">
            <table className="rules-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Sector</th>
                  <th>Starts at</th>
                  <th>Dividends</th>
                </tr>
              </thead>
              <tbody>
                {COMPANY_IDS.map((c) => (
                  <tr key={c}>
                    <td className="row-co">
                      <CompanyBadge c={c} size={20} /> {COMPANIES[c].name}
                    </td>
                    <td>{COMPANIES[c].sector}</td>
                    <td className="num">{COMPANIES[c].ipo ? `IPO, round ${IPO_ROUND}` : rs(COMPANIES[c].startPrice)}</td>
                    <td>{COMPANIES[c].noDividend ? "None" : COMPANIES[c].doubleDividend ? "Double" : "Normal"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            HUL and HDFC Bank are steady: their news moves them only one step at a time, except the two market-wide cards, Bull run (+2) and Market crash (−2).
            They also pay double dividends. Infosys and Sun Pharma swing hardest of the starting six, by up to three steps, which is why they start highest.
            Oracle Group, which lists later, also moves by up to three steps, and it pays no dividend at all.
          </p>
          <p className="muted small">The badges are the game's own artwork, not the companies' logos, except Oracle Group's, which is its own mark.</p>
        </section>

        <section id="setup">
          <h2>How a game starts</h2>
          <ul>
            <li>Choose the length: {GAME_LENGTHS.join(", ")} rounds after the opening. Nine is recommended; with five players twelve runs long.</li>
            <li>Every company starts at the price in the table above. Oracle Group's track stays empty until round {IPO_ROUND}.</li>
            <li>Everyone gets {rs(STARTING_CASH)} and {HAND_SIZE} news cards from a shuffled deck of {NEWS_CARDS.length}.</li>
            <li>
              {MARKET_SIZE} more cards are laid face-up: this is the <b>market</b>. Whenever a card is taken from it, the gap is filled from the deck.
            </li>
            <li>Players keep the same seat order for the whole game.</li>
          </ul>
        </section>

        <section id="opening">
          <h2>Round 0: the opening</h2>
          <p>Everyone acts at once.</p>
          <ol>
            <li>
              Secretly choose buy orders for up to {OPENING_MAX_SHARES} shares in total, across any listed companies, and place one news card from your hand face-down. You
              must be able to pay for everything you order. No short selling in the opening.
            </li>
            <li>
              Reveal the orders. If more shares of a company are wanted than the {SHARES_PER_COMPANY} available, they are shared out one at a time in seat order to
              everyone still wanting one, until none are left.
            </li>
            <li>Everyone pays the starting price for the shares they got.</li>
            <li>
              Each company then moves up one step for every one of {THRESHOLDS.join(", ")} shares that are now held (see <a href="#prices">How trading moves prices</a>).
            </li>
            <li>Reveal the news cards together, add up each company's steps and move each company once by its total.</li>
            <li>In seat order, everyone draws back up to {HAND_SIZE} cards, from the market or blind from the deck.</li>
            <li>A random player starts round 1. Every round starts with them and goes clockwise.</li>
          </ol>
        </section>

        <section id="turn">
          <h2>Your turn</h2>
          <p>From round 1, each round every player takes one turn. On your turn, in this order:</p>
          <ol>
            <li>
              <b>Trade</b>: make up to {ACTIONS_PER_TURN} trades (you may make fewer, or none). Each trade is in one company, for 1 to {MAX_QTY_PER_ACTION} shares, and
              is one of: <b>buy</b>, <b>sell</b> shares you own, <b>short</b> (bet the price falls) or <b>cover</b> (close a short). For example: buy 3 HUL, then buy
              2 Infosys. Both trades may be in the same company, and you may hold and short the same company.
            </li>
            <li>
              <b>Play news</b>: place one card from your hand face-down. It is not optional. Nobody else sees it, and it does nothing yet: it is revealed and
              takes effect at the very start of your next turn, before you trade. A card placed in the final round is never revealed.
            </li>
            <li>
              <b>Draw</b>: take one face-up card from the market (then refill the market from the deck) or the top card of the deck, unseen.
            </li>
          </ol>
          <p>
            Each company named on a revealed card moves once, by the steps the card gives it. When the deck runs out, shuffle the played cards into a new deck. A news effect on a company that is bankrupt, or that has not listed yet, is ignored.
          </p>
        </section>

        <section id="prices">
          <h2>How trading moves prices</h2>
          <p>
            Each company has an <b>outstanding count</b>: the shares players hold, minus its open shorts. The bank always buys and sells at the current price
            and never runs out of money, but it holds only {SHARES_PER_COMPANY} shares of each company: you can buy only what players don't already hold. A sale
            or short that takes a company to ₹0 stops there; that share trades for nothing and the rest of the action is cancelled.
          </p>
          <ul>
            <li>
              When a trade takes the count <b>up to</b> {THRESHOLDS.join(", ")}, the price moves up one step <b>first</b>, and that share trades at the new price.
            </li>
            <li>
              When a trade takes the count <b>below</b> {THRESHOLDS.join(", ")}, the price moves down one step first, and that share trades at the new price.
            </li>
            <li>Every other share trades at the current price.</li>
            <li>
              {rs(TRACK.at(-1)!)} is the ceiling: a move that would go past it stops there, and a move up from {rs(TRACK.at(-1)!)} is ignored. Shares can still be bought at{" "}
              {rs(TRACK.at(-1)!)}.
            </li>
          </ul>
          <div className="example">
            <b>Example.</b> Infosys is at ₹140 with 4 shares outstanding and you buy 4 (two actions: 3, then 1). The 5th share costs ₹140. The 6th reaches a
            threshold, so Infosys moves to ₹150 first and you pay ₹150. The 7th and 8th cost ₹150 each. Total: ₹590.
          </div>
          <p className="muted small">The track: {TRACK.map((p) => (p === 0 ? "₹0" : p)).join(" · ")}. The gaps widen as prices rise: ₹10 a step up to ₹150, ₹25 a step up to ₹250, then ₹50 a step.</p>
        </section>

        <section id="shorts">
          <h2>Short selling</h2>
          <ul>
            <li>
              <b>Opening a short</b>: sell a share you don't own and receive the price in cash. It counts −1 on the outstanding count: if that takes the count below a
              threshold, the price drops a step first, and you receive, and open the short at, the new price.
            </li>
            <li>
              <b>Covering</b>: pay the current price to close the short. It counts +1, like a buy.
            </li>
            <li>
              A company can have at most {SHORTS_PER_COMPANY} open shorts at a time, across all players. No shorting in the opening, or on Oracle Group in its listing round.
            </li>
            <li>
              <b>The {SHORT_CAP_STEPS}-step cap</b>: once a move takes a company's price to {SHORT_CAP_STEPS} spaces above where a short was opened, that short is forced
              closed as soon as the current action or news card has finished. Its owner pays the price on that cap space, even if the price has since moved
              further. A forced close counts as a buy, so it can push the price up and set off more forced closes. Several at once are settled starting with the
              player whose turn it is and going clockwise, oldest short first. A short opened at ₹300 or higher has no cap, because {SHORT_CAP_STEPS} steps up is past
              the ceiling.
            </li>
            <li>
              <b>If you can't pay</b> for a forced close, you must sell shares of your choice at current prices (thresholds apply) until you can. If you run out
              of shares, pay everything you have; the bank absorbs the rest and you may not open shorts again this game. Your other shorts stay open.
            </li>
          </ul>
        </section>

        <section id="dividends">
          <h2>Dividends and chairmen</h2>
          <p>
            At the end of rounds {DIVIDEND_ROUNDS.join(", ")} (after the last player's turn), every company pays a dividend per share, set by its price at that moment:
          </p>
          <div className="table-scroll">
            <table className="rules-table narrow">
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Per share</th>
                  <th>HUL, HDFC Bank</th>
                </tr>
              </thead>
              <tbody>
                {bandRows().map((r) => (
                  <tr key={r.range}>
                    <td>{r.range}</td>
                    <td className="num">{rs(r.pays)}</td>
                    <td className="num">{rs(r.pays * 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul>
            <li>Every shareholder is paid the per-share amount for each share. Oracle Group and bankrupt companies pay nothing.</li>
            <li>
              The <b>chairman</b> is the one player holding at least {CHAIRMAN_SHARES} of a company's shares; the title moves the moment
              holdings change. If two players hold {CHAIRMAN_SHARES} each, there is no chairman. At each payout the chairman also gets a bonus of {CHAIRMAN_MULTIPLIER}× the
              per-share dividend, on top of the dividend on their own shares.
            </li>
            <li>
              Each open short pays the per-share amount to the bank. All dividends and bonuses are paid out first, then short sellers pay. A short seller who
              can't pay pays all their cash; the bank absorbs the rest (no forced sale).
            </li>
          </ul>
          <div className="example">
            <b>Example.</b> End of round 6. HUL is at ₹250, so it pays {rs(EX_HUL / 2)} doubled to {rs(EX_HUL)}. Asha holds 7 HUL: she is chairman and gets 7 ×{" "}
            {rs(EX_HUL)} + {CHAIRMAN_MULTIPLIER} × {rs(EX_HUL)} = {rs(7 * EX_HUL + CHAIRMAN_MULTIPLIER * EX_HUL)}. Chitra has 2 HUL shorts and pays {rs(2 * EX_HUL)}.
          </div>
        </section>

        <section id="ipo">
          <h2>The Oracle Group IPO</h2>
          <p>Oracle Group lists at the start of round {IPO_ROUND}, before anyone's turn.</p>
          <ol>
            <li>
              Everyone secretly bids for 0–{IPO_MAX_BID} shares ({IPO_MAX_BID_3P} with three players) at one price: {IPO_BAND.map(rs).join(", ")}. You must be able to
              pay shares × your price.
            </li>
            <li>
              Reveal the bids. From {rs(Math.max(...IPO_BAND))} down, add up the shares bid at that price or higher. The first price where that reaches {SHARES_PER_COMPANY} is
              the <b>listing price</b>; if it never does, it lists at {rs(Math.min(...IPO_BAND))}.
            </li>
            <li>
              Bids above the listing price get everything. Bids at it share what is left one at a time, clockwise from the start player. Bids below it get nothing.
              Unsold shares stay in the bank.
            </li>
            <li>Everyone pays the listing price, not their bid.</li>
            <li>Oracle Group then rises one step for each of {THRESHOLDS.join(", ")} shares sold, and its {IPO_CARDS.length} news cards are shuffled into the deck.</li>
          </ol>
          <div className="example">
            <b>Example</b> (Bilal starts the round). Asha bids 6 @ ₹90; Bilal, Chitra and Dev bid 3, 4 and 3 @ ₹80. At ₹90 only 6 are bid; at ₹80, 16. So Oracle Group lists at
            ₹80. Asha gets 6; the other 6 go one at a time from Bilal: 2 each. Everyone pays ₹80, and with 12 sold Oracle Group rises four steps to ₹120.
          </div>
        </section>

        <section id="bankruptcy">
          <h2>Bankruptcy</h2>
          <p>
            A company that reaches ₹0 is bankrupt. All its shares go back to the bank and are worthless, its open shorts close (their owners keep what they received
            and owe nothing), and its chairman loses the title. Nobody may trade it, and news about it is ignored, until the start of the next round, when it re-lists
            at {rs(TRACK[RELIST_INDEX])} with all {SHARES_PER_COMPANY} shares in the bank. A company that goes bankrupt in the final round stays at ₹0.
          </p>
        </section>

        <section id="end">
          <h2>End of the game</h2>
          <p>The game ends after the last round's dividends. Any news cards still face-down are discarded unrevealed.</p>
          <p className="formula">Net worth = cash + shares × current price − cost to buy back open shorts at the current price</p>
          <p>The highest net worth wins. A tie goes to the player with more cash; if that is tied too, the win is shared.</p>
        </section>

        <section id="cards">
          <h2>The news cards</h2>
          <p className="muted small">
            Steps up or down. Every company's ups and downs balance across the deck. Cards marked IPO join the deck when Oracle Group lists.
          </p>
          <div className="table-scroll">
            <table className="rules-table cards-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Card</th>
                  <th>Type</th>
                  <th>Effect</th>
                </tr>
              </thead>
              <tbody>
                {ALL_CARDS.map((k) => (
                  <tr key={k.id}>
                    <td className="num">{k.id}</td>
                    <td>
                      {k.title}
                      {k.id > NEWS_CARDS.length && <span className="tag">IPO</span>}
                    </td>
                    <td>{{ positive: "Positive", negative: "Negative", double: "Double-edged", market: "Market-wide" }[k.type]}</td>
                    <td>
                      {k.type === "market"
                        ? `All companies ${signed(Object.values(k.effects)[0]!)}`
                        : (Object.entries(k.effects) as [CompanyId, number][]).map(([c, v]) => `${COMPANIES[c].short} ${signed(v)}`).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="muted small">
          {LISTED.length + 1} companies · {IPO_CO && COMPANIES[IPO_CO].name} lists by IPO · Bull Run is a working title.
        </footer>
      </article>
    </div>
  );
}
