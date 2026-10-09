import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, `npm run dev` serves the app and `npm run server` the API on :3000.
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: { proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } } },
});
