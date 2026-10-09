import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { GAME_LENGTHS } from "../engine/index.ts";
import type { AdminUser, GameSummary, Me } from "../shared/api.ts";
import { ApiError, api } from "./api.ts";
import { GameScreen } from "./GameScreen.tsx";
import { BullLogo } from "./logos.tsx";
import { Rulebook } from "./Rulebook.tsx";
import { ThemeToggle } from "./theme.tsx";

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
    const on = () => setRoute(parse(location.hash));
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
  if (me === undefined) return <div className="splash"><BullLogo size={56} /></div>;
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
  if (route.name === "game") return shell(<GameScreen id={route.id} me={me} onRules={openRules} />, true);
  if (route.name === "admin" && me.isAdmin) return shell(<Admin me={me} />);
  return shell(<Lobby me={me} />);
}

function TopBar({ me, onRules, onSignOut }: { me: Me; onRules: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <BullLogo size={28} /> Bull Run
      </a>
      <nav className="topnav">
        <button onClick={onRules}>Rules</button>
        <ThemeToggle />
        <button className="me-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {me.username} ▾
        </button>
      </nav>
      {open && (
        <div className="menu" onClick={() => setOpen(false)}>
          <a href="#/">My games</a>
          {me.isAdmin && <a href="#/admin">Admin</a>}
          <button onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}

// ─── Sign in ────────────────────────────────────────────────────────────────────────────

function Login({ onIn, onRules }: { onIn: (m: Me) => void; onRules: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onIn(await api.login(username, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-card">
        <BullLogo size={64} />
        <h1>Bull Run</h1>
        <p className="muted">The Indian stock market game for 3–5 players</p>
        <form onSubmit={submit} className="stack">
          <label>
            Username
            <input id="username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Password
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary big" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="muted small">Accounts are given out by the game's admin.</p>
        <button className="link" onClick={onRules}>
          How to play
        </button>
      </div>
      <p className="credit">Created by Siddhant Bansal</p>
    </main>
  );
}

// ─── Lobby ──────────────────────────────────────────────────────────────────────────────

const STATUS: Record<GameSummary["status"], string> = { lobby: "Waiting for players", playing: "In play", ended: "Finished", abandoned: "Abandoned" };

function Lobby({ me }: { me: Me }) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [rounds, setRounds] = useState(9);
  const [maxPlayers, setMaxPlayers] = useState(5);
  const load = useCallback(() => api.games().then(setGames, (e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function run(f: () => Promise<GameSummary>) {
    setError("");
    try {
      const g = await f();
      go(`#/game/${g.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const live = games?.filter((g) => g.status === "lobby" || g.status === "playing") ?? [];
  const done = games?.filter((g) => g.status === "ended") ?? [];
  return (
    <main className="page">
      <h1 className="page-title">Hello, {me.username}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="lobby-grid">
        <section className="panel">
          <h2>Join a game</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.join(code));
            }}
          >
            <input
              id="join-code"
              className="code-input"
              placeholder="Code"
              value={code}
              maxLength={5}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
            <button className="primary" disabled={code.length !== 5}>
              Join
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>New game</h2>
          <div className="field">
            Rounds
            <div className="seg" role="group" aria-label="Rounds">
              {GAME_LENGTHS.map((n) => (
                <button key={n} className={n === rounds ? "on" : ""} onClick={() => setRounds(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            Players (up to)
            <div className="seg" role="group" aria-label="Most players">
              {[3, 4, 5].map((n) => (
                <button key={n} className={n === maxPlayers ? "on" : ""} onClick={() => setMaxPlayers(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {maxPlayers === 5 && rounds === 12 && <p className="muted small">With five players, nine rounds is recommended.</p>}
          <button className="primary" onClick={() => run(() => api.create(rounds, maxPlayers))}>
            Create game
          </button>
        </section>
      </div>

      <section className="panel">
        <h2>Your games</h2>
        {games === null ? (
          <p className="muted">Loading…</p>
        ) : live.length === 0 ? (
          <p className="muted">No games yet. Create one and share its code, or join with a code someone sent you.</p>
        ) : (
          <GameList games={live} />
        )}
      </section>
      {done.length > 0 && (
        <section className="panel">
          <h2>Finished</h2>
          <GameList games={done} />
        </section>
      )}
      <ChangePassword />
    </main>
  );
}

function GameList({ games }: { games: GameSummary[] }) {
  return (
    <ul className="game-list">
      {games.map((g) => (
        <li key={g.id}>
          <a href={`#/game/${g.id}`} className={`game-item ${g.yourMove ? "your-move" : ""}`}>
            <span className="game-code">{g.code}</span>
            <span className="game-meta">
              <b>{g.yourMove ? "Your move" : STATUS[g.status]}</b>
              {g.status === "playing" && g.round !== null && ` · round ${g.round} of ${g.rounds}`}
              <span className="muted small">{g.players.join(", ")}</span>
            </span>
            <span aria-hidden="true">›</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  if (!open)
    return (
      <p>
        <button className="link" onClick={() => setOpen(true)}>
          Change my password
        </button>
      </p>
    );
  return (
    <section className="panel">
      <h2>Change my password</h2>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.changePassword(cur, next);
            setMsg("Password changed.");
            setCur("");
            setNext("");
          } catch (err) {
            setMsg((err as Error).message);
          }
        }}
      >
        <label>
          Current password
          <input id="cur-pw" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </label>
        <label>
          New password
          <input id="new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} />
        </label>
        {msg && <p className="small">{msg}</p>}
        <button className="primary">Save</button>
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
  const [msg, setMsg] = useState("");
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState("");
  const load = useCallback(() => {
    api.users().then(setUsers, (e) => setMsg(e.message));
    api.allGames().then(setGames, () => {});
  }, []);
  useEffect(load, [load]);

  async function attempt(f: () => Promise<unknown>, ok: string) {
    try {
      await f();
      setMsg(ok);
      load();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Admin</h1>
      {msg && (
        <p className="notice" role="status">
          {msg}
        </p>
      )}
      <section className="panel">
        <h2>New account</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            attempt(async () => {
              await api.createUser(username.trim(), password, false);
              setUsername("");
              setPassword("");
            }, `Account ${username.trim()} created. Give them the username and password.`);
          }}
        >
          <label>
            Username
            <input id="new-user" autoCapitalize="none" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Password
            <input id="new-user-pw" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <button className="primary">Create account</button>
        </form>
      </section>

      <section className="panel">
        <h2>Accounts ({users.length})</h2>
        <ul className="user-list">
          {users.map((u) => (
            <li key={u.id} className={u.active ? "" : "inactive"}>
              <div className="user-row">
                <span>
                  <b>{u.username}</b> {u.isAdmin && <span className="tag">admin</span>} {!u.active && <span className="tag warn">switched off</span>}
                </span>
                <span className="row">
                  <button onClick={() => setResetFor(resetFor === u.id ? null : u.id)}>New password</button>
                  {u.id !== me.id && (
                    <button onClick={() => attempt(() => api.updateUser(u.id, { active: !u.active }), u.active ? `${u.username} can no longer sign in.` : `${u.username} can sign in again.`)}>
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
                  <input id={`reset-${u.id}`} autoComplete="off" placeholder="New password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} minLength={6} required />
                  <button className="primary">Set</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>All games</h2>
        {games.length === 0 ? (
          <p className="muted">No games yet.</p>
        ) : (
          <ul className="game-list">
            {games.map((g) => (
              <li key={g.id} className="admin-game">
                <a href={`#/game/${g.id}`} className="game-item">
                  <span className="game-code">{g.code}</span>
                  <span className="game-meta">
                    <b>{STATUS[g.status]}</b>
                    {g.round !== null && g.status === "playing" && ` · round ${g.round} of ${g.rounds}`}
                    <span className="muted small">
                      {g.players.join(", ")} · created by {g.createdBy}
                    </span>
                  </span>
                </a>
                {(g.status === "lobby" || g.status === "playing") && (
                  <button className="danger-outline" onClick={() => attempt(() => api.abandon(g.id), `Game ${g.code} abandoned.`)}>
                    Abandon
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
