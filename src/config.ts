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
 * Ein Postfach-Platz in den Umgebungsvariablen. Platz 1 nutzt MAIL_*, die
 * übrigen MAIL2_* bis MAIL10_*. Die älteren Namen (IMAP_HOST, IMAP_PASS, ...)
 * gelten nur für Platz 1.
 */
interface EnvSlot {
  nummer: number;
  prefix: string;
  legacy: boolean;
}

/** So viele Postfächer bietet der Installationsdialog des Bundles an. */
export const MAX_ENV_ACCOUNTS = 10;

const SLOTS: EnvSlot[] = Array.from({ length: MAX_ENV_ACCOUNTS }, (_, i) => ({
  nummer: i + 1,
  prefix: i === 0 ? "MAIL_" : `MAIL${i + 1}_`,
  legacy: i === 0,
}));

interface HostPort {
  host: string;
  port?: number;
}

/**
 * Einstellungen, die im Installationsdialog nicht je Postfach, sondern in je
 * einem gemeinsamen Textfeld stehen - sonst bräuchten zehn Postfächer rund
 * siebzig Felder. Schlüssel ist die Adresse in Kleinbuchstaben.
 */
interface Sammelfelder {
  senden: Set<string> | "alle";
  absendernamen: Map<string, string>;
  benutzernamen: Map<string, string>;
  server: Map<string, { imap: HostPort; smtp: HostPort }>;
}

/** Titel im Installationsdialog und Variablenname - für verständliche Fehlermeldungen. */
const FELD = {
  senden: "„Senden erlauben für“ (MAIL_ALLOW_SEND_FOR)",
  absendernamen: "„Absendernamen“ (MAIL_DISPLAY_NAMES)",
  benutzernamen: "„Abweichende Benutzernamen“ (MAIL_USERNAMES)",
  server: "„Server von Hand“ (MAIL_SERVERS)",
};

function adressListe(raw: string | undefined): Set<string> | "alle" {
  if (raw && ["alle", "all", "*"].includes(raw.toLowerCase())) return "alle";
  const set = new Set<string>();
  for (const teil of (raw ?? "").split(/[,;\s]+/)) {
    if (!teil) continue;
    if (!teil.includes("@")) {
      throw new Error(
        `Im Feld ${FELD.senden} ist „${teil}“ keine E-Mail-Adresse. Erwartet: Adressen mit Komma getrennt, oder „alle“.`
      );
    }
    set.add(teil.toLowerCase());
  }
  return set;
}

/** "adresse = wert; adresse = wert" */
function zuordnungen(feld: string, raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const teil of (raw ?? "").split(/[;\n]/)) {
    const eintrag = teil.trim();
    if (!eintrag) continue;
    const i = eintrag.indexOf("=");
    const adresse = i < 0 ? "" : eintrag.slice(0, i).trim().toLowerCase();
    const wert = i < 0 ? "" : eintrag.slice(i + 1).trim();
    if (!adresse.includes("@") || !wert) {
      throw new Error(
        `Im Feld ${feld} ist „${eintrag}“ nicht lesbar. Erwartet: adresse = wert, mehrere mit Semikolon getrennt, ` +
          `z.B. „info@firma.de = Firma GmbH; anna@web.de = Anna“.`
      );
    }
    if (map.has(adresse)) throw new Error(`Im Feld ${feld} steht ${adresse} doppelt.`);
    map.set(adresse, wert);
  }
  return map;
}

function hostPort(text: string): HostPort {
  const m = /^([^:\s]+):(\d+)$/.exec(text);
  // Unlesbares geht unverändert weiter; validate() meldet es dann mit Hinweis.
  return m ? { host: m[1], port: Number(m[2]) } : { host: text };
}

/** Wert "imap.x.de, smtp.x.de" oder nur "mail.x.de" für beide, jeweils optional mit :port. */
function serverZuordnungen(raw: string | undefined): Sammelfelder["server"] {
  const map: Sammelfelder["server"] = new Map();
  for (const [adresse, wert] of zuordnungen(FELD.server, raw)) {
    const hosts = wert.split(",").map((h) => h.trim()).filter(Boolean);
    if (hosts.length > 2) {
      throw new Error(
        `Im Feld ${FELD.server} stehen für ${adresse} mehr als zwei Server. Erwartet: „imap-server, smtp-server“.`
      );
    }
    map.set(adresse, { imap: hostPort(hosts[0]), smtp: hostPort(hosts[1] ?? hosts[0]) });
  }
  return map;
}

