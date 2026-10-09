/**
 * The instructions book. Every number is read from the rules engine, so the book cannot drift
 * from the game it describes.
 */
import {
  ACTIONS_PER_TURN,
  ALL_CARDS,
  CHAIRMAN_MULTIPLIER,
  CHAIRMAN_SHARES,
  COMPANIES,
  COMPANY_IDS,
  DIVIDEND_BANDS,
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

const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
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
  ["box", "What's in the box"],
  ["companies", "The companies"],
  ["setup", "Setting up"],
  ["opening", "Round 0: the opening"],
  ["turn", "Your turn"],
  ["prices", "How trading moves prices"],
  ["shorts", "Short selling"],
  ["dividends", "Dividends and chairmen"],
  ["ipo", "The Zomato IPO"],
  ["bankruptcy", "Bankruptcy"],
  ["end", "End of the game"],
  ["test", "Test rules"],
  ["cards", "The news cards"],
] as const;

export function Rulebook({ onClose }: { onClose: () => void }) {
  return (
    <div className="rulebook">
      <div className="rulebook-bar">
        <span className="brand">
          <BullLogo size={28} /> Bull Run · Rules
        </span>
        <button className="primary" onClick={onClose}>
          Back
        </button>
      </div>
      <article className="rules">
        <header className="rules-hero">
          <BullLogo size={64} />
          <div>
            <h1>Bull Run</h1>
            <p className="lede">A stock market game for 3–5 players. Buy, sell and short shares in seven Indian companies, move their prices with the news you hold, and finish the richest.</p>
            <p className="muted small">Games of {GAME_LENGTHS.join(", ")} rounds after the opening.</p>
          </div>
        </header>

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
            shares you have sold short. Cash is kept secret behind your screen; the shares you hold are public.
          </p>
        </section>

        <section id="box">
          <h2>What's in the box</h2>
          <ul>
            <li>A board with seven price tracks of {TRACK.length} spaces, from ₹0 (bankrupt) to {rs(TRACK.at(-1)!)} (the ceiling), and a round tracker</li>
            <li>{SHARES_PER_COMPANY} share certificates and {SHORTS_PER_COMPANY} short tokens per company, a chairman token and a price marker for each</li>
            <li>
              {NEWS_CARDS.length} news cards, plus {IPO_CARDS.length} Zomato cards that join the deck when it lists
            </li>
            <li>Banknotes of ₹10, ₹50, ₹100 and ₹500, five player screens and five reference cards</li>
          </ul>
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
            HUL and HDFC Bank are steady: their news moves them only one step at a time (Market crash is the one exception), and they pay double dividends.
            Infosys and Sun Pharma swing hardest, by up to three steps, which is why they start highest. Zomato is a growth stock: it pays no dividend at all.
          </p>
          <p className="muted small">The badges are the game's own artwork, not the companies' logos.</p>
        </section>

        <section id="setup">
          <h2>Setting up</h2>
          <ol>
            <li>Choose the game length: {GAME_LENGTHS.join(", ")} rounds. Nine is recommended, and with five players twelve runs long.</li>
            <li>Put each company's marker on its starting price. Zomato's track stays empty until round {IPO_ROUND}.</li>
            <li>Give each player {rs(STARTING_CASH)} and a screen.</li>
            <li>
              Shuffle the {NEWS_CARDS.length} news cards (keep the Zomato cards aside). Deal {HAND_SIZE} to each player and lay {MARKET_SIZE} face-up beside the deck: this is
              the <b>market</b>.
            </li>
            <li>Sit in a fixed order for the whole game.</li>
          </ol>
        </section>

        <section id="opening">
          <h2>Round 0: the opening</h2>
          <p>Everyone acts at once.</p>
          <ol>
            <li>
              Secretly write buy orders for up to {OPENING_MAX_SHARES} shares in total, across any companies, and place one news card from your hand face-down. You
              must be able to pay for everything you order. No short selling in the opening.
            </li>
            <li>
              Reveal the orders. If more shares of a company are wanted than the {SHARES_PER_COMPANY} available, hand them out one at a time in seat order to
              everyone still wanting one, until none are left.
            </li>
            <li>Everyone pays the starting price for the shares they got.</li>
            <li>
              Each company then moves up one step for every one of {THRESHOLDS.join(", ")} shares that are now held (see <a href="#prices">How trading moves prices</a>).
            </li>
            <li>Reveal the news cards together, add up each company's steps and move each company once by its total.</li>
            <li>In seat order, everyone draws back up to {HAND_SIZE} cards, from the market or blind from the deck.</li>
            <li>Draw a random player to start round 1. Play goes clockwise from them for the rest of the game.</li>
          </ol>
        </section>

        <section id="turn">
          <h2>Your turn</h2>
          <p>From round 1, each round every player takes one turn. On your turn, in this order:</p>
          <ol>
            <li>
              <b>Trade</b>: take up to {ACTIONS_PER_TURN} actions. One action is to <b>buy</b>, <b>sell</b>, <b>short</b> or <b>cover</b> up to {MAX_QTY_PER_ACTION} shares (or short
              tokens) of one company. Both actions may be on the same company, and you may hold and short the same company.
            </li>
            <li>
              <b>Play news</b>: play one card from your hand face-up. It is not optional. Its effect happens at once.
            </li>
            <li>
              <b>Draw</b>: take one face-up card from the market (then refill the market from the deck) or the top card of the deck, unseen.
            </li>
          </ol>
          <p>
            When the deck runs out, shuffle the played cards into a new deck. A news effect on a company that is bankrupt, or that has not listed yet, is ignored.
          </p>
        </section>

        <section id="prices">
          <h2>How trading moves prices</h2>
          <p>
            Each company has an <b>outstanding count</b>: the shares players hold, minus its open short tokens. The bank always buys and sells at the current price
            and never runs out of money.
          </p>
          <ul>
            <li>
              When a trade takes the count <b>up to</b> {THRESHOLDS.join(", ")}, the price moves up one step <b>first</b>, and that share trades at the new price.
            </li>
            <li>
              When a trade takes the count <b>below</b> {THRESHOLDS.join(", ")}, the price moves down one step first, and that share trades at the new price.
            </li>
            <li>Every other share trades at the current price.</li>
            <li>Moves past {rs(TRACK.at(-1)!)} are ignored; shares can still be bought at {rs(TRACK.at(-1)!)}.</li>
          </ul>
          <div className="example">
            <b>Example.</b> Infosys is at ₹140 with 4 shares outstanding and you buy 4 (two actions: 3, then 1). The 5th share costs ₹140. The 6th reaches a
            threshold, so Infosys moves to ₹150 first and you pay ₹150. The 7th and 8th cost ₹150 each. Total: ₹590.
          </div>
          <p className="muted small">The track: {TRACK.map((p) => (p === 0 ? "₹0" : p)).join(" · ")}. The gaps widen as prices rise, so a step is a percentage.</p>
        </section>

        <section id="shorts">
          <h2>Short selling</h2>
          <ul>
            <li>
              <b>Opening a short</b>: take a short token, put it on the price space, and receive the current price in cash. It counts −1 on the outstanding count, so
              it can push the price down a step.
            </li>
            <li>
              <b>Covering</b>: pay the current price and return the token. It counts +1, like a buy.
            </li>
            <li>
              There are {SHORTS_PER_COMPANY} tokens per company. No shorting in the opening, or on Zomato in its listing round.
            </li>
            <li>
              <b>The {SHORT_CAP_STEPS}-step cap</b>: the moment a company's price reaches {SHORT_CAP_STEPS} spaces above where a short was opened, that short is forced
              closed and its owner pays the price on that space, even if news jumped further. A forced close counts as a buy, so it can push the price up and set
              off more forced closes. Several at once are settled clockwise from the player whose turn it is, oldest token first. A short opened at ₹300 or higher has
              no cap, because {SHORT_CAP_STEPS} steps up is past the ceiling.
            </li>
            <li>
              <b>If you can't pay</b> for a forced close: show your cash, then sell shares of your choice at current prices (thresholds apply) until you can. If you run out
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
            <li>Every shareholder is paid the per-share amount for each share. Zomato and bankrupt companies pay nothing.</li>
            <li>
              The <b>chairman</b> is the one player holding at least {CHAIRMAN_SHARES} of a company's shares; they take its chairman token, which moves the moment
              holdings change. If two players hold {CHAIRMAN_SHARES} each, there is no chairman. The chairman also gets a bonus of {CHAIRMAN_MULTIPLIER}× the per-share
              dividend.
            </li>
            <li>
              Each open short token pays the per-share amount to the bank. All dividends and bonuses are paid out first, then short sellers pay. A short seller who
              can't pay pays all their cash; the bank absorbs the rest (no forced sale).
            </li>
          </ul>
          <div className="example">
            <b>Example.</b> End of round 6. HUL is at ₹250, so it pays ₹20 doubled to ₹40. Asha holds 7 HUL: she is chairman and gets 7 × ₹40 + {CHAIRMAN_MULTIPLIER} × ₹40
            = {rs(7 * 40 + CHAIRMAN_MULTIPLIER * 40)}. Chitra has 2 HUL shorts and pays ₹80.
          </div>
        </section>

        <section id="ipo">
          <h2>The Zomato IPO</h2>
          <p>Zomato lists at the start of round {IPO_ROUND}, before anyone's turn.</p>
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
            <li>Zomato then rises one step for each of {THRESHOLDS.join(", ")} shares sold, and its {IPO_CARDS.length} news cards are shuffled into the deck.</li>
          </ol>
          <div className="example">
            <b>Example</b> (Bilal starts the round). Asha bids 6 @ ₹90; Bilal, Chitra and Dev bid 3, 4 and 3 @ ₹80. At ₹90 only 6 are bid; at ₹80, 16. So Zomato lists at
            ₹80. Asha gets 6; the other 6 go one at a time from Bilal: 2 each. Everyone pays ₹80, and with 12 sold Zomato rises four steps to ₹120.
          </div>
        </section>

        <section id="bankruptcy">
          <h2>Bankruptcy</h2>
          <p>
            A company that reaches ₹0 is bankrupt. All its shares go back to the bank and are worthless, its open shorts close (their owners keep what they received
            and owe nothing), and its chairman token is removed. Nobody may trade it, and news about it is ignored, until the start of the next round, when it re-lists
            at {rs(TRACK[RELIST_INDEX])} with all {SHARES_PER_COMPANY} shares in the bank. A company that goes bankrupt in the final round stays at ₹0.
          </p>
        </section>

        <section id="end">
          <h2>End of the game</h2>
          <p>The game ends after the last round's dividends.</p>
          <p className="formula">Net worth = cash + shares × current price − cost to buy back open shorts at the current price</p>
          <p>The highest net worth wins. A tie goes to the player with more cash; if that is tied too, the win is shared.</p>
        </section>

        <section id="test">
          <h2>Test rules</h2>
          <p>Optional rules being play-tested. Agree before the game which, if any, you are using; the app has a switch for each.</p>
          <ul>
            <li>
              <b>News one lap later.</b> Instead of revealing your news card, place it face-down. It takes effect at the start of your next turn, before you trade.
              Everyone else gets a full lap to read your trades and react. Cards still face-down when the game ends are discarded.
            </li>
            <li>
              <b>Bigger dividends.</b> ₹10 at ₹50–100, ₹20 at ₹110–200, ₹30 at ₹225–350, ₹40 at ₹400–500 (HUL and HDFC Bank double), with {rs(1000)} starting cash
              instead of {rs(STARTING_CASH)}.
            </li>
          </ul>
        </section>

        <section id="cards">
          <h2>The news cards</h2>
          <p className="muted small">
            Steps up or down. Every company's ups and downs balance across the deck. Cards marked IPO join the deck when Zomato lists.
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
