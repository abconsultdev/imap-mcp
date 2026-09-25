import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { detectServers, type DetectedServers } from "./providers.js";

export interface ServerAuth {
  host: string;
  port: number;
  /** true = implizites TLS (993 / 465), false = STARTTLS (143 / 587) */
  secure: boolean;
  user: string;
  pass: string;
  /** Selbstsignierte Zertifikate akzeptieren (nur für interne Server) */
  allowInvalidCert?: boolean;
  /** IMAP4rev2 nutzen, falls der Server es anbietet. Default aus - siehe imap.ts. */
  enableIMAP4rev2?: boolean;
}

export interface MailboxNames {
  sent?: string;
  drafts?: string;
  trash?: string;
  junk?: string;
}

export interface Account {
  name: string;
  email: string;
  /** Anzeigename für den From-Header */
  displayName?: string;
  imap: ServerAuth;
  smtp: ServerAuth;
  /** Senden über SMTP erlauben. Default: true */
  allowSend?: boolean;
  /** Ordnernamen überschreiben, falls die Auto-Erkennung scheitert */
  mailboxes?: MailboxNames;
  /** Gesetzt, wenn die Server automatisch ermittelt wurden. */
  erkennung?: DetectedServers;
}

export interface Config {
  accounts: Account[];
  /** Zielordner für gespeicherte Anhänge. Default: <projekt>/downloads */
  downloadDir?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/**
 * Claude Desktop lässt Platzhalter für leer gebliebene optionale Felder
 * unersetzt stehen, sodass beim Server wörtlich "${user_config.imap_host}"
 * ankommt. Solche Werte gelten hier als "nicht gesetzt" - sonst landet der
 * Platzhalter als Hostname im DNS (getaddrinfo ENOTFOUND) oder als
 * Absendername in versendeten Mails.
 */
const UNRESOLVED_TEMPLATE = /\$\{[^}]*\}/;

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "" || UNRESOLVED_TEMPLATE.test(value)) return undefined;
  return value;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "ja", "on"].includes(value.toLowerCase());
}

function candidatePaths(): string[] {
  const paths: string[] = [];
  const explicit = env("IMAP_MCP_CONFIG");
  if (explicit) paths.push(resolve(explicit));
  paths.push(join(projectRoot, "config.json"));
  return paths;
}

/**
 * Ein Postfach-Platz in den Umgebungsvariablen. Platz 1 nutzt MAIL_*, Platz 2
 * MAIL2_*. Die älteren Namen (IMAP_HOST, IMAP_PASS, ...) gelten nur für Platz 1.
 */
interface EnvSlot {
  prefix: "MAIL_" | "MAIL2_";
  legacy: boolean;
}

const SLOTS: EnvSlot[] = [
  { prefix: "MAIL_", legacy: true },
  { prefix: "MAIL2_", legacy: false },
];

async function accountFromEnv({ prefix, legacy }: EnvSlot, online: boolean): Promise<Account | null> {
  const v = (key: string, legacyKey?: string) => env(prefix + key) ?? (legacy && legacyKey ? env(legacyKey) : undefined);

  const email = v("EMAIL", "IMAP_EMAIL");
  const password = v("PASSWORD", "IMAP_PASS");
  const legacyHost = legacy ? env("IMAP_HOST") : undefined;

  if (!email && !password && !legacyHost) return null;
  if (!email || !password) {
    const fehlt = !email ? `die E-Mail-Adresse (${prefix}EMAIL)` : `das Passwort (${prefix}PASSWORD)`;
    const platz = prefix === "MAIL_" ? "erste" : "zweite";
    throw new Error(
      `Für das ${platz} Postfach fehlt ${fehlt}. In den Einstellungen der Erweiterung entweder ` +
        `Adresse und Passwort ausfüllen oder beides leer lassen.`
    );
  }

  const imapHostOverride = v("IMAP_HOST") ?? legacyHost;
  const smtpHostOverride = v("SMTP_HOST", "SMTP_HOST");

  let erkennung: DetectedServers | undefined;
  if (!imapHostOverride || !smtpHostOverride) {
    erkennung = await detectServers(email, online);
  }

  const imapHost = imapHostOverride ?? erkennung!.imap.host;
  const smtpHost = smtpHostOverride ?? erkennung!.smtp.host;
  const imapPort = Number(v("IMAP_PORT", "IMAP_PORT") ?? erkennung?.imap.port ?? 993);
  const smtpPort = Number(v("SMTP_PORT", "SMTP_PORT") ?? erkennung?.smtp.port ?? 465);
  const user = v("USER", "IMAP_USER") ?? email;

  return {
    // Die Adresse als Name: eindeutig, und Claude wie Nutzer wissen sofort,
    // welches Postfach gemeint ist.
    name: v("ACCOUNT_NAME", "IMAP_ACCOUNT_NAME") ?? email,
    email,
    displayName: v("DISPLAY_NAME", "IMAP_DISPLAY_NAME"),
    // Sicherheitshalber aus: Senden muss ausdrücklich freigegeben werden.
    allowSend: bool(v("ALLOW_SEND"), false),
    imap: { host: imapHost, port: imapPort, secure: imapPort !== 143, user, pass: password },
    smtp: {
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      user: v("SMTP_USER", "SMTP_USER") ?? user,
      pass: v("SMTP_PASS", "SMTP_PASS") ?? password,
    },
    erkennung,
  };
}

