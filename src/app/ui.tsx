/** Small visual pieces shared across screens: avatars, icons, the scrolling tape and the backdrop. */
import type { CSSProperties, ReactNode } from "react";
import { COMPANIES, COMPANY_IDS, TRACK, type CompanyId } from "../engine/index.ts";
import { CompanyBadge } from "./logos.tsx";

// ─── Avatars ────────────────────────────────────────────────────────────────────────────

/** Five player colours, distinct from the company colours, readable with white initials. */
const SEAT_HUES = ["#6d4fd8", "#d9541e", "#0f8f8f", "#b07800", "#c23a6b"];

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A round badge with initials. In a game pass the seat so five players get five colours. */
export function Avatar({ name, seat, size = 32, ring }: { name: string; seat?: number; size?: number; ring?: boolean }) {
  const colour = SEAT_HUES[(seat ?? hash(name)) % SEAT_HUES.length];
  const initials = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span className={`avatar ${ring ? "ring" : ""}`} style={{ width: size, height: size, fontSize: size * 0.4, ["--av" as string]: colour }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function AvatarStack({ names, max = 5 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="avatar-stack" aria-label={names.join(", ")}>
      {shown.map((n) => (
        <Avatar key={n} name={n} size={26} />
      ))}
      {names.length > max && <span className="avatar more">+{names.length - max}</span>}
    </span>
  );
}

// ─── Icons (24px stroke icons) ──────────────────────────────────────────────────────────

const PATHS = {
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  auto: "M12 3a9 9 0 1 0 0 18V3ZM12 3a9 9 0 0 1 0 18",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 0 6.5 21H20M8 7h8M8 10.5h6",
  share: "M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
  copy: "M9 9h10v12H9zM5 15H4V3h11v1",
  out: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  home: "M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z",
  shield: "M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6L12 3Z",
  key: "M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM13.3 12.7 20 19.5M17 16.5l2-2",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12.5 10 17.5 19.5 7",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 3.65a3.5 3.5 0 0 1 0 6.7",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 8h6M9 11h6M13 8c0 4-4 4-4 4l5 4",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  rocket: "M12 15c-1.5 0-3-1.5-3-3 0-4 3-8 3-8s3 4 3 8c0 1.5-1.5 3-3 3ZM9 13l-3 2 1 4 3-2M15 13l3 2-1 4-3-2M12 15v5",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4v3h-4z",
  chart: "M4 19h16M6 15l4-5 3 3 5-7",
  x: "M6 6l12 12M18 6 6 18",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ─── The scrolling tape (decoration on the sign-in and lobby screens) ──────────────────

/** A made-up but steady tape: every company at a plausible price with a plausible move. */
const TAPE = COMPANY_IDS.map((c, i) => {
  const idx = 8 + ((i * 5) % 9);
  const move = [2, -1, 3, -2, 1, 4, -3][i % 7];
  return { c, price: TRACK[idx], move: move * 10 };
});

export function TickerTape({ reverse = false }: { reverse?: boolean }) {
  const row = (key: string) => (
    <div className="tape-row" key={key}>
      {TAPE.map(({ c, price, move }) => (
        <span key={c} className="tape-item">
          <CompanyBadge c={c as CompanyId} size={18} />
          <b>{COMPANIES[c].short.toUpperCase()}</b>
          <span className="tape-price">₹{price}</span>
          <span className={move >= 0 ? "up" : "down"}>
            {move >= 0 ? "▲" : "▼"} {Math.abs(move)}
          </span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`tape ${reverse ? "reverse" : ""}`} aria-hidden="true">
      <div className="tape-track">{[row("a"), row("b")]}</div>
    </div>
  );
}

/** A rising candlestick chart drawn faintly behind the sign-in card. */
export function CandleBackdrop() {
  const candles: ReactNode[] = [];
  let level = 70;
  for (let i = 0; i < 34; i++) {
    const drift = Math.sin(i * 1.7) * 9 + Math.cos(i * 0.6) * 6 + 2.4;
    const open = level;
    const close = level + drift;
    const hi = Math.max(open, close) + 4 + ((i * 7) % 6);
    const lo = Math.min(open, close) - 4 - ((i * 5) % 5);
    level = close;
    const up = close >= open;
    const x = 12 + i * 18;
    const y = (v: number) => 300 - v * 1.8;
    candles.push(
      <g key={i} className={up ? "c-up" : "c-down"} style={{ ["--i" as string]: i } as CSSProperties}>
        <line x1={x} x2={x} y1={y(hi)} y2={y(lo)} />
        <rect x={x - 5} width={10} y={y(Math.max(open, close))} height={Math.max(2, Math.abs(close - open) * 1.8)} rx={1.5} />
      </g>,
    );
  }
  return (
    <svg className="candles" viewBox="0 0 630 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {candles}
    </svg>
  );
}

/** A burst of paper for the winner. Pure CSS; switched off by reduced motion. */
export function Confetti() {
  const colours = ["var(--co-HUL)", "var(--co-HDFC)", "var(--co-INFY)", "var(--co-ONGC)", "var(--co-DLF)", "var(--gold)"];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(i * 37) % 100}%`,
              background: colours[i % colours.length],
              animationDelay: `${(i % 12) * 0.12}s`,
              animationDuration: `${2.4 + (i % 5) * 0.35}s`,
              ["--r" as string]: `${(i * 47) % 360}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
