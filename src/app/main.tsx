import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { unlockSoundOnFirstTouch } from "./sound.ts";
import { App } from "./App.tsx";
import { initTheme } from "./theme.tsx";
import "./styles.css";

initTheme();
unlockSoundOnFirstTouch();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
