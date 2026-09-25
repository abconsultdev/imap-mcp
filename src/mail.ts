import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import type { ImapFlow, FetchMessageObject } from "imapflow";
import type { Account } from "./config.js";
import { withImap } from "./imap.js";

export function formatAddresses(value: unknown): string {
  if (!value) return "";
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((entry: any) => {
      if (!entry) return [];
      if (entry.value) return (entry as AddressObject).value.map((v) => (v.name ? `${v.name} <${v.address}>` : v.address ?? ""));
      if (entry.address) return [entry.name ? `${entry.name} <${entry.address}>` : entry.address];
      return [String(entry)];
    })
    .filter(Boolean)
    .join(", ");
}

export interface MessageSummary {
  uid: number;
  date: string | null;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  flags: string[];
  seen: boolean;
  size?: number;
  messageId?: string;
  hasAttachments: boolean;
}

export function summarize(msg: FetchMessageObject): MessageSummary {
  const env = msg.envelope;
  const flags = msg.flags ? [...msg.flags] : [];
  const struct: any = (msg as any).bodyStructure;
  return {
    uid: msg.uid,
    date: env?.date ? new Date(env.date).toISOString() : null,
    from: formatAddresses(env?.from),
    to: formatAddresses(env?.to),
    cc: env?.cc?.length ? formatAddresses(env.cc) : undefined,
    subject: env?.subject ?? "(kein Betreff)",
    flags,
    seen: flags.includes("\Seen"),
    size: msg.size,
    messageId: env?.messageId,
    hasAttachments: hasAttachment(struct),
  };
}

function hasAttachment(node: any): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(hasAttachment);
  return false;
}

export interface SearchCriteria {
  mailbox: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  text?: string;
  since?: string;
  before?: string;
  unseen?: boolean;
  seen?: boolean;
  flagged?: boolean;
  limit: number;
}

function parseDate(value: string, label: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`"${label}" ist kein gültiges Datum: ${value}`);
  return d;
}

export async function searchMessages(account: Account, c: SearchCriteria) {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(c.mailbox, { readOnly: true });
    try {
      const query: Record<string, unknown> = {};
      if (c.from) query.from = c.from;
      if (c.to) query.to = c.to;
      if (c.subject) query.subject = c.subject;
      if (c.body) query.body = c.body;
      if (c.text) query.text = c.text;
      if (c.since) query.since = parseDate(c.since, "since");
      if (c.before) query.before = parseDate(c.before, "before");
      if (c.unseen) query.seen = false;
      if (c.seen) query.seen = true;
      if (c.flagged) query.flagged = true;

      const fields = { uid: true, envelope: true, flags: true, size: true, bodyStructure: true } as const;
      const out: MessageSummary[] = [];

      // Ohne Filter ("die letzten 10 Mails") braucht es keine Suche: die
      // neuesten Nachrichten tragen die höchsten Sequenznummern. Das ist
      // schneller und unabhängig davon, wie ein Server SEARCH beantwortet.
      if (Object.keys(query).length === 0) {
        const exists = client.mailbox ? client.mailbox.exists : 0;
        if (exists === 0) return { total: 0, messages: out };
        const first = Math.max(1, exists - c.limit + 1);
        for await (const msg of client.fetch(`${first}:${exists}`, fields)) out.push(summarize(msg));
        out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        return { total: exists, messages: out };
      }

      const uids = (await client.search(query, { uid: true })) || [];
      const total = uids.length;
      const selected = uids.slice(-c.limit).reverse();
      if (selected.length === 0) return { total, messages: out };

      for await (const msg of client.fetch(selected, fields, { uid: true })) out.push(summarize(msg));
      out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { total, messages: out };
    } finally {
      lock.release();
    }
  });
}

async function fetchSource(client: ImapFlow, uid: number): Promise<Buffer> {
  for await (const msg of client.fetch(String(uid), { uid: true, source: true }, { uid: true })) {
    if (msg.source) return msg.source;
  }
  throw new Error(`Nachricht mit UID ${uid} nicht gefunden.`);
}

export async function fetchParsed(account: Account, mailbox: string, uid: number, markSeen: boolean): Promise<ParsedMail> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: !markSeen });
    try {
      const source = await fetchSource(client, uid);
      if (markSeen) await client.messageFlagsAdd(String(uid), ["\Seen"], { uid: true });
      return await simpleParser(source);
    } finally {
      lock.release();
    }
  });
}

export async function fetchRawSource(account: Account, mailbox: string, uid: number): Promise<Buffer> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      return await fetchSource(client, uid);
    } finally {
      lock.release();
    }
  });
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
