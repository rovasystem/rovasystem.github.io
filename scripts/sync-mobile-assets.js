/**
 * Syncs built shared modules from packages/modules/dist to Capacitor www folders.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const dist = path.join(ROOT, "packages", "modules", "dist");

const sharedMobile = ["rova-local-mode.js"];

const targets = [
  {
    app: path.join(ROOT, "apps", "mobile-maliar", "www"),
    files: [...sharedMobile, "rova-maliar.js", "rova-maliar.css"]
  },
  {
    app: path.join(ROOT, "apps", "mobile-elektrikar", "www"),
    files: [...sharedMobile, "rova-elektrikar.js", "rova-elektrikar.css", "rova-ar-native.js", "rova-ar-3d.js", "rova-ar-3d.css", "rova-ar-3d-calib.js"]
  },
  {
    app: path.join(ROOT, "apps", "mobile-obhliadka", "www"),
    files: [...sharedMobile, "rova-local-db.js", "rova-quote-core.js", "rova-obhliadka.js", "rova-cennik.css", "rova-obhliadka.css"]
  }
];

if (!fs.existsSync(dist)) {
  console.error("Run: npm run build -w @rova/modules");
  process.exit(1);
}

for (const { app, files } of targets) {
  fs.mkdirSync(app, { recursive: true });
  for (const f of files) {
    const src = path.join(dist, f);
    if (!fs.existsSync(src)) {
      console.warn("Missing", src);
      continue;
    }
    fs.copyFileSync(src, path.join(app, f));
    console.log("✓", path.relative(ROOT, app), f);
  }
}

console.log("Mobile assets synced.");
