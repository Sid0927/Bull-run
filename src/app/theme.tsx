/** Day, night, or follow the phone. The choice is remembered on this device. */
import { useEffect, useState } from "react";
import { Icon } from "./ui.tsx";

type Theme = "light" | "dark" | "system";
const KEY = "bull-run:theme";

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

/** Call once before the first render so the page never flashes the wrong theme. */
export function initTheme() {
  applyTheme(read());
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: the choice lasts until the page closes */
    }
  }, [theme]);
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const label = { system: "Auto", light: "Day", dark: "Night" }[theme];
  const icon = ({ system: "auto", light: "sun", dark: "moon" } as const)[theme];
  return (
    <button className="icon-btn theme-toggle" onClick={() => setTheme(next[theme])} title={`Theme: ${label}. Tap for ${{ system: "Day", light: "Night", dark: "Auto" }[theme]}.`} aria-label={`Theme: ${label}`}>
      <Icon name={icon} />
    </button>
  );
}
