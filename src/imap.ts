import { ImapFlow, type ListResponse } from "imapflow";
import type { Account } from "./config.js";

type Pooled = { client: ImapFlow; timer: NodeJS.Timeout };

const pool = new Map<string, Pooled>();
const IDLE_MS = 5 * 60 * 1000;

function makeClient(account: Account): ImapFlow {
  return new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: { user: account.imap.user, pass: account.imap.pass },
    tls: account.imap.allowInvalidCert ? { rejectUnauthorized: false } : undefined,
    // IMAP4rev2 bleibt aus, solange es nicht ausdrücklich eingeschaltet wird:
    // Strato kündigt rev2 an, beantwortet unter rev2 aber jedes UID SEARCH mit
    // einem leeren "* ESEARCH (TAG ..) UID" - jede Suche liefert 0 Treffer,
    // obwohl das Postfach voll ist. rev1 versteht jeder Server, und rev2 bringt
    // für diesen Einsatz keinen Vorteil.
    disableIMAP4rev2: !account.imap.enableIMAP4rev2,
    logger: false,
    emitLogs: false,
  });
}

function scheduleClose(key: string, entry: Pooled): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    pool.delete(key);
    entry.client.logout().catch(() => entry.client.close());
  }, IDLE_MS);
  entry.timer.unref?.();
}

/** Führt fn mit einer verbundenen IMAP-Session aus. Verbindungen werden wiederverwendet. */
export async function withImap<T>(account: Account, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const key = account.name;
  let entry = pool.get(key);

  if (entry && !entry.client.usable) {
    clearTimeout(entry.timer);
    pool.delete(key);
    entry = undefined;
  }

  if (!entry) {
    const client = makeClient(account);
    client.on("error", () => {
      const cur = pool.get(key);
      if (cur?.client === client) {
        clearTimeout(cur.timer);
        pool.delete(key);
      }
    });
    await client.connect();
    entry = { client, timer: setTimeout(() => {}, 0) };
    pool.set(key, entry);
  }

  clearTimeout(entry.timer);
  try {
    return await fn(entry.client);
  } finally {
    const cur = pool.get(key);
    if (cur) scheduleClose(key, cur);
  }
}

export async function closeAllImap(): Promise<void> {
  await Promise.all(
    [...pool.entries()].map(async ([key, entry]) => {
      clearTimeout(entry.timer);
      pool.delete(key);
      await entry.client.logout().catch(() => entry.client.close());
    })
  );
}

export interface MailboxInfo {
  path: string;
  name: string;
  specialUse?: string;
  subscribed: boolean;
}

export async function listMailboxes(account: Account): Promise<MailboxInfo[]> {
  return withImap(account, async (client) => {
    const boxes = (await client.list()) as ListResponse[];
    return boxes.map((b) => ({
      path: b.path,
      name: b.name,
      specialUse: b.specialUse,
      subscribed: Boolean(b.subscribed),
    }));
  });
}

/**
 * Findet den Ordner für eine Sonderrolle: erst die manuelle Konfiguration,
 * dann das IMAP-SPECIAL-USE-Flag, zuletzt gängige Namen.
 */
export async function resolveSpecialMailbox(
  account: Account,
  role: "sent" | "drafts" | "trash" | "junk"
): Promise<string | null> {
  const configured = account.mailboxes?.[role];
  if (configured) return configured;

  const flag = { sent: "\Sent", drafts: "\Drafts", trash: "\Trash", junk: "\Junk" }[role];
  const fallbacks: Record<typeof role, string[]> = {
    sent: ["Sent", "Gesendet", "Gesendete Elemente", "Sent Items", "INBOX.Sent"],
    drafts: ["Drafts", "Entwürfe", "INBOX.Drafts"],
    trash: ["Trash", "Papierkorb", "Gelöschte Elemente", "Deleted Items", "INBOX.Trash"],
    junk: ["Junk", "Spam", "Junk-E-Mail", "INBOX.Junk"],
  };

  const boxes = await listMailboxes(account);
  const byFlag = boxes.find((b) => b.specialUse === flag);
  if (byFlag) return byFlag.path;

  for (const candidate of fallbacks[role]) {
    const hit = boxes.find((b) => b.path.toLowerCase() === candidate.toLowerCase());
    if (hit) return hit.path;
  }
  return null;
}
