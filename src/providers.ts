import { resolveMx } from "node:dns/promises";
import type { ServerAuth } from "./config.js";

export interface DetectedServers {
  imap: Pick<ServerAuth, "host" | "port" | "secure">;
  smtp: Pick<ServerAuth, "host" | "port" | "secure">;
  /** Woher die Werte stammen - wird dem Nutzer angezeigt. */
  quelle: string;
  anbieter?: string;
  hinweis?: string;
}

interface Preset {
  anbieter: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** Domains der Freemail-Angebote dieses Anbieters. */
  domains?: string[];
  /** Muster, die auf den MX-Eintrag einer eigenen Domain passen. */
  mxPatterns?: RegExp[];
  hinweis?: string;
}

const PRESETS: Preset[] = [
  {
    anbieter: "Strato",
    imapHost: "imap.strato.de",
    imapPort: 993,
    smtpHost: "smtp.strato.de",
    smtpPort: 465,
    mxPatterns: [/(^|\.)strato\.de$/i, /(^|\.)rzone\.de$/i],
  },
  {
    anbieter: "IONOS / 1&1",
    imapHost: "imap.ionos.de",
    imapPort: 993,
    smtpHost: "smtp.ionos.de",
    smtpPort: 465,
    domains: ["ionos.de", "1und1.de"],
    mxPatterns: [
      /(^|\.)ionos\.(de|com)$/i,
      /(^|\.)1und1\.de$/i,
      /(^|\.)1and1\.(com|de)$/i,
      /(^|\.)kundenserver\.de$/i,
      /(^|\.)perfora\.net$/i,
    ],
  },
  {
    anbieter: "All-Inkl",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
    mxPatterns: [/(^|\.)kasserver\.com$/i],
    hinweis:
      "All-Inkl nutzt pro Kunde einen eigenen Server (wXXXXXX.kasserver.com). Der Hostname aus dem MX-Eintrag wird direkt verwendet.",
  },
  {
    anbieter: "Google / Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    domains: ["gmail.com", "googlemail.com"],
    mxPatterns: [/(^|\.)google\.com$/i, /(^|\.)googlemail\.com$/i],
    hinweis:
      "Gmail verlangt ein App-Passwort (Google-Konto → Sicherheit → App-Passwörter). Das normale Kontopasswort wird abgelehnt. Zwei-Faktor-Authentifizierung muss dafür aktiv sein.",
  },
  {
    anbieter: "Microsoft 365 / Outlook",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    domains: ["outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com"],
    mxPatterns: [/(^|\.)protection\.outlook\.com$/i, /(^|\.)outlook\.com$/i],
    hinweis:
      "Viele Microsoft-365-Tenants haben die Anmeldung per Passwort (Basic Auth) abgeschaltet. Dann ist keine Anbindung möglich - dieser Server kann kein OAuth2.",
  },
  {
    anbieter: "GMX",
    imapHost: "imap.gmx.net",
    imapPort: 993,
    smtpHost: "mail.gmx.net",
    smtpPort: 465,
    domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch", "gmx.com"],
    hinweis: "IMAP muss im GMX-Webinterface unter Einstellungen erst freigeschaltet werden.",
  },
  {
    anbieter: "Web.de",
    imapHost: "imap.web.de",
    imapPort: 993,
    smtpHost: "smtp.web.de",
    smtpPort: 465,
    domains: ["web.de"],
    hinweis: "IMAP muss im Web.de-Webinterface unter Einstellungen erst freigeschaltet werden.",
  },
  {
    anbieter: "Telekom / T-Online",
    imapHost: "secureimap.t-online.de",
    imapPort: 993,
    smtpHost: "securesmtp.t-online.de",
    smtpPort: 465,
    domains: ["t-online.de", "magenta.de"],
    hinweis: "Benötigt ein separat eingerichtetes E-Mail-Passwort, nicht das Telekom-Kundenkennwort.",
  },
  {
    anbieter: "mailbox.org",
    imapHost: "imap.mailbox.org",
    imapPort: 993,
    smtpHost: "smtp.mailbox.org",
    smtpPort: 465,
    domains: ["mailbox.org"],
    mxPatterns: [/(^|\.)mailbox\.org$/i],
  },
  {
    anbieter: "Posteo",
    imapHost: "posteo.de",
    imapPort: 993,
    smtpHost: "posteo.de",
    smtpPort: 465,
    domains: ["posteo.de", "posteo.net"],
  },
  {
    anbieter: "Apple iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    domains: ["icloud.com", "me.com", "mac.com"],
    hinweis: "iCloud verlangt ein app-spezifisches Passwort aus den Apple-ID-Einstellungen.",
  },
  {
    anbieter: "Yahoo",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    domains: ["yahoo.com", "yahoo.de", "ymail.com"],
    hinweis: "Yahoo verlangt ein App-Passwort.",
  },
  {
    anbieter: "Hetzner",
    imapHost: "mail.your-server.de",
    imapPort: 993,
    smtpHost: "mail.your-server.de",
    smtpPort: 465,
    mxPatterns: [/(^|\.)your-server\.de$/i],
  },
  {
    anbieter: "netcup",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
    mxPatterns: [/(^|\.)netcup\.net$/i, /(^|\.)netcup\.eu$/i],
  },
  {
    anbieter: "domainFACTORY",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
    mxPatterns: [/(^|\.)df\.eu$/i],
  },
  {
    anbieter: "united-domains",
    imapHost: "imap.udag.de",
    imapPort: 993,
    smtpHost: "smtp.udag.de",
    smtpPort: 465,
    mxPatterns: [/(^|\.)udag\.de$/i],
  },
];

