/**
 * Live-Test gegen ein echtes Postfach - rein lesend, ändert nichts.
 *
 *   npm run build && node test/live.mjs
 *
 * Nimmt den ersten Account aus config.json. Ohne config.json wird der Test
 * übersprungen. Vergleicht, was der Server laut STATUS enthält, mit dem, was
 * die Suche des MCP-Servers findet - genau die Lücke, durch die der
 * Strato-/IMAP4rev2-Fehler gerutscht ist (Verbindung ok, Ordner ok, 0 Treffer).
 */
import { existsSync } from "node:fs";
import { getAccount } from "../dist/config.js";
import { withImap, closeAllImap } from "../dist/imap.js";
import { searchMessages } from "../dist/mail.js";

if (!existsSync(new URL("../config.json", import.meta.url))) {
  console.log("Übersprungen: keine config.json vorhanden.");
  process.exit(0);
}

let fehler = 0;
const pruefe = (name, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FEHL"}  ${name}${detail ? "  -> " + detail : ""}`);
  if (!ok) fehler++;
};

const acc = await getAccount();
console.log(`Postfach: ${acc.email} (${acc.imap.host})\n`);

const status = await withImap(acc, (c) => c.status("INBOX", { messages: true, unseen: true }));
console.log(`Laut Server: ${status.messages} Mails im Posteingang, ${status.unseen} ungelesen\n`);

const neueste = await searchMessages(acc, { mailbox: "INBOX", limit: 10 });
pruefe(
  "Neueste 10 ohne Filter",
  neueste.messages.length === Math.min(10, status.messages),
  `${neueste.messages.length} von ${Math.min(10, status.messages)}`
);
pruefe(
  "Neueste zuerst sortiert",
  neueste.messages.every((m, i, a) => i === 0 || (a[i - 1].date ?? "") >= (m.date ?? ""))
);

const ungelesen = await searchMessages(acc, { mailbox: "INBOX", unseen: true, limit: 5 });
pruefe("Suche nach ungelesenen (SEARCH)", ungelesen.total === status.unseen, `${ungelesen.total} von ${status.unseen}`);

const seit = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const datum = await searchMessages(acc, { mailbox: "INBOX", since: "1970-01-01", limit: 1 });
pruefe("Datumssuche findet alles seit 1970", datum.total === status.messages, `${datum.total} von ${status.messages}`);

const jahr = await searchMessages(acc, { mailbox: "INBOX", since: seit, limit: 1 });
pruefe("Datumssuche letztes Jahr plausibel", jahr.total > 0 && jahr.total <= status.messages, `${jahr.total}`);

await closeAllImap();
console.log(fehler === 0 ? "\nSuche funktioniert gegen dieses Postfach." : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
