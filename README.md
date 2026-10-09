# Bull Run — play-test software

Bull Run is a physical tabletop stock market game for 3–5 players. This repository is the
software used to test its rules before printing:

1. **Rules engine** (`src/engine`) — pure TypeScript, no UI. `apply(state, action)` returns the
   next state and an event log, or an error explaining why the action is illegal. All
   randomness comes from a seed kept in the state, so a game is its config plus its action
   list and replays exactly (`replay()`).
2. **Online game** (`server`, `src/app`) — a Node server that runs the engine, keeps accounts and
   games in Postgres, and sends each phone only its own player's view; and the phone-first app.
3. **Simulator** (`src/sim`) — plays thousands of games with computer players and reports
   balance statistics.

The app and the simulator call the same engine, so they cannot disagree about a rule.

## Play it online

Bull Run is an online game: each player uses their own phone, signs in with an account the admin
gives them, and joins a game with a 5-letter code. The server runs the rules and sends each phone
only what that player may see.

### Putting it online (Render + Neon, free tiers)

1. **Database (Neon).** Sign up at neon.tech, create a project, and copy its **connection string**
   (it starts `postgresql://` and ends `?sslmode=require`).
2. **Server (Render).** Sign up at render.com with your GitHub account, then **New → Blueprint** and
   pick this repository. Render reads `render.yaml` and asks for three values:
   - `DATABASE_URL`: the Neon connection string;
   - `ADMIN_USERNAME` and `ADMIN_PASSWORD`: the admin account created on first start (password at
     least 6 characters).
   Press **Apply**. The first build takes a few minutes; the game is then at the
   `https://bull-run-….onrender.com` address Render shows.
3. **Sign in as the admin**, open **Admin** from the menu under your name, and create an account
   for each player. Give each player their username and password; they can change the password from
   their lobby.

Every push to `main` redeploys automatically. On Render's free plan the server sleeps after about
15 minutes without visitors and the first visit after that takes 30–60 seconds; games are kept in
the database, so nothing is lost while it sleeps.

### How a game runs

- Any player creates a game (6, 9 or 12 rounds; up to 3, 4 or 5 players) and shares its code.
- Others join with the code; the creator starts it once at least 3 have joined.
- When it is your move, your phone buzzes and the game shows **Your move**. In the opening and the
  IPO, everyone acts at once and sees only their own orders or bids.
- The rules are fixed (the standard rules in the rulebook). The rulebook is in the game:
  **Rules** in the header or the tab bar.
- The admin can see every game, abandon one, reset any player's password, or switch an account off.

### Running it on your own computer

```bash
npm install
npm run build
npm start            # http://localhost:3000, admin / admin123, nothing saved without DATABASE_URL
```

For development, `npm run server` (API with reload) and `npm run dev` (app on :5173) together.

## Commands

```bash
npm install
npm run server       # game server on :3000 (memory store, admin / admin123)
npm run dev          # app with live reload on :5173, talking to the server
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

The server keeps every game as its seed and action log, so any game can be replayed exactly with
`replay()` from the database.

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
- **Starting prices are tiered** (fixed 9 Oct 2026): Infosys and Sun Pharma ₹120, ONGC and DLF ₹100,
  HUL and HDFC Bank ₹80. The companies whose cards swing hardest start highest, so Sun Pharma no
  longer goes bankrupt in about a fifth of games. The handover's prices are kept as
  `HANDOVER_START_PRICES` and as an option on the setup screen.
- **Starting cash is ₹1,200** (was ₹1,500): closer finishes and fewer automatic chairmanships in simulation.
- **5 players: 9 rounds is recommended.** 12 is still allowed; the setup screen says so.
- Play-test variants, off by default, available in the simulator (`--start`, `--cash`,
  `--drift`, `--drift-mode`, `--chairman <multiple>`, `--dividends 400:40,225:30,110:20,50:10`) and partly in the app: a tiered starting-price layout, starting
  cash, and end-of-round drift for companies nobody holds.

## Oracle Group IPO (added 9 Oct 2026)

A seventh company, Oracle Group (New-age tech), lists at the **start of round 4**, before the first
turn. It has its own track, 12 certificates, 3 short tokens, a chairman token and a marker.

1. **Sealed bids.** Each player writes 0–6 shares (0–8 in a 3-player game) and one price: ₹60, ₹70, ₹80 or ₹90. You
   must be able to pay shares × your price.
2. **Listing price.** From ₹90 down, add up the shares bid at that price or more. The first
   price where that reaches 12 is the listing price; if it never does, it lists at ₹60.
3. **Allotment.** Bids above the listing price are filled in full. Bids at it share what is
   left one at a time, clockwise from the start player. Bids below it get nothing. Unsold
   shares stay in the bank.
4. **Everyone pays the listing price**, then the price rises one step for each of 3, 6, 9 and
   12 shares sold (the opening's rule).
5. **Its 8 news cards are shuffled into the deck.** Four are its own (+2, +3, −2, −3) and two
   mirrored pairs tie it to the board: *Fuel prices cut / hiked* (Oracle Group ±2, ONGC ∓1) and
   *Quick commerce boom / Dining out returns* (Oracle Group ±2, DLF ∓1). Bull run and Market crash
   move it once it is listed; before that they pass it by.
6. **It pays no dividend** and **cannot be shorted until round 5**. Otherwise every normal rule
   applies, bankruptcy and re-listing included.

The band and bid limit come from simulation: ₹90–120 with 4 shares a bid was undersubscribed
in 85% of 4-player games and always listed at the floor. ₹60–90 with 6 shares fills far more
often. Simulator flags: `--no-ipo`; band and limit are `ipoBand` / `ipoMaxBid` in `runBatch`.

## Test rule: news one lap later (off by default)

A played news card goes face-down and takes effect at the start of its owner's next turn,
before they trade. Cards still face-down when the game ends are discarded. Setup screen:
"Test rule: news takes effect one lap later". Simulator: `--delayed-news`. The `follower`
computer player copies the previous player's trades, to stand in for a table reacting.

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
