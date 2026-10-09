/**
 * Anbieter-Erkennung.
 *
 *   npm run build && node test/detect.mjs
 *   TEST_MX_EMAIL=name@eigene-domain.de node test/detect.mjs
 *
 * Teil 1 prüft die eingebaute Liste und die MX-Muster ohne Netzwerk. Teil 2
 * fragt echte DNS- und Autoconfig-Server. Wer zusätzlich die MX-Erkennung
 * einer eigenen Domain live prüfen will, gibt sie über TEST_MX_EMAIL mit.
 */
import { detectServers, serversForMxHost } from "../dist/providers.js";

let fehler = 0;
const pruefe = (name, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FEHL"}  ${name.padEnd(46)} ${detail}`);
  if (!ok) fehler++;
};

console.log("--- Eingebaute Liste (ohne Netzwerk) ---");
for (const [mail, imap] of [
  ["name@gmail.com", "imap.gmail.com"],
  ["name@gmx.de", "imap.gmx.net"],
  ["name@web.de", "imap.web.de"],
  ["name@t-online.de", "secureimap.t-online.de"],
  ["name@posteo.de", "posteo.de"],
]) {
  const d = await detectServers(mail, false);
  pruefe(mail, d.imap.host === imap, `${d.imap.host}:${d.imap.port}  [${d.quelle}]`);
}

console.log("\n--- MX-Muster (ohne Netzwerk) ---");
for (const [mx, anbieter, imap] of [
  ["smtpin.rzone.de", "Strato", "imap.strato.de"],
  ["mx00.ionos.de", "IONOS / 1&1", "imap.ionos.de"],
  ["mxint01.1and1.com.", "IONOS / 1&1", "imap.ionos.de"],
  ["w0123456.kasserver.com", "All-Inkl", "w0123456.kasserver.com"],
  ["example-de.mail.protection.outlook.com", "Microsoft 365 / Outlook", "outlook.office365.com"],
  ["aspmx.l.google.com", "Google / Gmail", "imap.gmail.com"],
]) {
  const d = serversForMxHost(mx);
  pruefe(mx, d?.anbieter === anbieter && d?.imap.host === imap, d ? `${d.anbieter} -> ${d.imap.host}` : "nicht erkannt");
}
// Private Microsoft-Konten: erkannt, aber mit dem Hinweis, dass Passwort-Anmeldung nicht geht.
for (const mail of ["name@hotmail.com", "name@outlook.de", "name@live.com"]) {
  const d = await detectServers(mail, false);
  pruefe(`${mail} (privates Microsoft-Konto)`, d.anbieter?.includes("privates Microsoft-Konto") && d.hinweis?.includes("OAuth2"), d.anbieter ?? "nicht erkannt");
}
// Muster dürfen nicht zu großzügig sein - "strato.de" als Teil eines anderen Namens zählt nicht.
pruefe("nicht-strato.dex.example (kein Treffer)", serversForMxHost("mx.nicht-strato.dex.example") === null);
pruefe("xrzone.de (kein Treffer)", serversForMxHost("xrzone.de") === null);

console.log("\n--- Online: Autoconfig-Datenbank und Rückfall ---");
const zoho = await detectServers("name@zoho.com");
pruefe("name@zoho.com über Autoconfig", zoho.quelle.includes("Autoconfig") && zoho.imap.host === "imap.zoho.com", `${zoho.imap.host}  [${zoho.quelle}]`);
const unbekannt = await detectServers("name@nicht-existente-domain-xyz123abc.de");
pruefe("Unbekannte Domain wird geraten", unbekannt.quelle.startsWith("geraten"), unbekannt.imap.host);

if (process.env.TEST_MX_EMAIL) {
  const d = await detectServers(process.env.TEST_MX_EMAIL);
  pruefe(`${process.env.TEST_MX_EMAIL} über MX`, d.quelle.startsWith("MX-Eintrag"), `${d.anbieter ?? "?"} -> ${d.imap.host}  [${d.quelle}]`);
}

console.log(fehler === 0 ? "\nErkennung funktioniert." : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
