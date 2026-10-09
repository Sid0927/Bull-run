import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DIVIDEND_ROUNDS, GAME_LENGTHS, IPO_ROUND, STARTING_CASH } from "../engine/index.ts";
import type { AdminUser, GameSummary, LoginRecord, Me } from "../shared/api.ts";
import { ApiError, api } from "./api.ts";
import { GameScreen } from "./GameScreen.tsx";
import { BullLogo } from "./logos.tsx";
import { Rulebook } from "./Rulebook.tsx";
import { ThemeToggle } from "./theme.tsx";
import { Avatar, AvatarStack, Icon, TickerTape, When, clock, fullTime } from "./ui.tsx";

type Route = { name: "lobby" } | { name: "game"; id: number } | { name: "admin" } | { name: "rules" };

function parse(hash: string): Route {
  const m = hash.match(/^#\/game\/(\d+)$/);
  if (m) return { name: "game", id: Number(m[1]) };
  if (hash === "#/admin") return { name: "admin" };
  if (hash === "#rules") return { name: "rules" };
  return { name: "lobby" };
}

export function go(hash: string) {
  if (location.hash !== hash) location.hash = hash;
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [back, setBack] = useState("#/");

  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    api.me().then(setMe, () => setMe(null));
  }, []);

  const openRules = () => {
    setBack(location.hash && location.hash !== "#rules" ? location.hash : "#/");
    go("#rules");
  };

  if (route.name === "rules") return <Rulebook onClose={() => go(back)} />;
  if (me === undefined)
    return (
      <div className="splash">
        <BullLogo size={64} />
      </div>
    );
  if (me === null) return <Login onIn={setMe} onRules={openRules} />;

  const signOut = async () => {
    await api.logout().catch(() => {});
    setMe(null);
    go("#/");
  };
  const shell = (body: ReactNode, wide = false) => (
    <div className={`app ${wide ? "wide" : ""}`}>
      <TopBar me={me} onRules={openRules} onSignOut={signOut} />
      {body}
    </div>
  );
  if (route.name === "game") return shell(<GameScreen key={route.id} id={route.id} me={me} onRules={openRules} />, true);
  if (route.name === "admin" && me.isAdmin) return shell(<Admin me={me} />);
  return shell(<Lobby me={me} />);
}