function sammelfelder(): Sammelfelder {
  return {
    senden: adressListe(env("MAIL_ALLOW_SEND_FOR")),
    absendernamen: zuordnungen(FELD.absendernamen, env("MAIL_DISPLAY_NAMES")),
    benutzernamen: zuordnungen(FELD.benutzernamen, env("MAIL_USERNAMES")),
    server: serverZuordnungen(env("MAIL_SERVERS")),
  };
}

/** Jede Adresse in den Sammelfeldern muss zu einem eingerichteten Postfach gehören - sonst ist es ein Tippfehler. */
function pruefeSammelfelder(s: Sammelfelder, accounts: Account[]): void {
  const eingerichtet = new Set(accounts.map((a) => a.email.toLowerCase()));
  const felder: Array<[string, Iterable<string>]> = [
    [FELD.senden, s.senden === "alle" ? [] : s.senden],
    [FELD.absendernamen, s.absendernamen.keys()],
    [FELD.benutzernamen, s.benutzernamen.keys()],
    [FELD.server, s.server.keys()],
  ];
  for (const [feld, adressen] of felder) {
    for (const adresse of adressen) {
      if (!eingerichtet.has(adresse)) {
        throw new Error(
          `Im Feld ${feld} steht ${adresse}, das ist aber keins der eingerichteten Postfächer ` +
            `(${[...eingerichtet].join(", ")}). Tippfehler?`
        );
      }
    }
  }
}

async function accountFromEnv(
  { nummer, prefix, legacy }: EnvSlot,
  sammel: Sammelfelder,
  online: boolean
): Promise<Account | null> {
  const v = (key: string, legacyKey?: string) => env(prefix + key) ?? (legacy && legacyKey ? env(legacyKey) : undefined);

  const email = v("EMAIL", "IMAP_EMAIL");
  const password = v("PASSWORD", "IMAP_PASS");
  const legacyHost = legacy ? env("IMAP_HOST") : undefined;

  if (!email && !password && !legacyHost) return null;
  if (!email || !password) {
    const fehlt = !email ? `die E-Mail-Adresse (${prefix}EMAIL)` : `das Passwort (${prefix}PASSWORD)`;
    throw new Error(
      `Für Postfach ${nummer} fehlt ${fehlt}. In den Einstellungen der Erweiterung entweder ` +
        `Adresse und Passwort ausfüllen oder beides leer lassen.`
    );
  }

  // Einzelvariablen (MAIL3_IMAP_HOST, ...) gehen vor den Sammelfeldern.
  const key = email.toLowerCase();
  const server = sammel.server.get(key);
  const imapHostOverride = v("IMAP_HOST") ?? legacyHost ?? server?.imap.host;
  const smtpHostOverride = v("SMTP_HOST", "SMTP_HOST") ?? server?.smtp.host;

  let erkennung: DetectedServers | undefined;
  if (!imapHostOverride || !smtpHostOverride) {
    erkennung = await detectServers(email, online);
  }

  const imapHost = imapHostOverride ?? erkennung!.imap.host;
  const smtpHost = smtpHostOverride ?? erkennung!.smtp.host;
  const imapPort = Number(v("IMAP_PORT", "IMAP_PORT") ?? server?.imap.port ?? erkennung?.imap.port ?? 993);
  const smtpPort = Number(v("SMTP_PORT", "SMTP_PORT") ?? server?.smtp.port ?? erkennung?.smtp.port ?? 465);
  const user = v("USER", "IMAP_USER") ?? sammel.benutzernamen.get(key) ?? email;
  const sendenFreigegeben = sammel.senden === "alle" || sammel.senden.has(key);

  return {
    // Die Adresse als Name: eindeutig, und Claude wie Nutzer wissen sofort,
    // welches Postfach gemeint ist.
    name: v("ACCOUNT_NAME", "IMAP_ACCOUNT_NAME") ?? email,
    email,
    displayName: v("DISPLAY_NAME", "IMAP_DISPLAY_NAME") ?? sammel.absendernamen.get(key),
    // Sicherheitshalber aus: Senden muss ausdrücklich freigegeben werden.
    allowSend: bool(v("ALLOW_SEND"), false) || sendenFreigegeben,
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
  const sammel = sammelfelder();
  const found = await Promise.all(SLOTS.map((slot) => accountFromEnv(slot, sammel, online)));
  const accounts = found.filter((a): a is Account => a !== null);
  if (accounts.length === 0) return null;
  pruefeSammelfelder(sammel, accounts);

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
