/** Undercover's front door: join a room with its code, host one, or go back to one you are in. */
import { useEffect, useState } from "react";
import { CARDS_NAME, type CardRoomSummary } from "../../cards/types.ts";
import type { Me } from "../../shared/api.ts";
import { CodeInput, Icon } from "../ui.tsx";
import { cardsApi } from "./api.ts";
import { HandMark } from "./CardArt.tsx";

export function CardsHome({ me, go }: { me: Me; go: (hash: string) => void }) {
  const [rooms, setRooms] = useState<CardRoomSummary[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    cardsApi.mine().then(setRooms, (e) => {
      setRooms([]);
      setError((e as Error).message);
    });
  }, []);

  async function run(f: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      go(`#/cards/${await f()}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page hh hh-home">
      <section className="hh-hero">
        <div className="hh-hero-copy">
          <p className="eyebrow">Hi {me.username}</p>
          <h1 className="hh-title">{CARDS_NAME}</h1>
          <p className="hh-tagline">Secret role cards for the game in the room. Everyone's phone is their card.</p>
        </div>
        <div className="hh-fan" aria-hidden="true">
          <span className="hh-fan-card a" />
          <span className="hh-fan-card b" />
          <span className="hh-fan-card c">
            <HandMark size={44} />
          </span>
        </div>
      </section>

      {error && (
        <p className="error banner" role="alert">
          {error}
        </p>
      )}

      <div className="lobby-grid">
        <section className="panel">
          <h2>
            <Icon name="users" /> Join a room
          </h2>
          <p className="muted small">Type the 5-letter code on the host's phone.</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => (await cardsApi.join(code)).code);
            }}
          >
            <CodeInput value={code} onChange={setCode} id="cards-code" label="Room code" letters />
            <button className="primary big" disabled={code.length !== 5 || busy}>
              Join room <Icon name="arrow" size={18} />
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>
            <Icon name="cards" /> Host a room
          </h2>
          <p className="muted small">You set the teams and roles, everyone joins, and you deal.</p>
          <ol className="hh-steps">
            <li>
              <b>Set up</b> the teams and roles, or start from a ready-made setup.
            </li>
            <li>
              <b>Share</b> the code. Players join on their own phones.
            </li>
            <li>
              <b>Deal.</b> Each phone gets one secret card.
            </li>
          </ol>
          <button className="primary big shine" disabled={busy} onClick={() => run(async () => (await cardsApi.create()).code)}>
            Start a room <Icon name="arrow" size={18} />
          </button>
          {me.isAdmin && (
          <button
            className="ghost big"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { code } = await cardsApi.create();
                await cardsApi.addTests(code, 5);
                return code;
              })
            }
          >
            <Icon name="robot" size={18} /> Test game, with 5 test players
          </button>
          )}
        </section>
      </div>

      <details className="panel hh-how" open={rooms !== null && rooms.length === 0}>
        <summary>
          <Icon name="book" /> How it works <Icon name="chevron" size={18} className="hh-chev" />
        </summary>
        <ol className="hh-how-steps">
          <li>
            <span className="hh-how-icon"><Icon name="users" /></span>
            <span><b>Join</b> with the room code, or the link the host shares. Keep your phone with you.</span>
          </li>
          <li>
            <span className="hh-how-icon"><Icon name="eye" /></span>
            <span><b>Look</b> at your card when it is dealt: tap it, shield the screen, and it turns itself back over.</span>
          </li>
          <li>
            <span className="hh-how-icon"><Icon name="flag" /></span>
            <span><b>Play for your goal.</b> Your side's goal is written on your card; a Loner's is its own.</span>
          </li>
          <li>
            <span className="hh-how-icon"><Icon name="shield" /></span>
            <span><b>Show</b> someone your team or your whole card, full screen. Showing goes both ways: you both show, or nobody does.</span>
          </li>
          <li>
            <span className="hh-how-icon"><Icon name="timer" /></span>
            <span><b>Rounds</b> run on a shared timer. When it ends, the groups trade players in person.</span>
          </li>
        </ol>
      </details>

      <section className="stack">
        <h2 className="section-title">Your rooms</h2>
        {rooms === null ? (
          <div className="skeleton-list">
            <div className="skeleton" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="empty-state">
            <Icon name="cards" size={32} />
            <p>No rooms yet. Start one, or join with a code.</p>
          </div>
        ) : (
          <ul className="game-list">
            {rooms.map((r) => (
              <li key={r.code}>
                <a href={`#/cards/${r.code}`} className={`game-item ${r.dealt ? "your-move" : ""}`}>
                  <span className="ticket">
                    <span className="ticket-label">Room</span>
                    <span className="game-code">{r.code}</span>
                  </span>
                  <span className="game-meta">
                    <b className="truncate">{r.title || CARDS_NAME}</b>
                    <span className="game-status">
                      <span className={`pill ${r.dealt ? "pill-move" : "pill-lobby"}`}>{r.dealt ? "Cards out" : "Setting up"}</span>
                      <span className="muted small">
                        {r.players} {r.players === 1 ? "player" : "players"} · {r.youHost ? "you host" : `${r.host} hosts`}
                      </span>
                    </span>
                  </span>
                  <Icon name="arrow" className="go" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
