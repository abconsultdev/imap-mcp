#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { loadConfig, getAccount, fromHeader, type Account } from "./config.js";
import { withImap, listMailboxes, resolveSpecialMailbox, closeAllImap } from "./imap.js";
import { searchMessages, fetchParsed, fetchRawSource, formatAddresses, htmlToText, truncate } from "./mail.js";
import { getTransport, closeAllSmtp } from "./smtp.js";
import { detectServers, knownProviders } from "./providers.js";

const server = new McpServer({ name: "imap-mcp", version: "1.2.0" });

const accountArg = z
  .string()
  .optional()
  .describe(
    "E-Mail-Adresse (oder Name) des Postfachs. Weglassen, wenn nur eines eingerichtet ist. " +
      "Bei mehreren Pflicht - mail_list_accounts zeigt die verfügbaren. Beim Senden immer das Postfach wählen, " +
      "von dem der Nutzer absenden will, und im Zweifel nachfragen."
  );
const mailboxArg = z.string().default("INBOX").describe('IMAP-Ordner, z.B. "INBOX" oder "INBOX/Projekte".');

function ok(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: `Fehler: ${message}` }] };
}

function guardSend(account: Account): void {
  if (account.allowSend === false) {
    throw new Error(`Für Account "${account.name}" ist das Senden in der Konfiguration deaktiviert (allowSend: false).`);
  }
}

