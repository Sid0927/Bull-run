/** The card itself: its back, its face, and the full-screen views shown to another player. */
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SHOW_LABELS, TEAM_COLORS, type Card, type Config, type Team } from "../../cards/types.ts";
import { Icon } from "../ui.tsx";

export function teamOf(config: Config, id: string): Team | undefined {
  return config.teams.find((t) => t.id === id);
}

export function teamStyle(team: Team | undefined): CSSProperties {
  const c = TEAM_COLORS[team?.color ?? "grey"] ?? TEAM_COLORS.grey;
  return { "--team": c.bg, "--team-ink": c.ink } as CSSProperties;
}

/** The Undercover mark: a hand of three cards with an eye on the front one. */
export function HandMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="hh-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="8" y="9" width="20" height="29" rx="3.5" transform="rotate(-16 18 24)" className="hh-mark-back" />
      <rect x="20" y="9" width="20" height="29" rx="3.5" transform="rotate(16 30 24)" className="hh-mark-back" />
      <rect x="14" y="7" width="20" height="30" rx="3.5" className="hh-mark-front" />
      <path d="M17.5 22s2.6-4.4 6.5-4.4 6.5 4.4 6.5 4.4-2.6 4.4-6.5 4.4-6.5-4.4-6.5-4.4Z" className="hh-mark-eye" />
      <circle cx="24" cy="22" r="1.9" className="hh-mark-pupil" />
    </svg>
  );
}

/** The back of a card: the same for everybody, so a glance across the table gives nothing away. */
export function CardBack({ children }: { children?: ReactNode }) {
  return (
    <div className="hh-card hh-back">
      <div className="hh-back-pattern" aria-hidden="true" />
      <div className="hh-back-frame" aria-hidden="true" />
      <div className="hh-back-center">
        <HandMark size={64} />
        {children}
      </div>
    </div>
  );
}

const SHOW_SHORT: Record<Card["show"], string> = { any: "", team: "Team only", full: "Full card only", none: "Can't show" };

/** The face of a card. */
export function CardFace({ card, config, compact = false }: { card: Card; config: Config; compact?: boolean }) {
  const team = teamOf(config, card.teamId);
  const isPlain = card.roleId.startsWith("member:");
  return (
    <div className={`hh-card hh-face ${compact ? "compact" : ""}`} style={teamStyle(team)}>
      <div className="hh-face-band">
        <span className="hh-face-team">{team?.name ?? "No team"}</span>
        <span className="hh-face-pip" aria-hidden="true" />
      </div>
      <div className="hh-face-body">
        <div className="hh-face-seal" aria-hidden="true">
          <HandMark size={compact ? 26 : 40} />
        </div>
        <h3 className="hh-face-name">{card.name}</h3>
        {!compact && card.description && <p className="hh-face-desc">{card.description}</p>}
        {!compact && isPlain && !card.goal && <p className="hh-face-desc muted">A plain {team?.name ?? ""} card.</p>}
      </div>
      {!compact && card.goal && (
        <div className="hh-face-goal">
          <span className="hh-face-goal-label">
            <Icon name="flag" size={13} /> {team?.name ?? "Your side"}'s goal
          </span>
          <p>{card.goal}</p>
        </div>
      )}
      {!compact && (
        <div className="hh-face-foot">
          {SHOW_SHORT[card.show] ? (
            <span className="hh-chip">
              <Icon name="lock" size={14} /> {SHOW_SHORT[card.show]}
            </span>
          ) : (
            <span className="hh-chip">
              <Icon name="eye" size={14} /> {SHOW_LABELS.any}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Full screen, for holding the phone up: the whole card, or only the team colour. */
export function ShowScreen({ card, config, mode, name, onClose }: { card: Card; config: Config; mode: "team" | "full"; name: string; onClose: () => void }) {
  // A team share shows the colour the card *shows as*, which is the point of such a role.
  const shown = mode === "team" ? teamOf(config, card.showsAsTeamId || card.teamId) : teamOf(config, card.teamId);
  // Escape closes it too, for a keyboard or a phone with one.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  // Drawn on the page's body: inside the card's animated column, "fixed" would be fixed to that
  // column instead of the screen.
  return createPortal(
    <div className={`hh-show hh-show-${mode}`} style={teamStyle(shown)} role="dialog" aria-modal="true" aria-label={mode === "team" ? "Your team" : "Your card"} onClick={onClose}>
      <div className="hh-show-inner">
        <p className="hh-show-who">
          <Icon name="eye" size={16} /> {name} is showing {mode === "team" ? "their team" : "their card"}
        </p>
        {mode === "team" ? (
          <div className="hh-show-team">
            <span className="hh-show-label">Team</span>
            <span className="hh-show-name">{shown?.name ?? "No team"}</span>
          </div>
        ) : (
          <div className="hh-show-card">
            <CardFace card={card} config={config} />
          </div>
        )}
        <p className="hh-show-close">Tap anywhere to hide</p>
      </div>
    </div>,
    document.body,
  );
}
