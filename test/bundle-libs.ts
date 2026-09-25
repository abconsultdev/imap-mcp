/**
 * Prüft, ob die riskanten Bibliotheken ein esbuild-Bundle überleben.
 * Wird von test/check-bundle.mjs gebündelt und ausgeführt.
 *
 * Kritisch sind dynamisch nachgeladene Teile: iconv-lite lädt Zeichensatz-
 * Tabellen zur Laufzeit nach, MailComposer und mailparser ziehen weitere
 * Module über require() herein. Bricht das, fällt es sonst erst beim ersten
 * Umlaut in einer echten Mail auf.
 */
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ImapFlow } from "imapflow";

let fehler = 0;
const pruefe = (name: string, bedingung: boolean, detail = "") => {
  console.log(`${bedingung ? "OK  " : "FEHL"}  ${name}${detail ? "  -> " + detail : ""}`);
  if (!bedingung) fehler++;
};

// 1. Zeichensatz-Umwandlung: ISO-8859-1 im Header und im Body.
const latin1 = Buffer.concat([
  Buffer.from(
    "From: =?ISO-8859-1?Q?Gr=FC=DFe_von_J=F6rg?= <joerg@example.com>\r\n" +
      "To: empfaenger@example.com\r\n" +
      "Subject: =?ISO-8859-1?Q?Stra=DFenfest_im_M=E4rz?=\r\n" +
      'Content-Type: text/plain; charset="ISO-8859-1"\r\n' +
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
    "ascii"
  ),
  // Nur Zeichen, die es in ISO-8859-1 wirklich gibt - sonst prüft der Test
  // die Zeichensatz-Umwandlung an einer Stelle, an der schon die Eingabe kaputt ist.
  Buffer.from("Schöne Grüße aus München, das kostet 5 Mark.\n", "latin1"),
]);
const parsed = await simpleParser(latin1);
pruefe("mailparser: Betreff mit Umlauten", parsed.subject === "Straßenfest im März", parsed.subject);
pruefe("mailparser: Absendername dekodiert", (parsed.from?.text ?? "").includes("Grüße von Jörg"), parsed.from?.text);
pruefe("iconv-lite: ISO-8859-1-Body", (parsed.text ?? "").includes("Schöne Grüße aus München"), JSON.stringify((parsed.text ?? "").slice(0, 40)));

// 2. Anhang aus einer mehrteiligen Nachricht.
const mitAnhang =
  "From: a@example.com\r\nTo: b@example.com\r\nSubject: Test\r\n" +
  'Content-Type: multipart/mixed; boundary="GRENZE"\r\n\r\n' +
  "--GRENZE\r\nContent-Type: text/plain\r\n\r\nText dazu\r\n" +
  "--GRENZE\r\nContent-Type: application/pdf; name=\"rechnung.pdf\"\r\n" +
  'Content-Disposition: attachment; filename="rechnung.pdf"\r\n' +
  "Content-Transfer-Encoding: base64\r\n\r\nSGFsbG8gUERG\r\n--GRENZE--\r\n";
const mehrteilig = await simpleParser(mitAnhang);
pruefe("mailparser: Anhang erkannt", mehrteilig.attachments.length === 1, mehrteilig.attachments[0]?.filename);
pruefe("mailparser: Anhangsinhalt", mehrteilig.attachments[0]?.content.toString() === "Hallo PDF");

// 3. HTML-Mail auf Text reduzieren (html-to-text-Pfad).
const htmlMail = await simpleParser(
  'From: a@example.com\r\nSubject: HTML\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n<p>Hallo <b>Welt</b></p>'
);
pruefe("mailparser: HTML-Teil vorhanden", (mehrteilig.text ?? "").includes("Text dazu") && Boolean(htmlMail.html));

// 4. Mail zusammenbauen - der Weg von mail_send und mail_create_draft.
const roh: Buffer = await new Promise((res, rej) =>
  new MailComposer({
    from: '"Anna Beispiel" <info@example.com>',
    to: ["empfaenger@example.com"],
    subject: "Grüße mit Umlaut und Anhang",
    text: "Hallo Welt — mit Gedankenstrich.",
    html: "<p>Hallo <b>Welt</b></p>",
    attachments: [{ filename: "notiz.txt", content: Buffer.from("Inhalt") }],
    inReplyTo: "<original@example.com>",
    references: "<original@example.com>",
  })
    .compile()
    .build((e: Error | null, m: Buffer) => (e ? rej(e) : res(m)))
);
const rohText = roh.toString("utf8");
pruefe("MailComposer: baut Nachricht", roh.length > 400, roh.length + " Bytes");
pruefe("MailComposer: In-Reply-To gesetzt", /^In-Reply-To: <original@example\.com>/m.test(rohText));
pruefe("MailComposer: Anhang enthalten", rohText.includes("notiz.txt"));

// Der zusammengebaute Text muss sich auch wieder lesen lassen.
const zurueck = await simpleParser(roh);
pruefe("Rundlauf: Betreff erhalten", zurueck.subject === "Grüße mit Umlaut und Anhang", zurueck.subject);
pruefe("Rundlauf: Anhang erhalten", zurueck.attachments[0]?.filename === "notiz.txt");

// 5. ImapFlow lässt sich instanziieren (kein Verbindungsaufbau).
const client = new ImapFlow({
  host: "imap.example.com",
  port: 993,
  secure: true,
  auth: { user: "a", pass: "b" },
  logger: false,
});
pruefe("ImapFlow: Instanz erzeugt", typeof client.connect === "function" && client.usable === false);

console.log(fehler === 0 ? "\nAlle Bibliotheken überstehen das Bundling." : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