/**
 * Baut die Accounts aus Umgebungsvariablen. Das ist der Weg, den das
 * .mcpb-Bundle nutzt: dort füllt Claude Desktop die Variablen aus dem
 * Installationsdialog, die Passwörter kommen aus dem Schlüsselbund des Systems.
 */
async function fromEnvVars(): Promise<Config | null> {
  const online = bool(env("MAIL_AUTODETECT_ONLINE"), true);
  const found = await Promise.all(SLOTS.map((slot) => accountFromEnv(slot, online)));
  const accounts = found.filter((a): a is Account => a !== null);
  if (accounts.length === 0) return null;

  return {
    // Ohne Angabe der Downloads-Ordner des Nutzers - das Bundle selbst liegt in
    // einem von Claude Desktop verwalteten Verzeichnis und ist kein guter Ablageort.
    downloadDir: env("MAIL_DOWNLOAD_DIR") ?? join(homedir(), "Downloads"),
    accounts,
  };
}

function validate(cfg: Config, source: string): Config {
  if (!Array.isArray(cfg.accounts) || cfg.accounts.length === 0) {
    throw new Error(`${source}: "accounts" fehlt oder ist leer.`);
  }
  const seen = new Set<string>();
  for (const a of cfg.accounts) {
    for (const field of ["name", "email", "imap", "smtp"] as const) {
      if (!a[field]) throw new Error(`${source}: Account "${a.name ?? "?"}" - Feld "${field}" fehlt.`);
    }
    for (const side of ["imap", "smtp"] as const) {
      for (const field of ["host", "port", "user", "pass"] as const) {
        if (a[side][field] === undefined || a[side][field] === "") {
          throw new Error(`${source}: Account "${a.name}" - "${side}.${field}" fehlt.`);
        }
      }
      const host = a[side].host;
      if (UNRESOLVED_TEMPLATE.test(host)) {
        throw new Error(
          `${source}: Als ${side.toUpperCase()}-Server steht der unersetzte Platzhalter "${host}" statt eines ` +
            `Servernamens. Lass das Feld in der Extension-Konfiguration ganz leer, dann wird der Server ` +
            `automatisch erkannt - oder trage einen echten Hostnamen wie "imap.strato.de" ein.`
        );
      }
      if (!/^[a-z0-9.-]+$/i.test(host)) {
        throw new Error(
          `${source}: "${host}" ist kein gültiger ${side.toUpperCase()}-Servername. Erwartet wird ein Hostname ` +
            `wie "imap.strato.de" - ohne Protokoll, Pfad, Port oder Leerzeichen.`
        );
      }
      if (a[side].secure === undefined) a[side].secure = a[side].port === 993 || a[side].port === 465;
    }
    if (seen.has(a.name)) throw new Error(`${source}: Account-Name "${a.name}" kommt doppelt vor.`);
    seen.add(a.name);
  }
  cfg.downloadDir = cfg.downloadDir ? resolve(cfg.downloadDir) : join(projectRoot, "downloads");
  return cfg;
}

let cached: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cached) return cached;

  const fromEnv = await fromEnvVars();
  if (fromEnv) {
    cached = validate(fromEnv, "Umgebungsvariablen");
    return cached;
  }

  for (const p of candidatePaths()) {
    if (existsSync(p)) {
      let parsed: Config;
      try {
        parsed = JSON.parse(readFileSync(p, "utf8"));
      } catch (err) {
        throw new Error(`Konfiguration ${p} ist kein gültiges JSON: ${(err as Error).message}`);
      }
      cached = validate(parsed, p);
      return cached;
    }
  }

  throw new Error(
    `Keine Konfiguration gefunden. Erwartet: ${candidatePaths().join(" oder ")} ` +
      `(Vorlage: config.example.json), alternativ die Umgebungsvariablen MAIL_EMAIL und MAIL_PASSWORD.`
  );
}

export async function getAccount(name?: string): Promise<Account> {
  const cfg = await loadConfig();
  if (!name) {
    if (cfg.accounts.length === 1) return cfg.accounts[0];
    throw new Error(
      `Mehrere Accounts konfiguriert - bitte "account" angeben. Verfügbar: ${cfg.accounts.map((a) => a.name).join(", ")}`
    );
  }
  const hit =
    cfg.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase()) ??
    cfg.accounts.find((a) => a.email.toLowerCase() === name.toLowerCase());
  if (!hit) {
    throw new Error(`Account "${name}" unbekannt. Verfügbar: ${cfg.accounts.map((a) => a.name).join(", ")}`);
  }
  return hit;
}

export function fromHeader(account: Account): string {
  return account.displayName ? `"${account.displayName.replace(/"/g, "'")}" <${account.email}>` : account.email;
}
