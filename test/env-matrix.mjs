/**
 * Konfiguration über Umgebungsvariablen - der Weg des .mcpb-Bundles.
 *
 *   node test/env-matrix.mjs
 *   TEST_SERVER=pfad/zu/index.js node test/env-matrix.mjs
 *
 * Claude Desktop reicht leer gelassene optionale Felder als unersetzten
 * Platzhalter "${user_config.x}" durch. Die Fälle bilden das nach. Endet mit
 * Exit-Code 1, sobald ein Fall vom erwarteten Ergebnis abweicht - damit bricht
 * auch `npm run bundle` ab.
 */
import { spawn } from "node:child_process";

const SERVER = process.env.TEST_SERVER ?? new URL("../build/bundle/server/index.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const P = (k) => "${user_config." + k + "}";

const ALL_KEYS = [
  "MAIL_EMAIL", "MAIL_PASSWORD", "MAIL_DISPLAY_NAME", "MAIL_ALLOW_SEND", "MAIL_IMAP_HOST", "MAIL_SMTP_HOST",
  "MAIL2_EMAIL", "MAIL2_PASSWORD", "MAIL2_DISPLAY_NAME", "MAIL2_ALLOW_SEND", "MAIL2_IMAP_HOST", "MAIL2_SMTP_HOST",
  "MAIL_AUTODETECT_ONLINE",
];

async function call(extraEnv, tool = "mail_list_accounts", args = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const k of ALL_KEYS) if (!(k in extraEnv)) delete env[k];
  const p = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env });
  let buf = "";
  const seen = [];
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (l) try { seen.push(JSON.parse(l)); } catch {}
    }
  });
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  await wait(700);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
  for (let t = 0; t < 50 && !seen.some((m) => m.id === 2); t++) await wait(100);
  p.kill();
  const text = seen.find((m) => m.id === 2)?.result?.content?.[0]?.text ?? "(keine Antwort)";
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { text, json };
}

// Leere optionale Felder so, wie Claude Desktop sie liefert.
const leer = {
  MAIL_DISPLAY_NAME: P("display_name"), MAIL_ALLOW_SEND: P("allow_send"),
  MAIL_IMAP_HOST: P("imap_host"), MAIL_SMTP_HOST: P("smtp_host"),
  MAIL2_EMAIL: P("email_2"), MAIL2_PASSWORD: P("password_2"), MAIL2_DISPLAY_NAME: P("display_name_2"),
  MAIL2_ALLOW_SEND: P("allow_send_2"), MAIL2_IMAP_HOST: P("imap_host_2"), MAIL2_SMTP_HOST: P("smtp_host_2"),
  MAIL_AUTODETECT_ONLINE: P("autodetect_online"),
};
const eins = { ...leer, MAIL_EMAIL: "anna.beispiel@web.de", MAIL_PASSWORD: "platzhalter" };
const zwei = { ...eins, MAIL2_EMAIL: "kunde@gmx.de", MAIL2_PASSWORD: "platzhalter2" };
const senden = { to: ["a@b.de"], subject: "s", text: "t" };

const faelle = [
  // --- ein Postfach ---
  ["Nur Pflichtfelder, Rest leer", eins, "mail_list_accounts", {},
    (r) => r.json?.length === 1 && r.json[0].imap.startsWith("imap.web.de:993") && r.json[0].smtp.startsWith("smtp.web.de:465")],
  ["Server von Hand gesetzt", { ...eins, MAIL_IMAP_HOST: "imap.example.net", MAIL_SMTP_HOST: "smtp.example.net" }, "mail_list_accounts", {},
    (r) => r.json?.[0].imap.startsWith("imap.example.net") && r.json?.[0].smtp.startsWith("smtp.example.net")],
  ["Absendername gesetzt", { ...eins, MAIL_DISPLAY_NAME: "Anna Beispiel" }, "mail_list_accounts", {},
    (r) => r.json?.[0].displayName === "Anna Beispiel"],
  ["Absendername leer bleibt leer", eins, "mail_list_accounts", {},
    (r) => r.json?.[0].displayName === undefined],
  ["Senden ohne Freigabe gesperrt", eins, "mail_send", senden,
    (r) => r.text.includes("deaktiviert")],
  ["Senden mit Freigabe versucht es", { ...eins, MAIL_ALLOW_SEND: "true", MAIL_SMTP_HOST: "smtp.invalid.test" }, "mail_send", senden,
    (r) => r.text.includes("ENOTFOUND smtp.invalid.test")],
  ["Unsinniger Hostname abgelehnt", { ...eins, MAIL_IMAP_HOST: "https://imap.foo.de:993/pfad" }, "mail_list_accounts", {},
    (r) => r.text.includes("kein gültiger IMAP-Servername")],

  // --- zwei Postfächer ---
  ["Zwei Postfächer, beide erkannt", zwei, "mail_list_accounts", {},
    (r) => r.json?.length === 2 && r.json[0].imap.startsWith("imap.web.de") && r.json[1].imap.startsWith("imap.gmx.net")],
  ["Namen sind die Adressen", zwei, "mail_list_accounts", {},
    (r) => r.json?.[0].name === "anna.beispiel@web.de" && r.json?.[1].name === "kunde@gmx.de"],
  ["Senden je Postfach getrennt", { ...zwei, MAIL2_ALLOW_SEND: "true" }, "mail_list_accounts", {},
    (r) => r.json?.[0].sendenErlaubt === false && r.json?.[1].sendenErlaubt === true],
  ["Ohne account-Angabe: Rückfrage", zwei, "mail_test_connection", {},
    (r) => r.text.includes("Mehrere Accounts") && r.text.includes("kunde@gmx.de")],
  ["Senden gesperrt gilt fürs richtige Postfach", { ...zwei, MAIL2_ALLOW_SEND: "true" }, "mail_send", { ...senden, account: "anna.beispiel@web.de" },
    (r) => r.text.includes("deaktiviert") && r.text.includes("anna.beispiel@web.de")],
  ["Zweite Adresse ohne Passwort", { ...eins, MAIL2_EMAIL: "kunde@gmx.de" }, "mail_list_accounts", {},
    (r) => r.text.includes("zweite Postfach fehlt das Passwort")],
  ["Dieselbe Adresse zweimal", { ...eins, MAIL2_EMAIL: "anna.beispiel@web.de", MAIL2_PASSWORD: "x" }, "mail_list_accounts", {},
    (r) => r.text.includes("doppelt")],
  ["Nur zweites Postfach ausgefüllt", { ...leer, MAIL2_EMAIL: "kunde@gmx.de", MAIL2_PASSWORD: "x" }, "mail_list_accounts", {},
    (r) => r.json?.length === 1 && r.json[0].email === "kunde@gmx.de"],
];

let fehler = 0;
for (const [name, env, tool, args, erwartung] of faelle) {
  const r = await call(env, tool, args);
  const ok = Boolean(erwartung(r));
  if (!ok) fehler++;
  const detail = r.json && Array.isArray(r.json)
    ? r.json.map((a) => `${a.email}: ${a.imap.split(" ")[0]} senden=${a.sendenErlaubt}`).join(" | ")
    : r.text.split("\n")[0].replace(/^Fehler: /, "").slice(0, 110);
  console.log(`${ok ? "OK  " : "FEHL"}  ${name.padEnd(44)} ${detail}`);
}
console.log(fehler === 0 ? `\nAlle ${faelle.length} Fälle wie erwartet.` : `\n${fehler} von ${faelle.length} Fällen weichen ab.`);
process.exit(fehler === 0 ? 0 : 1);