function toServers(p: Preset, mxHost?: string, quelle?: string): DetectedServers {
  const imapHost = p.imapHost || mxHost || "";
  const smtpHost = p.smtpHost || mxHost || "";
  return {
    imap: { host: imapHost, port: p.imapPort, secure: p.imapPort === 993 },
    smtp: { host: smtpHost, port: p.smtpPort, secure: p.smtpPort === 465 },
    quelle: quelle ?? "eingebaute Anbieterliste",
    anbieter: p.anbieter,
    hinweis: p.hinweis,
  };
}

function byDomain(domain: string): DetectedServers | null {
  const hit = PRESETS.find((p) => p.domains?.some((d) => d === domain));
  return hit ? toServers(hit, undefined, "eingebaute Anbieterliste (Domain erkannt)") : null;
}

async function byMxRecord(domain: string): Promise<DetectedServers | null> {
  let records: Array<{ exchange: string; priority: number }>;
  try {
    records = await resolveMx(domain);
  } catch {
    return null;
  }
  if (!records?.length) return null;
  const sorted = [...records].sort((a, b) => a.priority - b.priority);
  for (const rec of sorted) {
    const hit = serversForMxHost(rec.exchange);
    if (hit) return hit;
  }
  return null;
}

/**
 * Ordnet einen einzelnen MX-Hostnamen einem Anbieter zu. Getrennt von der
 * DNS-Abfrage, damit sich die Muster ohne echte Domain testen lassen.
 */
export function serversForMxHost(mxHost: string): DetectedServers | null {
  const host = mxHost.replace(/\.$/, "");
  const hit = PRESETS.find((p) => p.mxPatterns?.some((re) => re.test(host)));
  return hit ? toServers(hit, host, `MX-Eintrag der Domain (${host})`) : null;
}

function pickXml(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"));
  return m?.[1]?.trim();
}

/** Mozillas offene Autoconfig-Datenbank (dieselbe, die Thunderbird benutzt). */
async function byThunderbirdAutoconfig(domain: string): Promise<DetectedServers | null> {
  let xml: string;
  try {
    const res = await fetch(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "text/xml" },
    });
    if (!res.ok) return null;
    xml = await res.text();
  } catch {
    return null;
  }

  const imapBlock = xml.match(/<incomingServer[^>]*type="imap"[^>]*>([\s\S]*?)<\/incomingServer>/i)?.[1];
  const smtpBlock = xml.match(/<outgoingServer[^>]*type="smtp"[^>]*>([\s\S]*?)<\/outgoingServer>/i)?.[1];
  if (!imapBlock || !smtpBlock) return null;

  const imapHost = pickXml(imapBlock, "hostname");
  const smtpHost = pickXml(smtpBlock, "hostname");
  if (!imapHost || !smtpHost) return null;

  const imapPort = Number(pickXml(imapBlock, "port") ?? 993);
  const smtpPort = Number(pickXml(smtpBlock, "port") ?? 465);
  const imapSocket = (pickXml(imapBlock, "socketType") ?? "SSL").toUpperCase();
  const smtpSocket = (pickXml(smtpBlock, "socketType") ?? "SSL").toUpperCase();

  return {
    imap: { host: imapHost, port: imapPort, secure: imapSocket === "SSL" },
    smtp: { host: smtpHost, port: smtpPort, secure: smtpSocket === "SSL" },
    quelle: "Thunderbird-Autoconfig-Datenbank (autoconfig.thunderbird.net)",
    anbieter: xml.match(/<displayName>([^<]+)<\/displayName>/i)?.[1]?.trim(),
  };
}

function guessed(domain: string): DetectedServers {
  return {
    imap: { host: `imap.${domain}`, port: 993, secure: true },
    smtp: { host: `smtp.${domain}`, port: 465, secure: true },
    quelle: "geraten aus der Domain - nicht bestätigt",
    hinweis:
      "Der Anbieter konnte nicht erkannt werden. Falls die Verbindung scheitert, trage IMAP- und SMTP-Server " +
      "aus der Anleitung deines Anbieters von Hand ein (in der Extension-Konfiguration oder in der config.json).",
  };
}

/**
 * Ermittelt IMAP-/SMTP-Server zu einer E-Mail-Adresse.
 * Reihenfolge: Anbieterliste -> MX-Eintrag -> Thunderbird-Autoconfig -> Raten.
 * `allowNetwork: false` überspringt MX- und Online-Abfrage.
 */
export async function detectServers(email: string, allowNetwork = true): Promise<DetectedServers> {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) throw new Error(`"${email}" ist keine gültige E-Mail-Adresse.`);

  const direct = byDomain(domain);
  if (direct) return direct;

  if (allowNetwork) {
    const viaMx = await byMxRecord(domain);
    if (viaMx?.imap.host) return viaMx;

    const viaIspdb = await byThunderbirdAutoconfig(domain);
    if (viaIspdb) return viaIspdb;
  }

  return guessed(domain);
}

export function knownProviders(): string[] {
  return PRESETS.map((p) => p.anbieter);
}
