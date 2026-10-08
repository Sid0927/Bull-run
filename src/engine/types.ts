import type { CompanyId, GameLength } from "./data.ts";

export type Seat = number;
export type Holdings = Record<CompanyId, number>;

export interface GameConfig {
  players: string[]; // seat order, fixed for the whole game
  rounds: GameLength; // rounds of turns after the opening (round 0)
  seed: number;
}

export interface Player {
  name: string;
  cash: number;
  shares: Holdings;
  hand: number[]; // card ids
  shortBanned: boolean; // set by the last-resort rule
}

export interface ShortToken {
  id: number;
  owner: Seat;
  company: CompanyId;
  openIndex: number; // track index of the space it was opened on
}

export interface CompanyState {
  priceIndex: number;
  bankrupt: boolean;
}

export interface OpeningSubmission {
  orders: Partial<Holdings>;
  card: number;
}

export type Phase =
  | { kind: "opening"; submissions: (OpeningSubmission | null)[] }
  | { kind: "openingDraw"; next: Seat }
  | { kind: "turn"; player: Seat; turnInRound: number; actionsUsed: number; step: "trade" | "draw" }
  | { kind: "ended" };

/** A forced close a player could not pay from cash: they must sell shares until they can. */
export interface Debt {
  player: Seat;
  amount: number;
  reason: string;
}

export interface Standing {
  seat: Seat;
  name: string;
  cash: number;
  sharesValue: number;
  shortsCost: number;
  netWorth: number;
  rank: number; // 1 = winner; shared ranks on a full tie
}

export interface GameState {
  config: GameConfig;
  rng: number;
  round: number; // 0 = the opening
  phase: Phase;
  players: Player[];
  companies: Record<CompanyId, CompanyState>;
  chairmen: Record<CompanyId, Seat | null>;
  shorts: ShortToken[];
  nextShortId: number;
  deck: number[]; // top of the deck is the last element
  market: (number | null)[];
  discard: number[];
  startPlayer: Seat | null;
  debt: Debt | null;
  standings: Standing[] | null;
}

export type TradeKind = "buy" | "sell" | "short" | "cover";

export type Action =
  | { type: "openingOrder"; player: Seat; orders: Partial<Holdings>; card: number }
  | { type: "draw"; player: Seat; from: "deck" }
  | { type: "draw"; player: Seat; from: "market"; slot: number }
  | { type: "trade"; player: Seat; kind: TradeKind; company: CompanyId; qty: number; shortIds?: number[] }
  | { type: "playNews"; player: Seat; card: number }
  | { type: "forcedSell"; player: Seat; company: CompanyId; qty: number };

export type GameEvent = { text: string } & (
  | { kind: "setup" }
  | { kind: "openingAllocation"; company: CompanyId; requested: number[]; allocated: number[] }
  | { kind: "price"; company: CompanyId; from: number; to: number; steps: number; cause: "threshold" | "news" | "opening" }
  | { kind: "ceiling"; company: CompanyId }
  | { kind: "trade"; player: Seat; trade: TradeKind | "forcedSell"; company: CompanyId; prices: number[]; total: number }
  | { kind: "news"; player: Seat; card: number }
  | { kind: "shortOpened"; player: Seat; company: CompanyId; shortId: number; price: number }
  | { kind: "shortClosed"; player: Seat; company: CompanyId; shortId: number; price: number; how: "cover" | "forced" | "bankrupt" }
  | { kind: "debt"; player: Seat; amount: number }
  | { kind: "lastResort"; player: Seat; owed: number; paid: number }
  | { kind: "bankrupt"; company: CompanyId }
  | { kind: "relist"; company: CompanyId }
  | { kind: "chairman"; company: CompanyId; from: Seat | null; to: Seat | null }
  | { kind: "dividend"; company: CompanyId; perShare: number; paid: { player: Seat; amount: number; why: "shares" | "chairman" | "short" }[] }
  | { kind: "shortfall"; player: Seat; owed: number; paid: number }
  | { kind: "draw"; player: Seat; from: "deck" | "market"; card: number }
  | { kind: "reshuffle"; cards: number }
  | { kind: "startPlayer"; player: Seat }
  | { kind: "roundStart"; round: number }
  | { kind: "roundEnd"; round: number; cash: number[]; prices: Record<CompanyId, number>; chairmen: Record<CompanyId, Seat | null> }
  | { kind: "gameEnd"; standings: Standing[] }
);

export type Result =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
