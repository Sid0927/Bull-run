/**
 * Static game data: the price track, the six companies and the 50 news cards.
 * Every number here comes from the Game rules / News deck sections of the handover.
 */

/** The 25 spaces of every price track. A step is one index. Index 0 is bankruptcy. */
export const TRACK = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 175, 200, 225, 250, 300, 350,
  400, 450, 500,
] as const;

export const TOP = TRACK.length - 1; // ₹500, the ceiling
export const RELIST_INDEX = TRACK.indexOf(60);

export const SHARES_PER_COMPANY = 12;
export const SHORTS_PER_COMPANY = 3;
export const THRESHOLDS = [3, 6, 9, 12] as const;
export const HAND_SIZE = 4;
export const MARKET_SIZE = 4;
export const STARTING_CASH = 1500;
export const OPENING_MAX_SHARES = 6;
export const ACTIONS_PER_TURN = 2;
export const MAX_QTY_PER_ACTION = 3;
export const SHORT_CAP_STEPS = 5;
export const CHAIRMAN_SHARES = 6;
export const CHAIRMAN_MULTIPLIER = 5;
export const DIVIDEND_ROUNDS = [3, 6, 9, 12] as const;
export const GAME_LENGTHS = [6, 9, 12] as const;
export type GameLength = (typeof GAME_LENGTHS)[number];

export const COMPANY_IDS = ["HUL", "HDFC", "INFY", "ONGC", "DLF", "SUN"] as const;
export type CompanyId = (typeof COMPANY_IDS)[number];

export interface Company {
  id: CompanyId;
  name: string;
  short: string;
  sector: string;
  startPrice: number;
  doubleDividend: boolean;
  colour: string;
}

export const COMPANIES: Record<CompanyId, Company> = {
  HUL: { id: "HUL", name: "Hindustan Unilever", short: "HUL", sector: "FMCG", startPrice: 150, doubleDividend: true, colour: "#2f6fdb" },
  HDFC: { id: "HDFC", name: "HDFC Bank", short: "HDFC Bank", sector: "Banking", startPrice: 120, doubleDividend: true, colour: "#8a3ffc" },
  INFY: { id: "INFY", name: "Infosys", short: "Infosys", sector: "Tech", startPrice: 100, doubleDividend: false, colour: "#0f9d8a" },
  ONGC: { id: "ONGC", name: "ONGC", short: "ONGC", sector: "Energy", startPrice: 100, doubleDividend: false, colour: "#d4691e" },
  DLF: { id: "DLF", name: "DLF", short: "DLF", sector: "Real Estate", startPrice: 80, doubleDividend: false, colour: "#b8860b" },
  SUN: { id: "SUN", name: "Sun Pharma", short: "Sun Pharma", sector: "Pharma", startPrice: 60, doubleDividend: false, colour: "#d23f6b" },
};

export function indexOfPrice(price: number): number {
  const i = TRACK.indexOf(price as (typeof TRACK)[number]);
  if (i < 0) throw new Error(`₹${price} is not a space on the price track`);
  return i;
}

/** Dividend per share at a price, before the HUL/HDFC Bank doubling. */
export function baseDividend(price: number): number {
  if (price >= 400) return 30;
  if (price >= 225) return 20;
  if (price >= 120) return 10;
  return 0;
}

export function dividendPerShare(company: CompanyId, price: number): number {
  return baseDividend(price) * (COMPANIES[company].doubleDividend ? 2 : 1);
}

export type CardType = "positive" | "negative" | "double" | "market";

export interface NewsCard {
  id: number; // 1..50, printed on the card
  type: CardType;
  title: string;
  effects: Partial<Record<CompanyId, number>>;
}

const ALL = (n: number): Record<CompanyId, number> =>
  Object.fromEntries(COMPANY_IDS.map((c) => [c, n])) as Record<CompanyId, number>;

/**
 * The 50 news cards.
 * Play-test changes agreed on 8 Oct 2026:
 *  - #15 Bull run is +2 to all (was +1), so it mirrors #30 Market crash and the deck balances.
 *  - #47/#48 move HUL and HDFC Bank by 1 (were 2): those two companies move ±1 only.
 *    #30 Market crash (−2 to all) is the one exception to that rule.
 */
