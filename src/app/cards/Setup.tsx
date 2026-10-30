/** The host's setup: teams, roles, the deal, groups, rounds and house rules. Nothing is saved until Save. */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { buildDeck, configProblems } from "../../cards/deck.ts";
import { PRESETS, cleanConfig, rid } from "../../cards/presets.ts";
import { LIBRARY, LIBRARY_BY_ID, ROLE_GROUPS, roleFrom } from "../../cards/library.ts";
import { SHOW_LABELS, TEAM_COLORS, type Config, type Role, type Team } from "../../cards/types.ts";
import { Icon } from "../ui.tsx";
import { teamOf, teamStyle } from "./CardArt.tsx";
import { isCoreRole, isCoreTeam } from "../../cards/core.ts";

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
  const [picking, setPicking] = useState(false);
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

  const addTeam = (fills: boolean) =>
    up((d) => {
      const used = new Set(d.teams.map((t) => t.color));
      const color = fills ? (Object.keys(TEAM_COLORS).find((k) => k !== "grey" && !used.has(k)) ?? "black") : "grey";
      const name = fills ? `Team ${String.fromCharCode(65 + d.teams.filter((t) => t.fills).length)}` : "Loners";
      d.teams.push({ id: rid(), name, color, fills, memberName: fills ? name : "Loner", goal: "" });
    });
  /** Adds a library role to the team it fits best, or one more copy if it is already there. */
  const addRole = (libId: string) => {
    const lib = LIBRARY_BY_ID[libId];
    const newId = rid(); // made here, not in the updater, which React may run twice
    let id = newId;
    up((d) => {
      const sides = d.teams.filter((t) => t.fills);
      let team: Team | undefined;
      if (lib.group === "loner") {
        team = d.teams.find((t) => !t.fills);
        if (!team) {
          team = { id: rid(), name: "Loners", color: "grey", fills: false, memberName: "Loner", goal: "" };
          d.teams.push(team);
        }
      } else {
        // The first side that does not have this role yet, so one on each side is two taps.
        team = sides.find((t) => !d.roles.some((r) => r.libId === libId && r.teamId === t.id)) ?? sides[0] ?? d.teams[0];
        if (!team) return; // no team at all yet: nothing to put it on
      }
      const have = d.roles.find((r) => r.libId === libId && r.teamId === team!.id);
      if (have) {
        have.count = Math.min(20, have.count + lib.copies);
        id = have.id;
        return;
      }
      const other = d.teams.find((t) => t.fills && t.id !== team!.id);
      const role = roleFrom(libId, team!.id, { id: newId, showsAsTeamId: other?.id });
      d.roles.push(role);
    });
    setTimeout(() => setOpenRole(id), 0);
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
    setPicking(false);
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
          <span className="row hh-add-team">
            <button className="ghost-link" onClick={() => addTeam(false)} disabled={c.teams.length >= 8 || c.teams.some((t) => !t.fills && t.name === "Loners")}>
              <Icon name="plus" size={18} /> Loners
            </button>
          </span>
        }
      >
        <p className="muted small hh-section-hint">Blue and Red are in every game and split the plain cards between them. Loners holds the roles that play only for themselves.</p>
        <div className="hh-list">
          {c.teams.map((t) =>
            isCoreTeam(t.id) ? (
              <div key={t.id} className="hh-team-edit core" style={teamStyle(t)}>
                <div className="row hh-team-top">
                  <span className="hh-team-swatch" aria-hidden="true" />
                  <b className="hh-team-fixed-name">{t.name}</b>
                  <span className="tag">In every game</span>
                </div>
                <p className="hh-team-fixed-goal">{t.goal}</p>
              </div>
            ) : (
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
              {/* Only Blue and Red fill the deck and have a side's goal: a loner plays for its own role. */}
              <p className="muted small">Loners play for the goal written on their own role.</p>
            </div>
            ),
          )}
        </div>
      </Section>

      <Section
        title="Roles"
        icon="card"
        aside={
          <button className="ghost-link" onClick={() => setPicking(!picking)} aria-expanded={picking} disabled={c.teams.length === 0}>
            <Icon name={picking ? "x" : "plus"} size={18} /> {picking ? "Close list" : "Add roles"}
          </button>
        }
      >
        {picking && <RolePicker config={c} onAdd={addRole} />}
        {c.roles.length === 0 ? (
          !picking && <p className="muted small">No roles yet: every card will be a plain team card. Tap Add roles to pick some.</p>
        ) : (
          <div className="hh-list">
            {c.roles.map((r) => {
              const team = teamOf(c, r.teamId);
              const lib = LIBRARY_BY_ID[r.libId];
              const open = openRole === r.id;
              return (
                <div key={r.id} className={`hh-role-edit ${open ? "open" : ""} ${r.count === 0 ? "off" : ""}`} style={teamStyle(team)}>
                  <div className="hh-role-row">
                    <button className="hh-role-summary" onClick={() => setOpenRole(open ? null : r.id)} aria-expanded={open}>
                      <span className="hh-dot" aria-hidden="true" />
                      <span className="hh-role-text">
                        <b className="truncate">{r.name}</b>
                        <span className="muted small truncate">
                          {team?.name ?? "No team"}
                          {r.show !== "any" ? ` · ${SHOW_LABELS[r.show]}` : ""}
                          {lib?.disguise ? ` · shows as ${teamOf(c, r.showsAsTeamId)?.name ?? "?"}` : ""}
                          {r.count === 0 ? " · left out" : ""}
                        </span>
                      </span>
                      <Icon name="chevron" size={18} className="hh-chev" />
                    </button>
                    {isCoreRole(r) ? <span className="tag hh-core-tag">In every game</span> : <Stepper value={r.count} onChange={(v) => setRole(r.id, { count: v })} min={0} max={20} label={`Copies of ${r.name}`} />}
                  </div>
                  {open && isCoreRole(r) && (
                    <div className="hh-role-body">
                      <p className="hh-role-desc">{r.description}</p>
                      <p className="muted small">One in every game, always on {team?.name}. It can't be set aside.</p>
                      <div className="row hh-role-actions">
                        <button className="ghost-link" onClick={() => setOpenRole(null)}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                  {open && !isCoreRole(r) && (
                    <div className="hh-role-body">
                      <p className="hh-role-desc">{r.description}</p>
                      <div className="field">
                        <span className="field-label">On the side of</span>
                        <div className="hh-team-pick">
                          {c.teams.map((t) => (
                            <button key={t.id} className={r.teamId === t.id ? "on" : ""} style={teamStyle(t)} onClick={() => setRole(r.id, { teamId: t.id, showsAsTeamId: r.showsAsTeamId === t.id ? "" : r.showsAsTeamId })}>
                              <span className="hh-dot" aria-hidden="true" /> {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      {lib?.disguise && (
                        <div className="field">
                          <span className="field-label">A team share shows</span>
                          <div className="hh-team-pick">
                            {c.teams
                              .filter((t) => t.id !== r.teamId)
                              .map((t) => (
                                <button key={t.id} className={r.showsAsTeamId === t.id ? "on" : ""} style={teamStyle(t)} onClick={() => setRole(r.id, { showsAsTeamId: t.id })}>
                                  <span className="hh-dot" aria-hidden="true" /> {t.name}
                                </button>
                              ))}
                          </div>
                        </div>
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
                          <Icon name="trash" size={16} /> Remove
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
            {c.roles.filter((r) => !isCoreRole(r)).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || "Unnamed role"}
              </option>
            ))}
          </select>
        </label>
        <Switch checked={c.setAside} onChange={(v) => up((d) => void (d.setAside = v))} label="Set one card aside" hint="One card more than there are players is dealt, and nobody gets it. Nobody knows which." />
      </Section>

      <Section title="Rooms" icon="swap">
        <p className="muted small hh-section-hint">Every game has two rooms: the President and the Bomber are played for by where they end up. Each phone says which room its player starts in.</p>
        {c.groups && (
          <div className="hh-two">
            {[0, 1].map((i) => (
              <label key={i}>
                <span className="field-label">Room {i + 1}</span>
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
        <GrowArea rows={5} value={c.notes} maxLength={2000} placeholder="Goals, how the game ends, anything everyone should be able to read on their phone" onChange={(e) => up((d) => void (d.notes = e.target.value))} aria-label="House rules" />
      </Section>

      <div className="hh-setup-bar">
        <div className="hh-setup-preview">
          {"error" in deck ? (
            <p className="error small hh-preview-msg">{problems[0] ?? deck.error}</p>
          ) : (
            <div className="hh-deck-bar" aria-label={`How the deck splits for ${preview} players`}>
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
          <Stepper value={preview} onChange={setPreview} min={2} max={60} label="Players in the preview" format={(v) => `${v}`} />
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

/** The role library, grouped, each with what it does and how often it is already in the setup. */
function RolePicker({ config, onAdd }: { config: Config; onAdd: (libId: string) => void }) {
  return (
    <div className="hh-picker">
      {ROLE_GROUPS.filter((g) => g.id !== "key").map((g) => (
        <section key={g.id} className={`hh-picker-group g-${g.id}`}>
          <h3>{g.name}</h3>
          <p className="muted small">{g.blurb}</p>
          <ul>
            {LIBRARY.filter((r) => r.group === g.id).map((r) => {
              const inDeck = config.roles.filter((x) => x.libId === r.id).reduce((n, x) => n + x.count, 0);
              return (
                <li key={r.id}>
                  <div className="hh-pick-text">
                    <b>
                      {r.name}
                      {r.copies > 1 && <span className="tag">comes in {r.copies}</span>}
                      {r.show !== "any" && <span className="tag">{SHOW_LABELS[r.show]}</span>}
                      {r.disguise && <span className="tag">disguised</span>}
                    </b>
                    <span className="muted small">{r.description}</span>
                  </div>
                  <button className={`hh-pick-add ${inDeck ? "has" : ""}`} onClick={() => onAdd(r.id)} aria-label={`Add ${r.name}`}>
                    {inDeck ? (
                      <>
                        <Icon name="plus" size={16} /> {inDeck}
                      </>
                    ) : (
                      <>
                        <Icon name="plus" size={16} /> Add
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** A text box that grows to fit what is in it, so a goal or a rule is never cut off mid-line. */
function GrowArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} className={`grow ${props.className ?? ""}`} />;
}
