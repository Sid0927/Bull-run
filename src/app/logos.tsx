/**
 * Original emblems drawn for the game. These are NOT the companies' own logos: the handover
 * forbids real marks (they need permission), so each company gets a badge in its game colour
 * with a glyph for its sector. The one exception is Oracle Group, whose own mark is drawn here at
 * its owner's request.
 */
import type { ReactElement } from "react";
import type { CompanyId } from "../engine/index.ts";

const GLYPHS: Record<CompanyId, ReactElement> = {
  // FMCG: a shopping basket
  HUL: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10 L10.5 5.5 M16 10 L13.5 5.5" />
      <path d="M5 10 H19 L17.4 17.5 H6.6 Z" />
      <path d="M9.5 12.5 V15.5 M12 12.5 V15.5 M14.5 12.5 V15.5" />
    </g>
  ),
  // Banking: a columned bank hall
  HDFC: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 9.5 L12 5 L19.5 9.5 Z" />
      <path d="M7 11.5 V16 M10.3 11.5 V16 M13.7 11.5 V16 M17 11.5 V16" />
      <path d="M5 18.5 H19" />
    </g>
  ),
  // Tech: a chip with pins
  INFY: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
      <path d="M10 5 V7.5 M14 5 V7.5 M10 16.5 V19 M14 16.5 V19 M5 10 H7.5 M5 14 H7.5 M16.5 10 H19 M16.5 14 H19" />
      <path d="M10.5 12 H13.5" />
    </g>
  ),
  // Energy: a flame
  ONGC: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5 C13 8 17 9.5 17 13.8 A5 5 0 0 1 7 13.8 C7 11.5 8.3 10.2 9.3 9.2 C9.6 11 10.4 11.8 11.2 12 C11 9.2 11.2 6.8 12 4.5 Z" />
    </g>
  ),
  // Real estate: two towers
  DLF: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19 H19" />
      <path d="M7 19 V9 L11 7 V19" />
      <path d="M13 19 V5 H17 V19" />
      <path d="M15 8 V8.01 M15 11 V11.01 M15 14 V14.01 M9 11.5 V11.51 M9 14.5 V14.51" />
    </g>
  ),
  // Pharma: a capsule
  SUN: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.3 15.7 L15.7 8.3 A3.1 3.1 0 0 0 11.3 3.9 L3.9 11.3 A3.1 3.1 0 0 0 8.3 15.7 Z" transform="translate(2.2 2.2)" />
      <path d="M9.8 9.8 L14.2 14.2" />
    </g>
  ),
  // Oracle Group (packaging): the company's own mark, an open oval with a stem, used with its permission
  ORG: (
    <g fill="none" strokeWidth="1.9" strokeLinejoin="round">
      <path d="M8.2 14.6 A9 5.6 0 1 1 12.3 15.1" strokeLinecap="round" />
      <path d="M12.3 6.6 V21.2" strokeLinecap="butt" strokeWidth="2.1" />
    </g>
  ),
};

export function CompanyBadge({ c, size = 22, title }: { c: CompanyId; size?: number; title?: string }) {
  return (
    <svg className="badge" width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect x="0" y="0" width="24" height="24" rx="6" fill={`var(--co-${c})`} />
      <g stroke={`var(--co-ink-${c})`}>{GLYPHS[c]}</g>
    </svg>
  );
}

/** The Bull Run mark: a bull's head whose horns become a rising price line. */
export function BullLogo({ size = 36 }: { size?: number }) {
  return (
    <svg className="bull-logo" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="0" y="0" width="48" height="48" rx="12" fill="var(--accent)" />
      <g fill="none" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {/* horns: the left one rises like a chart line */}
        <path d="M17 19 C12 18 9 15 8 9" />
        <path d="M31 19 L35 14 L37.5 16 L41 8" />
        <path d="M37.5 8 H41 V11.5" />
        {/* head */}
        <path d="M15.5 18.5 C15.5 16.5 32.5 16.5 32.5 18.5 C32.5 24 30 27 29 31 C28.4 34 26.5 37 24 37 C21.5 37 19.6 34 19 31 C18 27 15.5 24 15.5 18.5 Z" />
        {/* nostrils */}
        <path d="M21.5 32.5 V32.6 M26.5 32.5 V32.6" />
      </g>
    </svg>
  );
}
