/**
 * The game's event log, regrouped into what people want to read: one summary per turn (and one for
 * the opening, the IPO and each dividend payout), newest first, in plain words.
 */
import { COMPANIES, card, type CompanyId, type GameEvent, type GameState, type Seat } from "../engine/index.ts";

export interface Summary {
  /** Stable position in the log: the index of the summary's first event. */
  id: number;
  kind: "opening" | "turn" | "ipo" | "dividends" | "round";
  player: Seat | null;
  round: number;
  /** Headline, e.g. "Asha's turn" or "Dividends paid". */
  title: string;
  lines: string[];
  /** Net price moves over the summary, for the coloured chips. */
  moves: { company: CompanyId; from: number; to: number }[];
  /** Whether the summary is finished (a turn is finished when its player has drawn). */
  done: boolean;
  /** Index in the times array of its last event. */
  last: number;
}

const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const co = (c: CompanyId) => COMPANIES[c].short;

export function summarize(events: GameEvent[], s: GameState, viewer: Seat | null): Summary[] {
  const name = (p: Seat) => (p === viewer ? "You" : s.players[p]?.name ?? "?");
  const out: Summary[] = [];
  let cur: Summary | null = null;
  let round = 0;
  let firstPrice = new Map<CompanyId, number>();
  let lastPrice = new Map<CompanyId, number>();

  // What each player got in the opening, gathered into one line per player.
  let bought = new Map<Seat, string[]>();
  const open = (i: number, kind: Summary["kind"], player: Seat | null, title: string) => {
    // Anything that came before is over once something new starts.
    if (cur) (cur as Summary).done = true;
    close();
    cur = { id: i, kind, player, round, title, lines: [], moves: [], done: false, last: i };
    firstPrice = new Map();
    lastPrice = new Map();
  };
  const close = () => {
    if (!cur) return;
    if (bought.size) {
      const lines = [...bought.entries()].sort((a, b) => a[0] - b[0]).map(([p, xs]) => `${name(p)} bought ${xs.join(", ")}`);
      cur.lines.unshift(...lines);
      bought = new Map();
    }
    cur.moves = [...firstPrice.keys()].map((c) => ({ company: c, from: firstPrice.get(c)!, to: lastPrice.get(c)! })).filter((m) => m.from !== m.to);
    if (cur.lines.length || cur.moves.length) out.push(cur);
    cur = null;
  };

  events.forEach((e, i) => {
    switch (e.kind) {
      case "setup":
        open(i, "opening", null, "The opening");
        return;
      case "roundStart":
        round = e.round;
        if (cur) (cur as Summary).done = true;
        open(i, "round", null, `Round ${e.round} begins`);
        return;
      case "ipoOpen":
        open(i, "ipo", null, `${co(e.company)} IPO`);
        return;
      case "ipoListing":
        if (!cur || (cur as Summary).kind !== "ipo") open(i, "ipo", null, `${co(e.company)} IPO`);
        (cur as unknown as Summary).lines.push(
          `${co(e.company)} listed at ${rs(e.listingPrice)}${e.afterPop !== e.listingPrice ? ` and rose to ${rs(e.afterPop)}` : ""}`,
        );
        e.allocated.forEach((n, p) => n && (cur as unknown as Summary).lines.push(`${name(p)} got ${n} share${n === 1 ? "" : "s"}`));
        (cur as unknown as Summary).done = true;
        (cur as unknown as Summary).last = i;
        close();
        return;
      case "startPlayer":
        if (cur) {
          (cur as Summary).lines.push(`${name(e.player)} start${e.player === viewer ? "" : "s"} round 1`);
          (cur as Summary).done = true;
          (cur as Summary).last = i;
        }
        close();
        return;
    }

    // A player's own action starts their turn (the opening keeps everything in one summary).
    const actor = "player" in e && (e.kind === "trade" || e.kind === "newsPending" || (e.kind === "news" && cur?.kind !== "opening")) ? e.player : null;
    if (actor !== null && cur?.kind !== "opening" && (!cur || cur.kind !== "turn" || cur.player !== actor || cur.done)) {
      open(i, "turn", actor, actor === viewer ? "Your turn" : `${s.players[actor].name}'s turn`);
    }
    if (e.kind === "dividend" && cur?.kind !== "dividends") open(i, "dividends", null, `Dividends, end of round ${round}`);
    if (!cur) open(i, "round", null, `Round ${round}`);
    const c = cur!;
    c.last = i;

    switch (e.kind) {
      case "price":
        if (!firstPrice.has(e.company)) firstPrice.set(e.company, e.from);
        lastPrice.set(e.company, e.to);
        return;
      case "trade": {
        const n = e.prices.length;
        const verb = { buy: "bought", sell: "sold", short: "shorted", cover: "covered", forcedSell: "had to sell" }[e.trade];
        if (n === 0) c.lines.push(`${name(e.player)} tried to sell ${co(e.company)}, but it went bust`);
        else c.lines.push(`${name(e.player)} ${verb} ${n} ${co(e.company)} for ${rs(e.total)}`);
        return;
      }
      case "news":
        c.lines.push(
          c.kind === "opening"
            ? `${name(e.player)} played “${card(e.card).title}”`
            : `${name(e.player)} revealed “${card(e.card).title}”`,
        );
        return;
      case "newsPending":
        c.lines.push(`${name(e.player)} placed a card face-down`);
        return;
      case "openingAllocation":
        e.allocated.forEach((n, p) => n && bought.set(p, [...(bought.get(p) ?? []), `${n} ${co(e.company)}`]));
        return;
      case "shortClosed":
        if (e.how === "forced") c.lines.push(`${name(e.player)}'s ${co(e.company)} short was forced closed at ${rs(e.price)}`);
        return;
      case "debt":
        c.lines.push(`${name(e.player)} must sell shares to pay ${rs(e.amount)}`);
        return;
      case "lastResort":
        c.lines.push(`${name(e.player)} couldn't pay: paid ${rs(e.paid)} and can't short any more`);
        return;
      case "bankrupt":
        c.lines.push(`${co(e.company)} went bankrupt`);
        return;
      case "relist":
        c.lines.push(`${co(e.company)} re-listed at ₹60`);
        return;
      case "chairman":
        if (e.to !== null) c.lines.push(`${name(e.to)} became ${co(e.company)} chairman`);
        else if (e.from !== null) c.lines.push(`${co(e.company)} has no single chairman now`);
        return;
      case "dividend": {
        const mine = viewer === null ? 0 : e.paid.filter((x) => x.player === viewer).reduce((a, x) => a + x.amount, 0);
        c.lines.push(`${co(e.company)} paid ${rs(e.perShare)} a share${viewer !== null && mine ? ` — ${mine > 0 ? `you got ${rs(mine)}` : `you paid ${rs(-mine)} on shorts`}` : ""}`);
        return;
      }
      case "draw":
        if (c.kind === "turn" && c.player === e.player) {
          c.lines.push(e.from === "market" && e.card > 0 ? `${name(e.player)} took “${card(e.card).title}”` : `${name(e.player)} drew from the deck`);
          c.done = true;
        }
        return;
      case "roundEnd":
        if (c.kind === "dividends") c.done = true;
        return;
      case "gameEnd":
        open(i, "round", null, "Game over");
        cur!.lines.push(...e.standings.map((x) => `${x.rank === 1 ? "Winner: " : `#${x.rank} `}${x.seat === viewer ? "You" : x.name}: ${rs(x.netWorth)}`));
        cur!.done = true;
        return;
    }
  });
  close();
  return out.reverse();
}