const UNSAFE_FILENAME = /[<>:"/\\|?*]|[\x00-\x1f]/g;

function safeFilename(name: string): string {
  return basename(name).replace(UNSAFE_FILENAME, "_").slice(0, 200) || "anhang";
}

// ---------------------------------------------------------------- Accounts

server.registerTool(
  "mail_list_accounts",
  {
    title: "Mail-Accounts auflisten",
    description:
      "Listet die konfigurierten Mail-Accounts mit Servern und Sende-Berechtigung auf. Passwörter werden nie ausgegeben.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const cfg = await loadConfig();
      return ok(
        cfg.accounts.map((a) => ({
          name: a.name,
          email: a.email,
          displayName: a.displayName,
          imap: `${a.imap.host}:${a.imap.port} (${a.imap.secure ? "TLS" : "STARTTLS"}) als ${a.imap.user}`,
          smtp: `${a.smtp.host}:${a.smtp.port} (${a.smtp.secure ? "TLS" : "STARTTLS"}) als ${a.smtp.user}`,
          sendenErlaubt: a.allowSend !== false,
          serverErkannt: a.erkennung
            ? { anbieter: a.erkennung.anbieter, quelle: a.erkennung.quelle, hinweis: a.erkennung.hinweis }
            : undefined,
        }))
      );
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_test_connection",
  {
    title: "Verbindung testen",
    description: "Prüft IMAP-Login und SMTP-Login eines Accounts und meldet beide Ergebnisse einzeln.",
    inputSchema: { account: accountArg },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ account }) => {
    try {
      const acc = await getAccount(account);
      const result: Record<string, unknown> = {
        account: acc.name,
        adresse: acc.email,
        benutzer: acc.imap.user === acc.smtp.user ? acc.imap.user : { imap: acc.imap.user, smtp: acc.smtp.user },
        imapServer: `${acc.imap.host}:${acc.imap.port}`,
        smtpServer: `${acc.smtp.host}:${acc.smtp.port}`,
      };
      if (acc.erkennung) {
        result.serverErkanntVia = acc.erkennung.quelle;
        if (acc.erkennung.anbieter) result.anbieter = acc.erkennung.anbieter;
        if (acc.erkennung.hinweis) result.hinweisZumAnbieter = acc.erkennung.hinweis;
      }
      try {
        const boxes = await listMailboxes(acc);
        result.imap = `OK - ${boxes.length} Ordner sichtbar`;
      } catch (err) {
        result.imap = `FEHLER - ${(err as Error).message}`;
      }
      try {
        await getTransport(acc).verify();
        result.smtp = acc.allowSend === false ? "OK - aber Senden ist deaktiviert" : "OK";
      } catch (err) {
        result.smtp = `FEHLER - ${(err as Error).message}`;
      }
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_detect_provider",
  {
    title: "Mail-Server einer Adresse ermitteln",
    description:
      "Ermittelt zu einer beliebigen E-Mail-Adresse die passenden IMAP- und SMTP-Einstellungen, ohne sich anzumelden. " +
      "Nützlich, wenn jemand seinen Anbieter nicht kennt oder die automatische Erkennung danebenlag. " +
      "Es wird kein Passwort benötigt und keine Verbindung zum Postfach aufgebaut.",
    inputSchema: {
      email: z.string().describe("E-Mail-Adresse, z.B. name@example.com"),
      online: z
        .boolean()
        .default(true)
        .describe(
          "MX-Eintrag und Thunderbird-Autoconfig mitbenutzen. Dabei wird die Domain (nicht die Adresse) abgefragt. false = nur eingebaute Liste."
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ email, online }) => {
    try {
      const d = await detectServers(email, online);
      return ok({
        anbieter: d.anbieter ?? "unbekannt",
        quelle: d.quelle,
        imap: `${d.imap.host}:${d.imap.port} (${d.imap.secure ? "SSL/TLS" : "STARTTLS"})`,
        smtp: `${d.smtp.host}:${d.smtp.port} (${d.smtp.secure ? "SSL/TLS" : "STARTTLS"})`,
        benutzername: email,
        hinweis: d.hinweis,
        bekannteAnbieter: knownProviders(),
      });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_list_mailboxes",
  {
    title: "Ordner auflisten",
    description: "Listet alle IMAP-Ordner eines Accounts inkl. Sonderrollen (Gesendet, Entwürfe, Papierkorb, Spam).",
    inputSchema: { account: accountArg },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ account }) => {
    try {
      const acc = await getAccount(account);
      const boxes = await listMailboxes(acc);
      const sonderordner = {
        gesendet: await resolveSpecialMailbox(acc, "sent"),
        entwuerfe: await resolveSpecialMailbox(acc, "drafts"),
        papierkorb: await resolveSpecialMailbox(acc, "trash"),
        spam: await resolveSpecialMailbox(acc, "junk"),
      };
      return ok({ sonderordner, ordner: boxes });
    } catch (err) {
      return fail(err);
    }
  }
);

// ---------------------------------------------------------------- Lesen

server.registerTool(
  "mail_search",
  {
    title: "Mails suchen",
    description:
      "Durchsucht einen IMAP-Ordner und gibt Kopfdaten (UID, Datum, Absender, Betreff, Flags) der neuesten Treffer zurück. " +
      "Ohne Filter kommen die neuesten Nachrichten des Ordners. Die UIDs aus dem Ergebnis sind die Eingabe für mail_read.",
    inputSchema: {
      account: accountArg,
      mailbox: mailboxArg,
      from: z.string().optional().describe("Teilstring im Absender."),
      to: z.string().optional().describe("Teilstring im Empfänger."),
      subject: z.string().optional().describe("Teilstring im Betreff."),
      body: z.string().optional().describe("Teilstring im Nachrichtentext."),
      text: z.string().optional().describe("Teilstring in Kopfzeilen ODER Text."),
      since: z.string().optional().describe("Nur Mails ab diesem Datum, z.B. 2026-09-01."),
      before: z.string().optional().describe("Nur Mails vor diesem Datum."),
      unseen: z.boolean().optional().describe("Nur ungelesene Mails."),
      seen: z.boolean().optional().describe("Nur gelesene Mails."),
      flagged: z.boolean().optional().describe("Nur markierte Mails."),
      limit: z.number().int().min(1).max(200).default(25).describe("Maximale Trefferzahl (neueste zuerst)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      const acc = await getAccount(args.account);
      const { total, messages } = await searchMessages(acc, args);
      return ok({ ordner: args.mailbox, treffer: total, angezeigt: messages.length, nachrichten: messages });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_read",
  {
    title: "Mail lesen",
    description:
      "Liest eine Nachricht per UID vollständig: Kopfzeilen, Text und Liste der Anhänge. " +
      "HTML-Mails werden auf Text reduziert, sofern kein Textteil vorhanden ist.",
    inputSchema: {
      account: accountArg,
      mailbox: mailboxArg,
      uid: z.number().int().positive().describe("UID der Nachricht aus mail_search."),
      maxChars: z.number().int().min(200).max(200000).default(20000).describe("Maximale Zeichenzahl des Textkörpers."),
      includeHtml: z.boolean().default(false).describe("Zusätzlich das rohe HTML mitliefern."),
      markSeen: z.boolean().default(false).describe("Nachricht dabei als gelesen markieren."),
    },
    annotations: { openWorldHint: true },
  },
  async ({ account, mailbox, uid, maxChars, includeHtml, markSeen }) => {
    try {
      const acc = await getAccount(account);
      const mail = await fetchParsed(acc, mailbox, uid, markSeen);
      const raw = mail.text ?? (mail.html ? htmlToText(mail.html) : "");
      const { text, truncated } = truncate(raw, maxChars);
      return ok({
        uid,
        ordner: mailbox,
        datum: mail.date?.toISOString() ?? null,
        von: formatAddresses(mail.from),
        an: formatAddresses(mail.to),
        cc: formatAddresses(mail.cc) || undefined,
        antwortAn: formatAddresses(mail.replyTo) || undefined,
        betreff: mail.subject ?? "(kein Betreff)",
        messageId: mail.messageId,
        inReplyTo: mail.inReplyTo,
        text,
        textGekuerzt: truncated,
        html: includeHtml ? mail.html || undefined : undefined,
        anhaenge: mail.attachments.map((a, i) => ({
          index: i,
          filename: a.filename ?? `anhang-${i}`,
          contentType: a.contentType,
          size: a.size,
        })),
      });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_get_raw",
  {
    title: "Rohe Mail-Quelle",
    description:
      "Gibt die vollständige RFC822-Quelle einer Nachricht zurück - nützlich zur Analyse von Kopfzeilen, SPF/DKIM oder Weiterleitungen.",
    inputSchema: {
      account: accountArg,
      mailbox: mailboxArg,
      uid: z.number().int().positive(),
      maxChars: z.number().int().min(500).max(500000).default(50000),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ account, mailbox, uid, maxChars }) => {
    try {
      const acc = await getAccount(account);
      const source = await fetchRawSource(acc, mailbox, uid);
      const { text, truncated } = truncate(source.toString("utf8"), maxChars);
      return ok(truncated ? `${text}\n\n[... gekürzt, Original ${source.length} Bytes]` : text);
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_save_attachment",
  {
    title: "Anhang speichern",
    description:
      "Speichert einen Anhang einer Nachricht auf der Festplatte. Zielordner ist standardmäßig der downloadDir aus der Konfiguration.",
    inputSchema: {
      account: accountArg,
      mailbox: mailboxArg,
      uid: z.number().int().positive(),
      index: z.number().int().min(0).optional().describe("Index des Anhangs aus mail_read. Weglassen = alle Anhänge."),
      targetDir: z.string().optional().describe("Zielordner (absoluter Pfad). Default: downloadDir der Konfiguration."),
    },
    annotations: { openWorldHint: true },
  },
  async ({ account, mailbox, uid, index, targetDir }) => {
    try {
      const acc = await getAccount(account);
      const cfg = await loadConfig();
      const dir = resolve(targetDir ?? cfg.downloadDir!);
      const mail = await fetchParsed(acc, mailbox, uid, false);
      if (mail.attachments.length === 0) return ok(`Nachricht UID ${uid} hat keine Anhänge.`);
      const chosen =
        index === undefined
          ? mail.attachments.map((a, i) => ({ a, i }))
          : [{ a: mail.attachments[index], i: index }];
      if (chosen.some((c) => !c.a)) throw new Error(`Anhang mit Index ${index} existiert nicht.`);
      await mkdir(dir, { recursive: true });
      const gespeichert: string[] = [];
      for (const { a, i } of chosen) {
        const target = join(dir, safeFilename(a.filename ?? `uid${uid}-anhang-${i}`));
        await writeFile(target, a.content);
        gespeichert.push(target);
      }
      return ok({ gespeichert });
    } catch (err) {
      return fail(err);
    }
  }
);

// ---------------------------------------------------------------- Verwalten

server.registerTool(
  "mail_set_flags",
  {
    title: "Flags setzen",
    description:
      'Setzt oder entfernt IMAP-Flags. Gängige Werte: "\\Seen" (gelesen), "\\Flagged" (markiert), "\\Answered" (beantwortet).',
    inputSchema: {
      account: accountArg,
      mailbox: mailboxArg,
      uids: z.array(z.number().int().positive()).min(1).describe("UIDs der betroffenen Nachrichten."),
      add: z.array(z.string()).optional().describe('Flags zum Setzen, z.B. ["\\Seen"].'),
      remove: z.array(z.string()).optional().describe("Flags zum Entfernen."),
    },
    annotations: { openWorldHint: true },
  },
  async ({ account, mailbox, uids, add, remove }) => {
    try {
      if (!add?.length && !remove?.length) throw new Error('Mindestens "add" oder "remove" angeben.');
      const acc = await getAccount(account);
      const range = uids.join(",");
      await withImap(acc, async (client) => {
        const lock = await client.getMailboxLock(mailbox);
        try {
          if (add?.length) await client.messageFlagsAdd(range, add, { uid: true });
          if (remove?.length) await client.messageFlagsRemove(range, remove, { uid: true });
        } finally {
          lock.release();
        }
      });
      return ok({ ordner: mailbox, uids, gesetzt: add ?? [], entfernt: remove ?? [] });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_move",
  {
    title: "Mails verschieben",
    description: "Verschiebt Nachrichten in einen anderen IMAP-Ordner des gleichen Accounts.",
    inputSchema: {
      account: accountArg,
      mailbox: mailboxArg,
      uids: z.array(z.number().int().positive()).min(1),
      targetMailbox: z.string().describe('Zielordner, z.B. "Archiv".'),
    },
    annotations: { openWorldHint: true },
  },
  async ({ account, mailbox, uids, targetMailbox }) => {
    try {
      const acc = await getAccount(account);
      await withImap(acc, async (client) => {
        const lock = await client.getMailboxLock(mailbox);
        try {
          await client.messageMove(uids.join(","), targetMailbox, { uid: true });
        } finally {
          lock.release();
        }
      });
      return ok({ verschoben: uids.length, von: mailbox, nach: targetMailbox });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_move_to_trash",
  {
    title: "In den Papierkorb",
    description:
      "Verschiebt Nachrichten in den Papierkorb. Löscht nie endgültig - zum endgültigen Entfernen den Papierkorb im Mailprogramm leeren.",
    inputSchema: {
      account: accountArg,
      mailbox: mailboxArg,
      uids: z.array(z.number().int().positive()).min(1),
    },
    annotations: { openWorldHint: true },
  },
  async ({ account, mailbox, uids }) => {
    try {
      const acc = await getAccount(account);
      const trash = await resolveSpecialMailbox(acc, "trash");
      if (!trash) throw new Error("Papierkorb nicht gefunden. Bitte in der Konfiguration unter mailboxes.trash setzen.");
      if (trash === mailbox) throw new Error("Die Nachrichten liegen bereits im Papierkorb.");
      await withImap(acc, async (client) => {
        const lock = await client.getMailboxLock(mailbox);
        try {
          await client.messageMove(uids.join(","), trash, { uid: true });
        } finally {
          lock.release();
        }
      });
      return ok({ inPapierkorb: uids.length, ordner: trash });
    } catch (err) {
      return fail(err);
    }
  }
);

// ---------------------------------------------------------------- Senden

const attachmentSchema = z.object({
  filename: z.string().describe("Dateiname im Anhang."),
  path: z.string().optional().describe("Absoluter Pfad zu einer lokalen Datei."),
  contentBase64: z.string().optional().describe("Alternativ: Inhalt als Base64."),
  contentType: z.string().optional(),
});

const composeShape = {
  account: accountArg,
  to: z.array(z.string()).min(1).describe("Empfänger-Adressen."),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().describe("Betreff."),
  text: z.string().optional().describe("Nachricht als reiner Text."),
  html: z.string().optional().describe("Nachricht als HTML. Ohne text wird daraus eine Textversion erzeugt."),
  replyTo: z.string().optional().describe("Abweichende Antwortadresse."),
  attachments: z.array(attachmentSchema).optional(),
  inReplyToUid: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("UID der Nachricht, auf die geantwortet wird - setzt In-Reply-To/References für korrektes Threading."),
  inReplyToMailbox: z.string().default("INBOX").describe("Ordner der Nachricht aus inReplyToUid."),
};

interface ComposeArgs {
  account?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: Array<z.infer<typeof attachmentSchema>>;
  inReplyToUid?: number;
  inReplyToMailbox: string;
}

async function buildMailOptions(acc: Account, a: ComposeArgs) {
  if (!a.text && !a.html) throw new Error('Mindestens "text" oder "html" angeben.');

  const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
  for (const att of a.attachments ?? []) {
    if (att.path) {
      attachments.push({ filename: att.filename, content: await readFile(resolve(att.path)), contentType: att.contentType });
    } else if (att.contentBase64) {
      attachments.push({
        filename: att.filename,
        content: Buffer.from(att.contentBase64, "base64"),
        contentType: att.contentType,
      });
    } else {
      throw new Error(`Anhang "${att.filename}": entweder "path" oder "contentBase64" angeben.`);
    }
  }

  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (a.inReplyToUid) {
    const original = await fetchParsed(acc, a.inReplyToMailbox, a.inReplyToUid, false);
    inReplyTo = original.messageId ?? undefined;
    const prior = Array.isArray(original.references)
      ? original.references
      : original.references
        ? [original.references]
        : [];
    references = [...prior, original.messageId].filter(Boolean).join(" ") || undefined;
  }

  return {
    from: fromHeader(acc),
    to: a.to,
    cc: a.cc,
    bcc: a.bcc,
    subject: a.subject,
    text: a.text ?? (a.html ? htmlToText(a.html) : undefined),
    html: a.html,
    replyTo: a.replyTo,
    attachments: attachments.length ? attachments : undefined,
    inReplyTo,
    references,
  };
}

async function appendToMailbox(
  acc: Account,
  role: "sent" | "drafts",
  options: Record<string, unknown>,
  flags: string[]
): Promise<string | null> {
  const box = await resolveSpecialMailbox(acc, role);
  if (!box) return null;
  const raw: Buffer = await new Promise((res, rej) =>
    new MailComposer(options)
      .compile()
      .build((err: Error | null, msg: Buffer) => (err ? rej(err) : res(msg)))
  );
  await withImap(acc, (client) => client.append(box, raw, flags, new Date()));
  return box;
}

server.registerTool(
  "mail_send",
  {
    title: "Mail senden",
    description:
      "Versendet eine E-Mail über SMTP und legt sie im Gesendet-Ordner ab. Der Versand ist endgültig und nicht widerrufbar - " +
      "vor dem Aufruf immer Empfänger, Betreff und Text vom Nutzer bestätigen lassen.",
    inputSchema: composeShape,
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      const acc = await getAccount(args.account);
      guardSend(acc);
      const options = await buildMailOptions(acc, args as ComposeArgs);
      const info = await getTransport(acc).sendMail(options);
      let kopieAbgelegtIn: string | null = null;
      try {
        kopieAbgelegtIn = await appendToMailbox(acc, "sent", { ...options, messageId: info.messageId }, ["\\Seen"]);
      } catch {
        kopieAbgelegtIn = null;
      }
      return ok({
        status: "gesendet",
        messageId: info.messageId,
        angenommen: info.accepted,
        abgelehnt: info.rejected,
        kopieAbgelegtIn: kopieAbgelegtIn ?? "nicht abgelegt (Gesendet-Ordner nicht gefunden)",
      });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "mail_create_draft",
  {
    title: "Entwurf anlegen",
    description:
      "Erstellt eine E-Mail und legt sie als Entwurf im IMAP-Postfach ab, ohne sie zu versenden. " +
      "Der sichere Weg, wenn der Nutzer die Mail vorher im eigenen Mailprogramm prüfen will.",
    inputSchema: composeShape,
    annotations: { openWorldHint: true },
  },
  async (args) => {
    try {
      const acc = await getAccount(args.account);
      const options = await buildMailOptions(acc, args as ComposeArgs);
      const box = await appendToMailbox(acc, "drafts", options, ["\\Draft"]);
      if (!box) throw new Error("Entwürfe-Ordner nicht gefunden. Bitte in der Konfiguration unter mailboxes.drafts setzen.");
      return ok({ status: "Entwurf abgelegt", ordner: box, betreff: options.subject, an: options.to });
    } catch (err) {
      return fail(err);
    }
  }
);

// ---------------------------------------------------------------- Start

async function shutdown(): Promise<void> {
  closeAllSmtp();
  await closeAllImap().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
