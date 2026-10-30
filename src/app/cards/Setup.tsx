/** The host's setup: teams, roles, the deal, groups, rounds and house rules. Nothing is saved until Save. */
import { useMemo, useState, type ReactNode } from "react";
import { buildDeck, configProblems } from "../../cards/deck.ts";
import { PRESETS, cleanConfig, rid } from "../../cards/presets.ts";
import { SHOW_LABELS, TEAM_COLORS, type Config, type Role, type ShowRule, type Team } from "../../cards/types.ts";
import { Icon } from "../ui.tsx";
import { teamOf, teamStyle } from "./CardArt.tsx";

const SAVED = "hh.setups";

function savedSetups(): { name: string; config: Config }[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string").map((x) => ({ name: x.name, config: cleanConfig(x.config) })) : [];
  } catch {
    return [];
  }
}
function storeSetups(list: { name: string; config: Config }[]) {
  try {
    localStorage.setItem(SAVED, JSON.stringify(list));
  } catch {
    /* private mode: nothing kept */
  }
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1, label, format }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; format?: (v: number) => string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  return (
    <div className="hh-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => set(value - step)} disabled={value <= min} aria-label={`Less: ${label}`}>
        <Icon name="minus" size={18} />
      </button>
      <output aria-live="polite">{format ? format(value) : value}</output>
      <button type="button" onClick={() => set(value + step)} disabled={value >= max} aria-label={`More: ${label}`}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="hh-switch-row">
      <span>
        <span className="hh-switch-label">{label}</span>
        {hint && <span className="muted small hh-switch-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="hh-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Section({ title, icon, children, aside }: { title: string; icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel hh-section">
      <div className="hh-section-head">
        <h2>
          <Icon name={icon} /> {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const minutes = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${m % 1 === 0 ? m : m.toFixed(1)} min`);

export function Setup({ initial, players, onSave, onCancel, busy }: { initial: Config; players: number; onSave: (c: Config) => void; onCancel: () => void; busy: boolean }) {
  const [c, setC] = useState<Config>(() => structuredClone(initial));
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [saved, setSaved] = useState(savedSetups);
  const [preview, setPreview] = useState(Math.max(players, 4));
  const [paste, setPaste] = useState<string | null>(null);

  const up = (f: (d: Config) => void) =>
    setC((prev) => {
      const d = structuredClone(prev);
      f(d);
      return d;
    });
  const problems = configProblems(c);
  const deck = useMemo(() => buildDeck(c, preview), [c, preview]);

  const addTeam = () =>
    up((d) => {
      const used = new Set(d.teams.map((t) => t.color));
      const color = Object.keys(TEAM_COLORS).find((k) => !used.has(k)) ?? "grey";
      const name = `Team ${String.fromCharCode(65 + d.teams.length)}`;
      d.teams.push({ id: rid(), name, color, fills: true, memberName: name });
    });
  const addRole = () => {
    const id = rid();
    up((d) => {
      d.roles.push({ id, name: "", teamId: d.teams[0]?.id ?? "", count: 1, description: "", show: "any", showsAsTeamId: "" });
    });
    setOpenRole(id);
  };
  const removeTeam = (id: string) =>
    up((d) => {
      d.teams = d.teams.filter((t) => t.id !== id);
      d.roles = d.roles.filter((r) => r.teamId !== id);
      for (const r of d.roles) if (r.showsAsTeamId === id) r.showsAsTeamId = "";
      if (!d.roles.some((r) => r.id === d.oddRoleId)) d.oddRoleId = "";
    });
  const setTeam = (id: string, patch: Partial<Team>) => up((d) => Object.assign(d.teams.find((t) => t.id === id)!, patch));
  const setRole = (id: string, patch: Partial<Role>) => up((d) => Object.assign(d.roles.find((r) => r.id === id)!, patch));

  const loadPreset = (config: Config) => {
    setC(structuredClone(config));
    setOpenRole(null);
  };
  const saveAsMine = () => {
    const name = (c.title || "My setup").trim();
    const list = [{ name, config: c }, ...saved.filter((s) => s.name !== name)].slice(0, 12);
    storeSetups(list);
    setSaved(list);
  };

  return (
    <div className="hh-setup">
      <header className="hh-setup-head">
        <button className="icon-btn" onClick={onCancel} aria-label="Back without saving">
          <Icon name="back" />
        </button>
        <div>
          <p className="eyebrow">Room setup</p>
          <h1 className="hh-setup-title">{c.title || "Untitled"}</h1>
        </div>
      </header>

      <Section title="Start from" icon="sparkle">
        <div className="hh-presets">
          {PRESETS.map((p) => (
            <button key={p.id} className="hh-preset" onClick={() => loadPreset(p.config)}>
              <b>{p.name}</b>
              <span className="muted small">{p.blurb}</span>
            </button>
          ))}
          {saved.map((s) => (
            <div key={s.name} className="hh-preset mine">
              <button className="hh-preset-load" onClick={() => loadPreset(s.config)}>
                <b>{s.name}</b>
                <span className="muted small">
                  Saved on this phone · {s.config.teams.length} teams, {s.config.roles.length} roles
                </span>
              </button>
              <button
                className="icon-btn"
                aria-label={`Forget ${s.name}`}
                onClick={() => {
                  const list = saved.filter((x) => x !== s);
                  storeSetups(list);
                  setSaved(list);
                }}
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </div>
        <div className="row hh-preset-tools">
          <button onClick={saveAsMine}>
            <Icon name="check" size={18} /> Keep on this phone
          </button>
          <button
            onClick={() => {
              const text = JSON.stringify(c);
              navigator.clipboard?.writeText(text).then(
                () => setPaste(""),
                () => setPaste(text),
              );
            }}
          >
            <Icon name="copy" size={18} /> Copy setup
          </button>
          <button onClick={() => setPaste("")}>
            <Icon name="share" size={18} /> Paste a setup
          </button>
        </div>
        {paste !== null && (
          <div className="stack hh-paste">
            <textarea rows={3} value={paste} placeholder="Paste a setup someone copied" onChange={(e) => setPaste(e.target.value)} aria-label="Setup text" />
            <div className="row">
              <button
                className="primary"
                disabled={!paste.trim()}
                onClick={() => {
                  try {
                    loadPreset(cleanConfig(JSON.parse(paste)));
                    setPaste(null);
                  } catch {
                    alert("That isn't a setup. Copy it again with Copy setup.");
                  }
                }}
              >
                Use it
              </button>
              <button className="ghost-link" onClick={() => setPaste(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Name" icon="flag">
        <input value={c.title} maxLength={40} onChange={(e) => up((d) => void (d.title = e.target.value))} aria-label="Name of the game" placeholder="What's this game called?" />
      </Section>

      <Section
        title="Teams"
        icon="shield"
        aside={
          <button className="ghost-link" onClick={addTeam} disabled={c.teams.length >= 8}>
            <Icon name="plus" size={18} /> Team
          </button>
        }
      >
        <div className="hh-list">
          {c.teams.map((t) => (
            <div key={t.id} className="hh-team-edit" style={teamStyle(t)}>
              <div className="row hh-team-top">
                <span className="hh-team-swatch" aria-hidden="true" />
                <input value={t.name} maxLength={30} aria-label="Team name" onChange={(e) => setTeam(t.id, { name: e.target.value })} />
                <button className="icon-btn" aria-label={`Remove ${t.name}`} onClick={() => removeTeam(t.id)} disabled={c.teams.length <= 1}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
              <div className="hh-colors" role="radiogroup" aria-label={`Colour of ${t.name}`}>
                {Object.entries(TEAM_COLORS).map(([k, v]) => (
                  <button key={k} role="radio" aria-checked={t.color === k} aria-label={v.label} className={`hh-color ${t.color === k ? "on" : ""}`} style={{ background: v.bg }} onClick={() => setTeam(t.id, { color: k })}>
                    {t.color === k && <Icon name="check" size={16} />}
                  </button>
                ))}
              </div>
              <Switch checked={t.fills} onChange={(v) => setTeam(t.id, { fills: v })} label="Fills the deck" hint="Plain cards of this team make up the rest of the players, kept level with other filling teams." />
              {t.fills && (
                <label className="hh-inline-field">
                  <span className="field-label">Plain card is called</span>
                  <input value={t.memberName} maxLength={40} placeholder={t.name} onChange={(e) => setTeam(t.id, { memberName: e.target.value })} />
                </label>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Roles"
        icon="card"
        aside={
          <button className="ghost-link" onClick={addRole} disabled={c.teams.length === 0 || c.roles.length >= 40}>
            <Icon name="plus" size={18} /> Role
          </button>
        }
      >
        {c.roles.length === 0 ? (
          <p className="muted small">No special roles. Every card will be a plain team card.</p>
        ) : (
          <div className="hh-list">
            {c.roles.map((r) => {
              const team = teamOf(c, r.teamId);
              const open = openRole === r.id;
              return (
                <div key={r.id} className={`hh-role-edit ${open ? "open" : ""} ${r.count === 0 ? "off" : ""}`} style={teamStyle(team)}>
                  <div className="hh-role-row">
                    <button className="hh-role-summary" onClick={() => setOpenRole(open ? null : r.id)} aria-expanded={open}>
                      <span className="hh-dot" aria-hidden="true" />
                      <span className="hh-role-text">
                        <b className="truncate">{r.name || "New role"}</b>
                        <span className="muted small truncate">
                          {team?.name ?? "No team"}
                          {r.show !== "any" ? ` · ${SHOW_LABELS[r.show]}` : ""}
                          {r.showsAsTeamId ? ` · shows as ${teamOf(c, r.showsAsTeamId)?.name ?? "?"}` : ""}
                          {r.count === 0 ? " · left out" : ""}
                        </span>
                      </span>
                      <Icon name="chevron" size={18} className="hh-chev" />
                    </button>
                    <Stepper value={r.count} onChange={(v) => setRole(r.id, { count: v })} min={0} max={20} label={`Copies of ${r.name || "this role"}`} />
                  </div>
                  {open && (
                    <div className="hh-role-body">
                      <label>
                        <span className="field-label">Name</span>
                        <input value={r.name} maxLength={40} autoFocus={!r.name} placeholder="Role name" onChange={(e) => setRole(r.id, { name: e.target.value })} />
                      </label>
                      <div className="field">
                        <span className="field-label">Team</span>
                        <div className="hh-team-pick">
                          {c.teams.map((t) => (
                            <button key={t.id} className={r.teamId === t.id ? "on" : ""} style={teamStyle(t)} onClick={() => setRole(r.id, { teamId: t.id })}>
                              <span className="hh-dot" aria-hidden="true" /> {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label>
                        <span className="field-label">What the card says</span>
                        <textarea rows={2} value={r.description} maxLength={400} placeholder="What this role does or must do" onChange={(e) => setRole(r.id, { description: e.target.value })} />
                      </label>
                      <div className="field">
                        <span className="field-label">Can show</span>
                        <div className="seg seg-fill hh-seg-wrap" role="radiogroup" aria-label="How this card may be shown">
                          {(Object.keys(SHOW_LABELS) as ShowRule[]).map((k) => (
                            <button key={k} role="radio" aria-checked={r.show === k} className={r.show === k ? "on" : ""} onClick={() => setRole(r.id, { show: k })}>
                              {SHOW_LABELS[k]}
                            </button>
                          ))}
                        </div>
                      </div>
                      {c.teams.length > 1 && (
                        <label>
                          <span className="field-label">A team share shows</span>
                          <select className="hh-select" value={r.showsAsTeamId} onChange={(e) => setRole(r.id, { showsAsTeamId: e.target.value })}>
                            <option value="">Its real team</option>
                            {c.teams
                              .filter((t) => t.id !== r.teamId)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name} (a disguise)
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <div className="row hh-role-actions">
                        <button
                          className="ghost-link danger-text"
                          onClick={() =>
                            up((d) => {
                              d.roles = d.roles.filter((x) => x.id !== r.id);
                              if (d.oddRoleId === r.id) d.oddRoleId = "";
                            })
                          }
                        >
                          <Icon name="trash" size={16} /> Remove role
                        </button>
                        <button className="ghost-link" onClick={() => setOpenRole(null)}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Dealing" icon="shuffle">
        <label>
          <span className="field-label">With an odd number of players, add</span>
          <select className="hh-select" value={c.oddRoleId} onChange={(e) => up((d) => void (d.oddRoleId = e.target.value))}>
            <option value="">Nothing: one team gets the extra card</option>
            {c.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || "Unnamed role"}
              </option>
            ))}
          </select>
        </label>
        <Switch checked={c.setAside} onChange={(v) => up((d) => void (d.setAside = v))} label="Set one card aside" hint="One card more than there are players is dealt, and nobody gets it. Nobody knows which." />
      </Section>

      <Section title="Groups" icon="swap">
        <Switch checked={c.groups} onChange={(v) => up((d) => void (d.groups = v))} label="Split players into two groups" hint="Each phone says which group its player starts in." />
        {c.groups && (
          <div className="hh-two">
            {[0, 1].map((i) => (
              <label key={i}>
                <span className="field-label">Group {i + 1}</span>
                <input value={c.groupNames[i]} maxLength={24} onChange={(e) => up((d) => void (d.groupNames[i as 0 | 1] = e.target.value))} />
              </label>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Rounds"
        icon="timer"
        aside={
          <button className="ghost-link" onClick={() => up((d) => void d.rounds.push({ minutes: d.rounds.at(-1)?.minutes ?? 3, swap: d.rounds.at(-1)?.swap ?? 1 }))} disabled={c.rounds.length >= 12}>
            <Icon name="plus" size={18} /> Round
          </button>
        }
      >
        {c.rounds.length === 0 ? (
          <p className="muted small">No timer. Add a round to get a shared countdown on every phone.</p>
        ) : (
          <ol className="hh-rounds">
            {c.rounds.map((r, i) => (
              <li key={i}>
                <span className="hh-round-no">{i + 1}</span>
                <div className="hh-round-fields">
                  <Stepper value={r.minutes} onChange={(v) => up((d) => void (d.rounds[i].minutes = v))} min={0.5} max={30} step={0.5} label={`Length of round ${i + 1}`} format={minutes} />
                  {c.groups && <Stepper value={r.swap} onChange={(v) => up((d) => void (d.rounds[i].swap = v))} min={0} max={30} label={`Players swapped after round ${i + 1}`} format={(v) => `swap ${v}`} />}
                </div>
                <button className="icon-btn" aria-label={`Remove round ${i + 1}`} onClick={() => up((d) => void d.rounds.splice(i, 1))}>
                  <Icon name="x" size={18} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="House rules" icon="book">
        <textarea rows={5} value={c.notes} maxLength={2000} placeholder="Goals, how the game ends, anything everyone should be able to read on their phone" onChange={(e) => up((d) => void (d.notes = e.target.value))} aria-label="House rules" />
      </Section>

      <div className="hh-setup-bar">
        <div className="hh-setup-preview">
          <div className="row hh-preview-head">
            <span className="field-label">Deck for</span>
            <Stepper value={preview} onChange={setPreview} min={2} max={60} label="Players in the preview" format={(v) => `${v} players`} />
          </div>
          {"error" in deck ? (
            <p className="error small">{problems[0] ?? deck.error}</p>
          ) : (
            <div className="hh-deck-bar" aria-label="How the deck splits">
              {c.teams.map((t) => {
                const n = deck.cards.filter((x) => x.teamId === t.id).length;
                return n ? (
                  <span key={t.id} style={{ ...teamStyle(t), flexGrow: n }} title={`${n} ${t.name}`}>
                    {n} {t.name}
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
        <div className="row hh-setup-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={busy || problems.length > 0} onClick={() => onSave(c)}>
            {busy ? <span className="spinner" /> : "Save setup"}
          </button>
        </div>
      </div>
    </div>
  );
}
