import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
fs.mkdirSync(dist, { recursive: true });

const bundles = [
  { src: "local/rova-local-mode.js", out: "rova-local-mode.js" },
  { src: "storage/rova-local-db.js", out: "rova-local-db.js" },
  { src: "backup/rova-backup.js", out: "rova-backup.js" },
  { src: "license/rova-license-client.js", out: "rova-license-client.js" },
  { src: "quote-core/rova-quote-core.js", out: "rova-quote-core.js" },
  { src: "quote-core/rova-company-settings.js", out: "rova-company-settings.js" },
  { src: "cennik/rova-cennik.js", out: "rova-cennik.js" },
  { src: "obhliadka/rova-obhliadka.js", out: "rova-obhliadka.js" },
  { src: "ponuka/rova-ponuka.js", out: "rova-ponuka.js" },
  { src: "pdf/rova-pdf.js", out: "rova-pdf.js" },
  { src: "maliar/rova-maliar.js", out: "rova-maliar.js" },
  { src: "elektrikar/rova-elektrikar.js", out: "rova-elektrikar.js" },
  { src: "ai-majster/rova-ai-majster.js", out: "rova-ai-majster.js" },
  { src: "bim-r674/rova-bim-r674.js", out: "rova-bim-r674.js" },
  { src: "ar-import/rova-ar-import.js", out: "rova-ar-import.js" }
];

for (const { src, out } of bundles) {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "src", src)],
    outfile: path.join(dist, out),
    bundle: false,
    minify: true,
    format: "iife",
    target: "es2020"
  });
  console.log("built", out);
}

await esbuild.build({
  entryPoints: [path.join(__dirname, "src", "elektrikar", "rova-ar-native.js")],
  outfile: path.join(dist, "rova-ar-native.js"),
  bundle: false,
  minify: true,
  format: "iife",
  target: "es2020"
});
console.log("built rova-ar-native.js");

await esbuild.build({
  entryPoints: [path.join(__dirname, "src", "elektrikar", "rova-ar-3d.js")],
  outfile: path.join(dist, "rova-ar-3d.js"),
  bundle: false,
  minify: true,
  format: "iife",
  target: "es2020"
});
console.log("built rova-ar-3d.js");

await esbuild.build({
  entryPoints: [path.join(__dirname, "src", "elektrikar", "rova-ar-3d-calib.js")],
  outfile: path.join(dist, "rova-ar-3d-calib.js"),
  bundle: false,
  minify: true,
  format: "iife",
  target: "es2020"
});
console.log("built rova-ar-3d-calib.js");

const cssPairs = [
  ["obhliadka/rova-obhliadka.css", "rova-obhliadka.css"],
  ["ponuka/rova-ponuka.css", "rova-ponuka.css"],
  ["maliar/rova-maliar.css", "rova-maliar.css"],
  ["elektrikar/rova-elektrikar.css", "rova-elektrikar.css"],
  ["elektrikar/rova-ar-3d.css", "rova-ar-3d.css"],
  ["ai-majster/rova-ai-majster.css", "rova-ai-majster.css"],
  ["bim-r674/rova-bim-r674.css", "rova-bim-r674.css"]
];
for (const [src, out] of cssPairs) {
  fs.copyFileSync(path.join(__dirname, "src", src), path.join(dist, out));
}
