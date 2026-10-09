/** Checks that a state could exist under the rules. The simulator runs it after every action. */
import { COMPANIES, COMPANY_IDS, HAND_SIZE, IPO_CARDS, IPO_COMPANY, MARKET_SIZE, NEWS_CARDS, SHARES_PER_COMPANY, SHORTS_PER_COMPANY, TOP } from "./data.ts";
import { capIndex, openShorts, sharesHeld } from "./engine.ts";
import type { GameState } from "./types.ts";

export function invariantErrors(s: GameState): string[] {
  const errs: string[] = [];
  for (const c of COMPANY_IDS) {
    const co = s.companies[c];
    if (co.priceIndex < 0 || co.priceIndex > TOP) errs.push(`${c} price index ${co.priceIndex} off the track`);
    if (co.bankrupt !== (co.priceIndex === 0)) errs.push(`${c} bankrupt flag disagrees with its price`);
    const held = sharesHeld(s, c);
    if (!co.listed) {
      if (!COMPANIES[c].ipo) errs.push(`${c} is unlisted but is not an IPO company`);
      if (held || openShorts(s, c).length) errs.push(`${c} is unlisted but has shares or shorts out`);
    }
    if (held > SHARES_PER_COMPANY) errs.push(`${c} has ${held} shares held`);
    if (co.bankrupt && held) errs.push(`${c} is bankrupt but ${held} shares are held`);
    const shorts = openShorts(s, c).length;
    if (shorts > SHORTS_PER_COMPANY) errs.push(`${c} has ${shorts} shorts open`);
    if (co.bankrupt && shorts) errs.push(`${c} is bankrupt but has open shorts`);
    if (!s.debt) {
      for (const t of openShorts(s, c)) {
        if (t.capped) errs.push(`${c} short ${t.id} reached its cap but was never closed`);
        const cap = capIndex(t.openIndex);
        if (cap !== null && co.priceIndex >= cap) errs.push(`${c} short ${t.id} is past its cap but still open`);
      }
    }
    const holders = s.players.filter((p) => p.shares[c] >= 6).length;
    const ch = s.chairmen[c];
    if (holders === 1 && !co.bankrupt) {
      if (ch === null || s.players[ch].shares[c] < 6) errs.push(`${c} chairman token is in the wrong place`);
    } else if (ch !== null) errs.push(`${c} has a chairman with ${holders} holders of 6+`);
  }
  s.players.forEach((p, i) => {
    if (p.cash < 0) errs.push(`${p.name} has negative cash`);
    if (p.hand.length > HAND_SIZE) errs.push(`${p.name} holds ${p.hand.length} cards`);
    for (const c of COMPANY_IDS) if (p.shares[c] < 0) errs.push(`seat ${i} holds negative ${c}`);
  });
  if (s.market.length !== MARKET_SIZE) errs.push("market has the wrong number of slots");
  const cards = [
    ...s.deck,
    ...s.discard,
    ...(s.market.filter((x) => x !== null) as number[]),
    ...s.players.flatMap((p) => p.hand),
    ...(s.phase.kind === "opening" ? s.phase.submissions.flatMap((x) => (x ? [x.card] : [])) : []),
  ];
  const expected = NEWS_CARDS.length + (s.companies[IPO_COMPANY].listed ? IPO_CARDS.length : 0);
  if (cards.length !== expected || new Set(cards).size !== expected) errs.push(`card count is ${cards.length} (${new Set(cards).size} distinct), expected ${expected}`);
  return errs;
}
