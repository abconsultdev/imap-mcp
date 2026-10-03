#!/usr/bin/env node
/**
 * Baut die .mcpb-Bundles für Claude Desktop. Beide Varianten enthalten denselben
 * Server und unterscheiden sich nur im Manifest, also im Installationsdialog:
 *
 *   imap-mail.mcpb      manifest.json      bis zu zwei Postfächer, alles je Postfach
 *   imap-mail-10.mcpb   manifest-10.json   bis zu zehn, Sonderfälle in Sammelfeldern
 *
 *   node scripts/build-bundle.mjs           bauen und prüfen
 *   node scripts/build-bundle.mjs --skip-checks   nur bauen
 *
 * Der Server wird mit esbuild zu einer einzigen Datei gebündelt. Damit entfällt
 * das node_modules-Verzeichnis (rund 5000 Dateien, 34 MB) komplett - inklusive
 * Typdeklarationen, Sourcemaps und der HTTP-Transporte des MCP-SDK, die ein
 * stdio-Server nie anfasst.
 *
 * Weil Bündeln dynamisch nachgeladene Module zerreißen kann (iconv-lite,
 * mailparser, MailComposer), prüft der Build sein eigenes Ergebnis, bevor
 * gepackt wird.
 */
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const stage = join(buildDir, "bundle");
const serverDir = join(stage, "server");
const skipChecks = process.argv.includes("--skip-checks");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opts });

// Über die JS-API statt der Kommandozeile: der Banner enthält Anführungszeichen
// und Semikolons, die die Windows-Shell sonst zerlegt.
const esbuild = (entry, outfile) =>
  build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    logLevel: "warning",
    // CJS-Abhängigkeiten im ESM-Bundle brauchen ein require().
    banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
  });

const schritte = skipChecks ? 4 : 6;
let n = 0;
const schritt = (text) => console.log(`\n${++n}/${schritte}  ${text}`);

schritt("Typen prüfen");
run("npx", ["tsc", "--noEmit"]);

schritt("Staging-Ordner vorbereiten");
await rm(buildDir, { recursive: true, force: true });
await mkdir(serverDir, { recursive: true });

schritt("Server zu einer Datei bündeln");
await esbuild(join(root, "src", "index.ts"), join(serverDir, "index.js"));
// Markiert den Ordner als ESM, damit Node die .js-Datei als Modul lädt.
await writeFile(join(serverDir, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");

if (!skipChecks) {
  schritt("Bibliotheken im Bundle prüfen (Zeichensätze, Anhänge, Mail-Aufbau)");
  const probe = join(buildDir, "libs-check.mjs");
  await esbuild(join(root, "test", "bundle-libs.ts"), probe);
  run(process.execPath, [probe]);

  schritt("Gebündelten Server gegen die Testmatrix fahren");
  run(process.execPath, [join(root, "test", "env-matrix.mjs")], {
    env: { ...process.env, TEST_SERVER: join(serverDir, "index.js") },
  });
  await rm(probe, { force: true });
}

schritt("Manifeste übernehmen und packen");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
for (const extra of ["README.md", "icon.png"]) {
  if (existsSync(join(root, extra))) await cp(join(root, extra), join(stage, extra));
}
const VARIANTEN = [
  { manifest: "manifest.json", datei: "imap-mail.mcpb" },
  { manifest: "manifest-10.json", datei: "imap-mail-10.mcpb" },
];
for (const { manifest: quelle, datei } of VARIANTEN) {
  const manifest = JSON.parse(await readFile(join(root, quelle), "utf8"));
  manifest.version = pkg.version;
  await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  run("npx", ["mcpb", "validate", join(stage, "manifest.json")]);
  run("npx", ["mcpb", "pack", stage, join(buildDir, datei)]);
}

console.log("\nFertig:");
for (const { datei } of VARIANTEN) {
  const { size } = await stat(join(buildDir, datei));
  console.log(`  build/${datei} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}
console.log("Zum Testen per Doppelklick installieren oder in das Claude-Desktop-Fenster ziehen.");