function TopBar({ me, onRules, onSignOut }: { me: Me; onRules: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="Bull Run: my games">
        <BullLogo size={30} />
        <span className="brand-word">
          Bull<span>Run</span>
        </span>
      </a>
      <nav className="topnav">
        <button className="icon-btn" onClick={onRules} aria-label="How to play" title="How to play">
          <Icon name="book" />
        </button>
        <ThemeToggle />
        <div className="me-wrap" ref={ref}>
          <button className="me-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
            <Avatar name={me.username} size={28} />
            <span className="me-name">{me.username}</span>
            <span className="chev" aria-hidden="true">
              ▾
            </span>
          </button>
          {open && (
            <div className="menu" role="menu" onClick={() => setOpen(false)}>
              <div className="menu-head">
                <Avatar name={me.username} size={36} />
                <div>
                  <b>{me.username}</b>
                  <div className="muted small">{me.isAdmin ? "Admin" : "Player"}</div>
                </div>
              </div>
              <a href="#/" role="menuitem">
                <Icon name="home" size={18} /> My games
              </a>
              {me.isAdmin && (
                <a href="#/admin" role="menuitem">
                  <Icon name="shield" size={18} /> Admin
                </a>
              )}
              <button role="menuitem" onClick={onRules}>
                <Icon name="book" size={18} /> How to play
              </button>
              <button role="menuitem" onClick={onSignOut}>
                <Icon name="out" size={18} /> Sign out
              </button>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}

// ─── Sign in ────────────────────────────────────────────────────────────────────────────

function Login({ onIn, onRules }: { onIn: (m: Me) => void; onRules: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onIn(await api.login(username.trim(), password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <TickerTape />
      <div className="login-glow" aria-hidden="true" />
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-center">
        <div className="login-hero">
          <div className="logo-halo">
            <BullLogo size={76} />
          </div>
          <h1 className="wordmark">
            Bull <span>Run</span>
          </h1>
          <p className="tagline">The Dalal Street board game</p>
          <ul className="hero-facts" aria-label="At a glance">
            <li>3–5 traders</li>
            <li>₹{STARTING_CASH.toLocaleString("en-IN")} each</li>
            <li>7 companies</li>
          </ul>
        </div>
        <form onSubmit={submit} className="login-card">
          <h2>Sign in to trade</h2>
          <label className="float">
            <input id="username" placeholder=" " autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
            <span>Username</span>
          </label>
          <label className="float">
            <input id="password" placeholder=" " type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <span>Password</span>
            <button type="button" className="peek" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
              {show ? "Hide" : "Show"}
            </button>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary big shine" disabled={busy}>
            {busy ? (
              <span className="spinner" aria-label="Signing in" />
            ) : (
              <>
                Enter the market <Icon name="arrow" size={18} />
              </>
            )}
          </button>
          <p className="muted small center">Accounts are given out by the game's admin.</p>
          <button type="button" className="ghost-link" onClick={onRules}>
            <Icon name="book" size={16} /> How to play
          </button>
        </form>
        <p className="credit">
          <span>Created by</span> <b>Siddhant Bansal</b>
        </p>
      </div>
      <TickerTape reverse />
    </main>
  );
}

// ─── Lobby ──────────────────────────────────────────────────────────────────────────────

const LOGIN_RESULT: Record<LoginRecord["result"], string> = { ok: "Signed in", wrong: "Wrong password", blocked: "Blocked: too many tries", off: "Account switched off" };

const STATUS: Record<GameSummary["status"], string> = { lobby: "Waiting room", playing: "In play", ended: "Finished", abandoned: "Abandoned" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Lobby({ me }: { me: Me }) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [rounds, setRounds] = useState(9);
  const [maxPlayers, setMaxPlayers] = useState(5);
  const load = useCallback(
    () =>
      api.games().then(
        (g) => {
          setGames(g);
          setError("");
        },
        (e) => (e instanceof ApiError && e.status === 401 ? location.reload() : setError(e.message)),
      ),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function run(f: () => Promise<GameSummary>) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const g = await f();
      go(`#/game/${g.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const yours = games?.filter((g) => g.yourMove) ?? [];
  const live = games?.filter((g) => !g.yourMove && (g.status === "lobby" || g.status === "playing")) ?? [];
  const done = games?.filter((g) => g.status === "ended") ?? [];
  const divRounds = DIVIDEND_ROUNDS.filter((r) => r <= rounds);
  return (
    <main className="page lobby">
      <section className="lobby-hero">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1 className="page-title">{me.username}</h1>
          <p className="muted">
            {games === null ? "Checking the floor…" : yours.length ? `${yours.length} ${yours.length === 1 ? "game is" : "games are"} waiting on your move.` : "The market is open. Start a game or join one."}
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <svg viewBox="0 0 120 60">
            <path d="M2 52 L22 40 L36 46 L56 24 L70 32 L92 10 L118 4" className="hero-line" />
            <path d="M2 52 L22 40 L36 46 L56 24 L70 32 L92 10 L118 4 L118 60 L2 60 Z" className="hero-fill" />
          </svg>
        </div>
      </section>

      {error && (
        <p className="error banner" role="alert">
          {error}
        </p>
      )}

      {me.isAdmin && (
        <a className="admin-link" href="#/admin">
          <Icon name="shield" /> <span>See all games and accounts</span> <Icon name="arrow" size={18} />
        </a>
      )}

      {yours.length > 0 && (
        <section className="stack">
          <h2 className="section-title">
            <span className="pulse-dot" /> Your move
          </h2>
          <GameList games={yours} />
        </section>
      )}

      <div className="lobby-grid">
        <section className="panel join-panel">
          <h2>
            <Icon name="users" /> Join a game
          </h2>
          <p className="muted small">Type the 5-letter code the host shared.</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.join(code));
            }}
          >
            <CodeInput value={code} onChange={setCode} />
            <button className="primary big" disabled={code.length !== 5 || busy}>
              Join game <Icon name="arrow" size={18} />
            </button>
          </form>
        </section>
        <section className="panel new-panel">
          <h2>
            <Icon name="plus" /> New game
          </h2>
          <div className="field">
            <span className="field-label">Rounds</span>
            <div className="seg seg-fill" role="group" aria-label="Rounds">
              {GAME_LENGTHS.map((n) => (
                <button key={n} className={n === rounds ? "on" : ""} aria-pressed={n === rounds} onClick={() => setRounds(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Players (up to)</span>
            <div className="seg seg-fill" role="group" aria-label="Most players">
              {[3, 4, 5].map((n) => (
                <button key={n} className={n === maxPlayers ? "on" : ""} aria-pressed={n === maxPlayers} onClick={() => setMaxPlayers(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <ul className="game-facts small">
            <li>
              <Icon name="coin" size={16} /> Dividends after round{divRounds.length > 1 ? "s" : ""} {divRounds.join(", ")}
            </li>
            <li>
              <Icon name="rocket" size={16} /> Oracle Group IPO at the start of round {IPO_ROUND}
            </li>
            <li>
              <Icon name="flag" size={16} /> {maxPlayers === 5 && rounds !== 9 ? "With five players, 9 rounds is recommended" : `Everyone starts with ₹${STARTING_CASH.toLocaleString("en-IN")}`}
            </li>
          </ul>
          <button className="primary big" disabled={busy} onClick={() => run(() => api.create(rounds, maxPlayers))}>
            Create game <Icon name="arrow" size={18} />
          </button>
        </section>
      </div>

      <section className="stack">
        <h2 className="section-title">Your games</h2>
        {games === null ? (
          <div className="skeleton-list">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : live.length === 0 ? (
          <div className="empty-state">
            <Icon name="chart" size={32} />
            <p>{yours.length ? "Nothing else on the go." : "No games yet. Create one and share its code, or join with a code someone sent you."}</p>
          </div>
        ) : (
          <GameList games={live} />
        )}
      </section>
      {done.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Finished</h2>
          <GameList games={done} />
        </section>
      )}
      <ChangePassword />
    </main>
  );
}

/** Five letter boxes over one real input, so paste, autofill and screen readers all just work. */
function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="code-boxes">
      <span className="sr-only">Game code</span>
      <input
        id="join-code"
        value={value}
        inputMode="text"
        autoCorrect="off"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
      />
      <span className="boxes" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={`box ${i === value.length ? "cursor" : ""} ${value[i] ? "filled" : ""}`}>
            {value[i] ?? ""}
          </span>
        ))}
      </span>
    </label>
  );
}

function GameList({ games, admin }: { games: GameSummary[]; admin?: (g: GameSummary) => ReactNode }) {
  return (
    <ul className="game-list">
      {games.map((g) => (
        <li key={g.id} className={admin ? "admin-game" : ""}>
          <a href={`#/game/${g.id}`} className={`game-item status-${g.status} ${g.yourMove ? "your-move" : ""}`}>
            <span className="ticket">
              <span className="ticket-label">Code</span>
              <span className="game-code">{g.code}</span>
            </span>
            <span className="game-meta">
              <span className="game-status">
                <span className={`pill pill-${g.yourMove ? "move" : g.status}`}>{g.yourMove ? "Your move" : STATUS[g.status]}</span>
                {g.status === "playing" && g.round !== null && (
                  <span className="muted small">{g.round === 0 ? `Opening · ${g.rounds} rounds` : `Round ${g.round} of ${g.rounds}`}</span>
                )}
                {g.status === "lobby" && (
                  <span className="muted small">
                    {g.players.length}/{g.maxPlayers} joined
                  </span>
                )}
              </span>
              <span className="game-people">
                <AvatarStack names={g.players} />
                <span className="muted small truncate">
                  {g.players.join(", ")}
                  {admin && ` · by ${g.createdBy}`}
                </span>
              </span>
              <span className="game-times muted small">
                {admin ? (
                  <>
                    Created {clock(g.createdAt)}
                    {g.startedAt && <> · started {clock(g.startedAt)}</>}
                    {g.lastMoveAt && (
                      <>
                        {" "}
                        · last move <When at={g.lastMoveAt} />
                      </>
                    )}
                    {g.endedAt && <> · {g.status === "abandoned" ? "abandoned" : "finished"} {clock(g.endedAt)}</>}
                    {g.waitingFor.length > 0 && <> · waiting for {g.waitingFor.join(", ")}</>}
                  </>
                ) : g.status === "playing" ? (
                  <>
                    {g.lastMoveAt ? (
                      <>
                        Last move <When at={g.lastMoveAt} />
                      </>
                    ) : (
                      <>
                        Started <When at={g.startedAt} />
                      </>
                    )}
                    {!g.yourMove && g.waitingFor.length > 0 && <> · waiting for {g.waitingFor.join(", ")}</>}
                  </>
                ) : g.status === "ended" ? (
                  <>
                    Finished <When at={g.endedAt} />
                  </>
                ) : (
                  <>
                    Created <When at={g.createdAt} />
                  </>
                )}
              </span>
              {g.status === "playing" && g.round !== null && (
                <span className="progress" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (g.round / g.rounds) * 100)}%` }} />
                </span>
              )}
            </span>
            <span className="go" aria-hidden="true">
              <Icon name="arrow" size={18} />
            </span>
          </a>
          {admin?.(g)}
        </li>
      ))}
    </ul>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open)
    return (
      <p className="center">
        <button className="ghost-link" onClick={() => setOpen(true)}>
          <Icon name="key" size={16} /> Change my password
        </button>
      </p>
    );
  return (
    <section className="panel">
      <h2>
        <Icon name="key" /> Change my password
      </h2>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.changePassword(cur, next);
            setMsg({ ok: true, text: "Password changed." });
            setCur("");
            setNext("");
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          }
        }}
      >
        <label>
          Current password
          <input id="cur-pw" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </label>
        <label>
          New password <span className="muted small">(at least 6 characters)</span>
          <input id="new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} />
        </label>
        {msg && (
          <p className={msg.ok ? "notice" : "error"} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        )}
        <div className="row">
          <button className="primary">Save</button>
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </form>
    </section>
  );
}

// ─── Admin ──────────────────────────────────────────────────────────────────────────────

function Admin({ me }: { me: Me }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [confirmAbandon, setConfirmAbandon] = useState<number | null>(null);
  const [show, setShow] = useState<"all" | GameSummary["status"]>("all");
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [failedOnly, setFailedOnly] = useState(false);
  const load = useCallback(() => {
    api.users().then(setUsers, (e) => setMsg({ ok: false, text: e.message }));
    api.allGames().then(setGames, () => {});
    api.logins().then(setLogins, () => {});
  }, []);
  useEffect(() => {
    load();
    // Keep the games, accounts and sign-ins current while the page is open.
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      api.allGames().then(setGames, () => {});
      api.users().then(setUsers, () => {});
      api.logins().then(setLogins, () => {});
    }, 15000);
    return () => clearInterval(t);
  }, [load]);
  const shown = games.filter((g) => show === "all" || g.status === show);

  async function attempt(f: () => Promise<unknown>, ok: string) {
    try {
      await f();
      setMsg({ ok: true, text: ok });
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as ApiError).message });
    }
  }

  const players = users.filter((u) => !u.isAdmin);
  const active = games.filter((g) => g.status === "playing").length;
  return (
    <main className="page">
      <section className="lobby-hero compact">
        <div>
          <p className="eyebrow">Control room</p>
          <h1 className="page-title">Admin</h1>
        </div>
      </section>
      <div className="stat-row">
        <div className="stat">
          <b>{players.length}</b>
          <span>players</span>
        </div>
        <div className="stat">
          <b>{active}</b>
          <span>games in play</span>
        </div>
        <div className="stat">
          <b>{games.filter((g) => g.status === "ended").length}</b>
          <span>finished</span>
        </div>
      </div>
      {msg && (
        <p className={msg.ok ? "notice" : "error banner"} role="status">
          {msg.text}
        </p>
      )}
      <section className="panel">
        <h2>
          <Icon name="plus" /> New account
        </h2>
        <form
          className="new-account"
          onSubmit={(e) => {
            e.preventDefault();
            const name = username.trim();
            attempt(async () => {
              await api.createUser(name, password, false);
              setUsername("");
              setPassword("");
            }, `Account ${name} created. Give them the username and password.`);
          }}
        >
          <label>
            Username
            <input id="new-user" autoCapitalize="none" autoComplete="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Password
            <input id="new-user-pw" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <button className="primary">Create account</button>
        </form>
        <p className="muted small">Usernames are 3–24 letters, digits, dots, dashes or underscores. Passwords need 6 characters or more.</p>
      </section>

      <section className="panel">
        <h2>
          <Icon name="users" /> Accounts <span className="count">{users.length}</span>
        </h2>
        <ul className="user-list">
          {users.map((u) => (
            <li key={u.id} className={u.active ? "" : "inactive"}>
              <div className="user-row">
                <span className="user-id">
                  <Avatar name={u.username} size={34} />
                  <span>
                    <b>{u.username}</b>
                    <span className="muted small">
                      {u.isAdmin ? " Admin" : " Player"}
                      {!u.active && " · switched off"}
                    </span>
                    <span className="muted small user-times">
                      {u.lastLoginAt || u.lastSeenAt || u.devices > 0 ? (
                        <>
                          {u.lastSeenAt && (
                            <span className="time-line">
                              Last active <When at={u.lastSeenAt} />
                            </span>
                          )}
                          <span className="time-line">
                            {u.lastLoginAt ? (
                              <>
                                Last signed in <When at={u.lastLoginAt} />
                              </>
                            ) : (
                              "Signed in before sign-ins were recorded"
                            )}
                            {u.devices > 0 && ` · ${u.devices} device${u.devices === 1 ? "" : "s"}`}
                          </span>
                        </>
                      ) : (
                        "Never signed in"
                      )}
                    </span>
                  </span>
                </span>
                <span className="row">
                  <button onClick={() => setResetFor(resetFor === u.id ? null : u.id)}>New password</button>
                  {u.id !== me.id && (
                    <button className={u.active ? "danger-outline" : ""} onClick={() => attempt(() => api.updateUser(u.id, { active: !u.active }), u.active ? `${u.username} can no longer sign in.` : `${u.username} can sign in again.`)}>
                      {u.active ? "Switch off" : "Switch on"}
                    </button>
                  )}
                </span>
              </div>
              {resetFor === u.id && (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    attempt(async () => {
                      await api.updateUser(u.id, { password: resetPw });
                      setResetFor(null);
                      setResetPw("");
                    }, `New password set for ${u.username}; they have been signed out everywhere.`);
                  }}
                >
                  <input id={`reset-${u.id}`} aria-label={`New password for ${u.username}`} autoComplete="off" placeholder="New password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} minLength={6} required />
                  <button className="primary">Set</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>
          <Icon name="key" /> Sign-in history <span className="count">{logins.length}</span>
        </h2>
        <p className="muted small">Every attempt to sign in, newest first, kept for 90 days. Passwords are never recorded.</p>
        <label className="check-row">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed attempts only
          <span className="count">{logins.filter((l) => l.result !== "ok").length}</span>
        </label>
        {logins.length === 0 ? (
          <p className="muted">No sign-ins yet.</p>
        ) : (
          <ul className="login-list">
            {logins
              .filter((l) => !failedOnly || l.result !== "ok")
              .map((l) => (
                <li key={l.id} className={`login-row ${l.result}`}>
                  <Avatar name={l.username} size={30} />
                  <span className="login-who">
                    <b>{l.username}</b>
                    <span className="muted small">{l.device}</span>
                  </span>
                  <span className={`pill login-${l.result}`}>{LOGIN_RESULT[l.result]}</span>
                  <time className="login-time small muted" dateTime={l.at} title={fullTime(l.at)}>
                    {clock(l.at)}
                  </time>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>
          <Icon name="chart" /> All games <span className="count">{games.length}</span>
        </h2>
        <p className="muted small">Open any game to watch it. In games you aren't playing in, you see every player's cash, cards and sealed moves.</p>
        <div className="seg filter-seg" role="group" aria-label="Show games">
          {(
            [
              ["all", "All"],
              ["playing", "In play"],
              ["lobby", "Waiting room"],
              ["ended", "Finished"],
              ["abandoned", "Abandoned"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={show === k ? "on" : ""} aria-pressed={show === k} onClick={() => setShow(k)}>
              {label} <span className="count">{k === "all" ? games.length : games.filter((g) => g.status === k).length}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="muted">{games.length === 0 ? "No games yet." : "No games here."}</p>
        ) : (
          <GameList
            games={shown}
            admin={(g) =>
              (g.status === "lobby" || g.status === "playing") &&
              (confirmAbandon === g.id ? (
                <span className="row confirm">
                  <button className="danger" onClick={() => attempt(() => api.abandon(g.id), `Game ${g.code} abandoned.`).then(() => setConfirmAbandon(null))}>
                    Abandon {g.code}
                  </button>
                  <button onClick={() => setConfirmAbandon(null)}>Keep</button>
                </span>
              ) : (
                <button className="danger-outline" onClick={() => setConfirmAbandon(g.id)}>
                  Abandon
                </button>
              ))
            }
          />
        )}
      </section>
    </main>
  );
}
