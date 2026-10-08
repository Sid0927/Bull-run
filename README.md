# Bull Run — play-test software

Bull Run is a physical tabletop stock market game for 3–5 players. This repository is the
software used to test its rules before printing:

1. **Rules engine** (`src/engine`) — pure TypeScript, no UI. `apply(state, action)` returns the
   next state and an event log, or an error explaining why the action is illegal. All
   randomness comes from a seed kept in the state, so a game is its config plus its action
   list and replays exactly (`replay()`).
2. **Play-test app** (`src/app`) — a hot-seat browser game for one device passed round the
   table. Cash and hands are shown only after the active player confirms it is them.
3. **Simulator** (`src/sim`) — plays thousands of games with computer players and reports
   balance statistics.

The app and the simulator call the same engine, so they cannot disagree about a rule.

## Commands

```bash
npm install
npm run dev          # play-test app at http://localhost:5173
npm test             # rules tests (Node's own test runner via tsx)
npm run typecheck
npm run build        # static site in dist/ — open it from any web host
npm run sim -- --games 1000 --players 4 --rounds 9 --strategies random,favour,dividend --seed 1 --json report.json
npm run sim -- --start SUN=120,INFY=120,ONGC=100,DLF=100,HUL=80,HDFC=80 --cash 1200 --drift 0 --drift-mode toStart
npm run sim:starts   # compares starting-price layouts
```

Simulator strategies: `random` (any legal move), `favour` (buys what its hand will push up,
sells and shorts what it will push down) and `dividend` (builds HUL and HDFC Bank towards a
chairmanship, never shorts). The `--strategies` list is cycled to fill the table and the seats
are shuffled every game, so seat and strategy are not confounded.

In the app, **Save record** downloads the seed and action log; loading it on the setup screen
replays the game exactly. **Undo** takes back the last action (for play-testing only).

## Rule decisions

The handover document is the source of truth. These are the points it left open, and how they
were settled (8 Oct 2026).

| # | Question | Decision |
|---|---|---|
| 1 | HUL and HDFC Bank "±1 only", but some cards moved them by 2 | Rule stands. Market crash (−2 all) is the one exception. Cards 47/48 changed to HUL ±1, HDFC Bank ∓1. |
| 2 | Deck did not balance (every company net −1) | Bull run changed to +2 for all companies. Every company now nets 0 (checked by a test). |
| 3 | A short opened at ₹300 or higher can never reach "5 steps above" | It has no cap. |
| 4 | Order when one price move forces several shorts closed | Clockwise from the player whose turn it is, then oldest token first. A close is resolved (count +1, any threshold move) before the next is checked, so chains resolve naturally. *Chosen by the developer; the answer only matters when a player must sell shares to pay.* |
| 5 | Which price a share gets when the count falls below a threshold | The price drops first; that share trades at the lower price (mirror of buying). |
| 6 | Both trade actions on one company; buy and sell it in one turn | Allowed. |
| 7 | Holding and shorting the same company | Allowed. |
| 8 | Round-1 oversubscription | Shares are divided equally: one at a time in seat order to each player still wanting one. |
| 9 | Drawing back up after the opening | From the market or blind from the deck, as on a normal turn. |
| 10 | Trading a bankrupt company before it re-lists | Not allowed. Bankrupt in the final round stays at ₹0. |
| 11 | A short seller who cannot pay a dividend | No forced sale. *Developer's reading:* they pay what cash they have and the bank absorbs the rest, with no ban on shorting. |
| 12 | Other shorts after the last-resort rule | They stay open; only opening new shorts is banned. |
| 13 | Does the opening count as a round? | No. The opening is **round 0**; a 6/9/12-round game is that many rounds of turns after it. Dividends at the end of rounds 3, 6, 9, 12. |
| 14 | Net worth and cash both tied | Shared win. |
| 15 | Deck runs out (including while refilling the market) | The played cards (the opening's included) are shuffled into a new deck at once and the draw or refill continues. |

Changes after the first simulations (8 Oct 2026):

- **Chairman bonus is 3× the per-share dividend** (was 5×).
- **5 players: 9 rounds is recommended.** 12 is still allowed; the setup screen says so.
- Play-test variants, off by default, available in the simulator (`--start`, `--cash`,
  `--drift`, `--drift-mode`) and partly in the app: a tiered starting-price layout, starting
  cash, and end-of-round drift for companies nobody holds.

Engine-level choices the rules did not reach:

- **Caps are checked after each trade action completes**, not between the shares inside it, so
  the shares in one action are priced only by that action's own count changes. Caps are also
  checked after every news card and every forced sale.
- **A news card's moves are all applied, then caps are checked.** A price that jumps past a
  cap still closes the short at the cap price.
- **A forced close is closed first and paid for second.** The close counts as a buy at once
  (it can cross a threshold); the owner then pays the fixed cap price, selling shares if they
  must. The last-resort rule applies only once they have no sellable shares left.
- **A sale that takes a price to ₹0** bankrupts the company; that share is worth nothing and
  the rest of the action stops.
- **Covering picks the tokens nearest their cap** unless the action names specific tokens.
