import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { htmlToText, formatAddresses, truncate, summarize } from "../dist/mail.js";
import { passwortCheck } from "../dist/config.js";

// IMAP-Flags beginnen mit einem Backslash. Im Quelltext muss er verdoppelt
// werden ("\\Seen"), sonst wird daraus stillschweigend "Seen".
const gelesen = summarize({ uid: 1, flags: new Set(["\\Seen"]), envelope: {} });
const ungelesen = summarize({ uid: 2, flags: new Set(["\\Flagged"]), envelope: {} });
if (gelesen.seen !== true || ungelesen.seen !== false) {
  console.error("FEHLER: seen wird falsch ausgewertet", gelesen.seen, ungelesen.seen);
  process.exit(1);
}
console.log("seen aus \\Seen: OK");

// Passwort-Check: beschreibt, verrät aber nichts.
const pc = passwortCheck("Ab cd‑ef​gh");
const pcEmoji = passwortCheck("Ab😀9 x");
if (pc.laenge !== 11 || pc.unsichtbareZeichen?.["geschütztes Leerzeichen"] !== 1 || pc.unsichtbareZeichen?.["Null-Breite-Leerzeichen"] !== 1
    || pcEmoji.laenge !== 6 || pcEmoji.leerzeichen !== 1 || pcEmoji.nichtAscii !== true || JSON.stringify(pc).includes("Ab")) {
  console.error("FEHLER: passwortCheck", pc, pcEmoji);
  process.exit(1);
}
console.log("passwortCheck: OK");

const raw = await new Promise((res, rej) =>
  new MailComposer({
    from: '"Test Person" <me@example.com>',
    to: ["a@example.com"],
    subject: "Betreff mit Umlaut: Grüße",
    text: "Hallo Welt",
    html: "<p>Hallo <b>Welt</b></p>",
    inReplyTo: "<orig@example.com>",
    references: "<orig@example.com>",
  }).compile().build((e, m) => (e ? rej(e) : res(m)))
);
const s = raw.toString("utf8");
console.log("MailComposer OK, bytes:", raw.length);
console.log("hat Subject:", /^Subject:/m.test(s), "| In-Reply-To:", /^In-Reply-To: <orig@example\.com>/m.test(s));
console.log("multipart/alternative:", s.includes("multipart/alternative"));

console.log("htmlToText:", JSON.stringify(htmlToText("<p>Zeile 1</p><p>Zeile&nbsp;2 &amp; mehr</p><script>x</script>")));
console.log("formatAddresses:", formatAddresses({ value: [{ name: "Anna", address: "a@b.de" }, { name: "", address: "c@d.de" }] }));
console.log("truncate:", JSON.stringify(truncate("abcdef", 3)));
