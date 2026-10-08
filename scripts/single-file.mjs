// Turns the Vite build into one self-contained HTML body (CSS and JS inline), for hosting the
// play-test as a single page. Run after `vite build`: node scripts/single-file.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const assets = readdirSync("dist/assets");
const css = assets.filter((f) => f.endsWith(".css")).map((f) => readFileSync(`dist/assets/${f}`, "utf8")).join("\n");
const js = assets.filter((f) => f.endsWith(".js")).map((f) => readFileSync(`dist/assets/${f}`, "utf8")).join("\n");
const html = `<title>Bull Run</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" />
<style>${css}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>
`;
writeFileSync("dist/bull-run.html", html);
console.log(`dist/bull-run.html ${(html.length / 1024).toFixed(0)} KB`);
