import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { unlockSoundOnFirstTouch } from "./sound.ts";
import { App } from "./App.tsx";
import { CrashScreen, reportUncaughtErrors } from "./crash.tsx";
import { initTheme } from "./theme.tsx";
import "./styles.css";

initTheme();
unlockSoundOnFirstTouch();
reportUncaughtErrors();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CrashScreen>
      <App />
    </CrashScreen>
  </StrictMode>,
);