export const NEWS_CARDS: NewsCard[] = [
  { id: 1, type: "positive", title: "Government digital contract won", effects: { INFY: 1 } },
  { id: 2, type: "positive", title: "Major US client signs", effects: { INFY: 2 } },
  { id: 3, type: "positive", title: "AI product goes viral", effects: { INFY: 3 } },
  { id: 4, type: "positive", title: "New plant approved", effects: { SUN: 1 } },
  { id: 5, type: "positive", title: "Bulk export order", effects: { SUN: 2 } },
  { id: 6, type: "positive", title: "Breakthrough drug approved", effects: { SUN: 3 } },
  { id: 7, type: "positive", title: "Gas price revised upward", effects: { ONGC: 1 } },
  { id: 8, type: "positive", title: "New oil field discovered", effects: { ONGC: 2 } },
  { id: 9, type: "positive", title: "Metro line announced near projects", effects: { DLF: 1 } },
  { id: 10, type: "positive", title: "Record festive bookings", effects: { DLF: 2 } },
  { id: 11, type: "positive", title: "Bad loans fall", effects: { HDFC: 1 } },
  { id: 12, type: "positive", title: "Deposit drive succeeds", effects: { HDFC: 1 } },
  { id: 13, type: "positive", title: "Festive demand surge", effects: { HUL: 1 } },
  { id: 14, type: "positive", title: "New product launch hit", effects: { HUL: 1 } },
  { id: 15, type: "market", title: "Bull run", effects: ALL(2) },
  { id: 16, type: "negative", title: "Key client delays project", effects: { INFY: -1 } },
  { id: 17, type: "negative", title: "US visa rules tightened", effects: { INFY: -2 } },
  { id: 18, type: "negative", title: "Major client cancels multi-year contract", effects: { INFY: -3 } },
  { id: 19, type: "negative", title: "Plant inspection flags observations", effects: { SUN: -1 } },
  { id: 20, type: "negative", title: "US regulator delays key approval", effects: { SUN: -2 } },
  { id: 21, type: "negative", title: "Late-stage trial results disappoint", effects: { SUN: -3 } },
  { id: 22, type: "negative", title: "Windfall tax increased", effects: { ONGC: -1 } },
  { id: 23, type: "negative", title: "Output from major field declines", effects: { ONGC: -2 } },
  { id: 24, type: "negative", title: "Project approvals delayed", effects: { DLF: -1 } },
  { id: 25, type: "negative", title: "Unsold inventory piles up", effects: { DLF: -2 } },
  { id: 26, type: "negative", title: "Corporate loan defaults rise", effects: { HDFC: -1 } },
  { id: 27, type: "negative", title: "Interest margins squeezed", effects: { HDFC: -1 } },
  { id: 28, type: "negative", title: "Rural demand slows", effects: { HUL: -1 } },
  { id: 29, type: "negative", title: "Price war with rivals", effects: { HUL: -1 } },
  { id: 30, type: "market", title: "Market crash", effects: ALL(-2) },
  { id: 31, type: "double", title: "Oil price spike", effects: { ONGC: 2, HUL: -1 } },
  { id: 32, type: "double", title: "Oil glut", effects: { ONGC: -2, HUL: 1 } },
  { id: 33, type: "double", title: "RBI cuts rates", effects: { DLF: 2, HDFC: -1 } },
  { id: 34, type: "double", title: "RBI hikes rates", effects: { DLF: -2, HDFC: 1 } },
  { id: 35, type: "double", title: "Fintech boom", effects: { INFY: 2, HDFC: -1 } },
  { id: 36, type: "double", title: "RBI cracks down on fintech", effects: { INFY: -2, HDFC: 1 } },
  { id: 37, type: "double", title: "Pandemic wave", effects: { SUN: 2, DLF: -1 } },
  { id: 38, type: "double", title: "Pandemic ends", effects: { SUN: -2, DLF: 1 } },
  { id: 39, type: "double", title: "Budget shifts R&D credits to pharma", effects: { SUN: 2, INFY: -1 } },
  { id: 40, type: "double", title: "Budget shifts R&D credits to IT", effects: { SUN: -2, INFY: 1 } },
  { id: 41, type: "double", title: "Work from home made permanent", effects: { INFY: 1, DLF: -2 } },
  { id: 42, type: "double", title: "Return-to-office mandate", effects: { INFY: -1, DLF: 2 } },
  { id: 43, type: "double", title: "Power shortage boosts gas demand", effects: { ONGC: 2, INFY: -1 } },
  { id: 44, type: "double", title: "Power surplus cuts gas demand", effects: { ONGC: -2, INFY: 1 } },
  { id: 45, type: "double", title: "Medicine price cap", effects: { SUN: -2, HUL: 1 } },
  { id: 46, type: "double", title: "Food subsidy cut to fund pharma", effects: { SUN: 2, HUL: -1 } },
  { id: 47, type: "double", title: "Rural loan waiver", effects: { HUL: 1, HDFC: -1 } },
  { id: 48, type: "double", title: "Loan waiver withdrawn", effects: { HUL: -1, HDFC: 1 } },
  { id: 49, type: "double", title: "Petrochemical prices spike", effects: { ONGC: 1, SUN: -2 } },
  { id: 50, type: "double", title: "Petrochemical prices crash", effects: { ONGC: -1, SUN: 2 } },
];

export function card(id: number): NewsCard {
  const c = NEWS_CARDS[id - 1];
  if (!c || c.id !== id) throw new Error(`No news card #${id}`);
  return c;
}
