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
import { readFileSync } from "node:fs";

const SERVER = process.env.TEST_SERVER ?? new URL("../build/bundle/server/index.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Alles, was der Server als Konfiguration liest - im Test nur, was der Fall setzt.
const KONFIG_VARIABLE = /^(MAIL\d*_|IMAP_|SMTP_)/;

async function call(extraEnv, tool = "mail_list_accounts", args = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const k of Object.keys(env)) if (KONFIG_VARIABLE.test(k) && !(k in extraEnv)) delete env[k];
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

// Leere optionale Felder so, wie Claude Desktop sie liefert - direkt aus den
// Manifesten, damit ein neues Feld dort nicht am Test vorbeigeht.
const leerAus = (datei) => {
  const { env } = JSON.parse(readFileSync(new URL(`../${datei}`, import.meta.url), "utf8")).server.mcp_config;
  return Object.fromEntries(Object.entries(env).filter(([k]) => k !== "MAIL_EMAIL" && k !== "MAIL_PASSWORD"));
};
const leer = leerAus("manifest-10.json");
const leerStandard = leerAus("manifest.json");
const leerEinzeln = leerAus("manifest-10-einzeln.json");
const eins = { ...leer, MAIL_EMAIL: "anna.beispiel@web.de", MAIL_PASSWORD: "platzhalter" };
const zwei = { ...eins, MAIL2_EMAIL: "kunde@gmx.de", MAIL2_PASSWORD: "platzhalter2" };
const zehnAdressen = [
  "anna.beispiel@web.de", "kunde@gmx.de", "a@gmail.com", "b@t-online.de", "c@posteo.de",
  "d@mailbox.org", "e@icloud.com", "f@yahoo.com", "g@outlook.com", "h@gmx.net",
];
const zehn = { ...leer };
zehnAdressen.forEach((a, i) => {
  const p = i === 0 ? "MAIL_" : `MAIL${i + 1}_`;
  zehn[p + "EMAIL"] = a;
  zehn[p + "PASSWORD"] = `pw${i + 1}`;
});
const einsStandard = { ...leerStandard, MAIL_EMAIL: "anna.beispiel@web.de", MAIL_PASSWORD: "platzhalter" };
const zweiStandard = { ...einsStandard, MAIL2_EMAIL: "kunde@gmx.de", MAIL2_PASSWORD: "platzhalter2" };
const zehnEinzeln = { ...leerEinzeln };
zehnAdressen.forEach((a, i) => {
  const p = i === 0 ? "MAIL_" : `MAIL${i + 1}_`;
  zehnEinzeln[p + "EMAIL"] = a;
  zehnEinzeln[p + "PASSWORD"] = `pw${i + 1}`;
});
const senden = { to: ["a@b.de"], subject: "s", text: "t" };
const als = (r, i, user) => r.json?.[i].imap.endsWith(` als ${user}`) && r.json?.[i].smtp.endsWith(` als ${user}`);

const faelle = [
  // --- ein Postfach ---
  ["Nur Pflichtfelder, Rest leer", eins, "mail_list_accounts", {},
    (r) => r.json?.length === 1 && r.json[0].imap.startsWith("imap.web.de:993") && r.json[0].smtp.startsWith("smtp.web.de:465")],
  ["Server von Hand gesetzt", { ...eins, MAIL_SERVERS: "anna.beispiel@web.de = imap.example.net, smtp.example.net" }, "mail_list_accounts", {},
    (r) => r.json?.[0].imap.startsWith("imap.example.net:993") && r.json?.[0].smtp.startsWith("smtp.example.net:465")],
  ["Ein Server für beides, mit Port", { ...eins, MAIL_SERVERS: "anna.beispiel@web.de = mail.example.net:143" }, "mail_list_accounts", {},
    (r) => r.json?.[0].imap.startsWith("mail.example.net:143 (STARTTLS)") && r.json?.[0].smtp.startsWith("mail.example.net:143")],
  ["Einzelvariable geht weiter (MAIL_IMAP_HOST)", { ...eins, MAIL_IMAP_HOST: "imap.example.net", MAIL_SMTP_HOST: "smtp.example.net" }, "mail_list_accounts", {},
    (r) => r.json?.[0].imap.startsWith("imap.example.net") && r.json?.[0].smtp.startsWith("smtp.example.net")],
  ["Absendername gesetzt", { ...eins, MAIL_DISPLAY_NAMES: "anna.beispiel@web.de = Beispiel, Anna" }, "mail_list_accounts", {},
    (r) => r.json?.[0].displayName === "Beispiel, Anna"],
  ["Absendername leer bleibt leer", eins, "mail_list_accounts", {},
    (r) => r.json?.[0].displayName === undefined],
  ["Benutzername leer = Adresse", eins, "mail_list_accounts", {},
    (r) => als(r, 0, "anna.beispiel@web.de")],
  ["Eigener Benutzername für IMAP und SMTP", { ...eins, MAIL_USERNAMES: "Anna.Beispiel@web.de = m0123456" }, "mail_list_accounts", {},
    (r) => als(r, 0, "m0123456") && r.json?.[0].email === "anna.beispiel@web.de"],
  ["Senden ohne Freigabe gesperrt", eins, "mail_send", senden,
    (r) => r.text.includes("deaktiviert")],
  ["Senden mit Freigabe versucht es",
    { ...eins, MAIL_ALLOW_SEND_FOR: "anna.beispiel@web.de", MAIL_SERVERS: "anna.beispiel@web.de = imap.web.de, smtp.invalid.test" }, "mail_send", senden,
    (r) => r.text.includes("ENOTFOUND smtp.invalid.test")],
  ["Unsinniger Hostname abgelehnt", { ...eins, MAIL_SERVERS: "anna.beispiel@web.de = https://imap.foo.de/pfad" }, "mail_list_accounts", {},
    (r) => r.text.includes("kein gültiger IMAP-Servername")],

  // --- mehrere Postfächer ---
  ["Zwei Postfächer, beide erkannt", zwei, "mail_list_accounts", {},
    (r) => r.json?.length === 2 && r.json[0].imap.startsWith("imap.web.de") && r.json[1].imap.startsWith("imap.gmx.net")],
  ["Namen sind die Adressen", zwei, "mail_list_accounts", {},
    (r) => r.json?.[0].name === "anna.beispiel@web.de" && r.json?.[1].name === "kunde@gmx.de"],
  ["Senden je Postfach getrennt", { ...zwei, MAIL_ALLOW_SEND_FOR: "kunde@gmx.de" }, "mail_list_accounts", {},
    (r) => r.json?.[0].sendenErlaubt === false && r.json?.[1].sendenErlaubt === true],
  ["Ohne account-Angabe: Rückfrage", zwei, "mail_test_connection", {},
    (r) => r.text.includes("Mehrere Accounts") && r.text.includes("kunde@gmx.de")],
  ["Senden gesperrt gilt fürs richtige Postfach", { ...zwei, MAIL_ALLOW_SEND_FOR: "kunde@gmx.de" }, "mail_send", { ...senden, account: "anna.beispiel@web.de" },
    (r) => r.text.includes("deaktiviert") && r.text.includes("anna.beispiel@web.de")],
  ["Benutzername nur beim zweiten Postfach", { ...zwei, MAIL_USERNAMES: "kunde@gmx.de = kunde123" }, "mail_list_accounts", {},
    (r) => als(r, 0, "anna.beispiel@web.de") && als(r, 1, "kunde123")],
  ["Zweite Adresse ohne Passwort", { ...eins, MAIL2_EMAIL: "kunde@gmx.de" }, "mail_list_accounts", {},
    (r) => r.text.includes("Postfach 2 fehlt das Passwort")],
  ["Dieselbe Adresse zweimal", { ...eins, MAIL2_EMAIL: "anna.beispiel@web.de", MAIL2_PASSWORD: "x" }, "mail_list_accounts", {},
    (r) => r.text.includes("doppelt")],
  ["Nur zweites Postfach ausgefüllt", { ...leer, MAIL2_EMAIL: "kunde@gmx.de", MAIL2_PASSWORD: "x" }, "mail_list_accounts", {},
    (r) => r.json?.length === 1 && r.json[0].email === "kunde@gmx.de"],

  // --- zehn Postfächer und Sammelfelder ---
  ["Zehn Postfächer, alle erkannt", zehn, "mail_list_accounts", {},
    (r) => r.json?.length === 10 && r.json.every((a, i) => a.email === zehnAdressen[i])
      && r.json[9].imap.startsWith("imap.gmx.net") && r.json[2].imap.startsWith("imap.gmail.com")],
  ["Zehn Postfächer: Senden nur für zwei", { ...zehn, MAIL_ALLOW_SEND_FOR: "d@mailbox.org, H@gmx.net" }, "mail_list_accounts", {},
    (r) => r.json?.filter((a) => a.sendenErlaubt).map((a) => a.email).join() === "d@mailbox.org,h@gmx.net"],
  ["Senden für alle", { ...zehn, MAIL_ALLOW_SEND_FOR: "alle" }, "mail_list_accounts", {},
    (r) => r.json?.length === 10 && r.json.every((a) => a.sendenErlaubt)],
  ["Sammelfelder für Postfach 7 bis 10",
    { ...zehn, MAIL_DISPLAY_NAMES: "e@icloud.com = E; h@gmx.net = H", MAIL_USERNAMES: "g@outlook.com = gee" }, "mail_list_accounts", {},
    (r) => r.json?.[6].displayName === "E" && r.json?.[9].displayName === "H" && als(r, 8, "gee") && als(r, 7, "f@yahoo.com")],
  ["Postfach 7 ohne Passwort", { ...eins, MAIL7_EMAIL: "e@icloud.com" }, "mail_list_accounts", {},
    (r) => r.text.includes("Postfach 7 fehlt das Passwort (MAIL7_PASSWORD)")],
  ["Nur Postfach 10 ausgefüllt", { ...leer, MAIL10_EMAIL: "h@gmx.net", MAIL10_PASSWORD: "x" }, "mail_list_accounts", {},
    (r) => r.json?.length === 1 && r.json[0].email === "h@gmx.net"],
  ["Tippfehler: unbekannte Adresse", { ...zwei, MAIL_ALLOW_SEND_FOR: "kunde@gmx.dee" }, "mail_list_accounts", {},
    (r) => r.text.includes("Senden erlauben für") && r.text.includes("kunde@gmx.dee") && r.text.includes("Tippfehler")],
  ["Tippfehler: Eintrag ohne =", { ...zwei, MAIL_DISPLAY_NAMES: "kunde@gmx.de Kunde" }, "mail_list_accounts", {},
    (r) => r.text.includes("Absendernamen") && r.text.includes("nicht lesbar")],
  ["Tippfehler: Name statt Adresse", { ...zwei, MAIL_ALLOW_SEND_FOR: "Kunde" }, "mail_list_accounts", {},
    (r) => r.text.includes("„Kunde“ keine E-Mail-Adresse")],

  // --- Standard-Bundle (manifest.json): alles je Postfach, höchstens zwei ---
  ["Standard: nur Pflichtfelder", einsStandard, "mail_list_accounts", {},
    (r) => r.json?.length === 1 && r.json[0].imap.startsWith("imap.web.de:993") && r.json[0].sendenErlaubt === false],
  ["Standard: zwei Postfächer", zweiStandard, "mail_list_accounts", {},
    (r) => r.json?.length === 2 && r.json[1].imap.startsWith("imap.gmx.net")],
  ["Standard: Senden nur beim zweiten", { ...zweiStandard, MAIL_ALLOW_SEND: "false", MAIL2_ALLOW_SEND: "true" }, "mail_list_accounts", {},
    (r) => r.json?.[0].sendenErlaubt === false && r.json?.[1].sendenErlaubt === true],
  ["Standard: Absender- und Benutzername", { ...zweiStandard, MAIL_DISPLAY_NAME: "Anna", MAIL2_USER: "kunde123" }, "mail_list_accounts", {},
    (r) => r.json?.[0].displayName === "Anna" && als(r, 0, "anna.beispiel@web.de") && als(r, 1, "kunde123")],
  ["Standard: Server von Hand", { ...einsStandard, MAIL_IMAP_HOST: "imap.example.net", MAIL_SMTP_HOST: "smtp.example.net" }, "mail_list_accounts", {},
    (r) => r.json?.[0].imap.startsWith("imap.example.net") && r.json?.[0].smtp.startsWith("smtp.example.net")],
  ["Standard: Senden ohne Haken gesperrt", einsStandard, "mail_send", senden,
    (r) => r.text.includes("deaktiviert")],

  // --- Zehn mit Feldern je Postfach (manifest-10-einzeln.json) ---
  ["Einzeln: zehn Postfächer, alle erkannt", zehnEinzeln, "mail_list_accounts", {},
    (r) => r.json?.length === 10 && r.json.every((a, i) => a.email === zehnAdressen[i] && a.sendenErlaubt === false)],
  ["Einzeln: Senden nur bei Postfach 4 und 10", { ...zehnEinzeln, MAIL4_ALLOW_SEND: "true", MAIL10_ALLOW_SEND: "true" }, "mail_list_accounts", {},
    (r) => r.json?.filter((a) => a.sendenErlaubt).map((a) => a.email).join() === "b@t-online.de,h@gmx.net"],
  ["Einzeln: Felder von Postfach 7", { ...zehnEinzeln, MAIL7_DISPLAY_NAME: "E", MAIL7_USER: "ee", MAIL7_IMAP_HOST: "imap.example.net", MAIL7_SMTP_HOST: "smtp.example.net" }, "mail_list_accounts", {},
    (r) => r.json?.[6].displayName === "E" && als(r, 6, "ee") && r.json[6].imap.startsWith("imap.example.net") && r.json[6].smtp.startsWith("smtp.example.net") && als(r, 5, "d@mailbox.org")],
  ["Einzeln: Postfach 9 ohne Passwort", { ...leerEinzeln, MAIL_EMAIL: "anna.beispiel@web.de", MAIL_PASSWORD: "x", MAIL9_EMAIL: "g@outlook.com" }, "mail_list_accounts", {},
    (r) => r.text.includes("Postfach 9 fehlt das Passwort")],
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
