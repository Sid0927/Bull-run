/**
 * When something on the page breaks, say so and offer a way back, instead of leaving a blank
 * screen; and send the error to the server log so it can be found and fixed.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

let sent = 0;
export function reportError(message: string, stack?: string) {
  if (sent++ >= 5) return; // a loop of errors shouldn't flood the server
  fetch("/api/client-error", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, stack, where: `${location.hash || "#/"} · ${innerWidth}×${innerHeight} · ${navigator.userAgent}` }),
  }).catch(() => {});
}

/** Errors outside React (a click handler, a timer, a failed promise) are reported too. */
export function reportUncaughtErrors() {
  addEventListener("error", (e) => reportError(String(e.message), (e.error as Error | undefined)?.stack));
  addEventListener("unhandledrejection", (e) => reportError(`Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`, (e.reason as Error | undefined)?.stack));
}

export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error.message, `${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="page">
        <div className="empty-state crash">
          <h1 className="page-title">Something went wrong on this screen</h1>
          <p className="muted">Your game is safe on the server. Reload to carry on.</p>
          <div className="crash-actions">
            <button className="primary big" onClick={() => location.reload()}>
              Reload
            </button>
            <button
              className="big"
              onClick={() => {
                location.hash = "#/";
                location.reload();
              }}
            >
              Back to my games
            </button>
          </div>
          <details className="small muted">
            <summary>Details</summary>
            <pre className="crash-detail">{error.message}</pre>
          </details>
        </div>
      </main>
    );
  }
}
