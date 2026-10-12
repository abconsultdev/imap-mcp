#!/usr/bin/env node
/**
 * Erzeugt manifest-10-einzeln.json aus manifest.json: zehn Postfächer, jedes
 * mit eigenen Feldern wie im Standard-Paket (Benutzername, Senden,
 * Absendername, Server) statt der Sammelfelder von manifest-10.json.
 *
 *   node scripts/manifest-10-einzeln.mjs
 *
 * Läuft auch bei `npm run bundle` mit, damit die Datei nie hinter
 * manifest.json zurückbleibt. Von Hand bearbeiten lohnt sich daher nicht.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANZAHL = 10;

export async function erzeugeManifest10Einzeln() {
  const basis = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const b = basis.user_config;

  const env = {};
  const felder = {};
  const server = {};
  for (let n = 1; n <= ANZAHL; n++) {
    const s = n === 1 ? "" : `_${n}`;
    const p = n === 1 ? "MAIL_" : `MAIL${n}_`;
    const titel = (t) => `Postfach ${n}: ${t}`;
    const erstes = n === 1;

    Object.assign(env, {
      [`${p}EMAIL`]: `\${user_config.email${s}}`,
      [`${p}PASSWORD`]: `\${user_config.password${s}}`,
      [`${p}USER`]: `\${user_config.username${s}}`,
      [`${p}DISPLAY_NAME`]: `\${user_config.display_name${s}}`,
      [`${p}ALLOW_SEND`]: `\${user_config.allow_send${s}}`,
      [`${p}IMAP_HOST`]: `\${user_config.imap_host${s}}`,
      [`${p}SMTP_HOST`]: `\${user_config.smtp_host${s}}`,
    });

    felder[`email${s}`] = {
      type: "string",
      title: titel("E-Mail-Adresse"),
      description: erstes
        ? b.email.description
        : "Nur ausfüllen, wenn Claude auf ein weiteres Postfach zugreifen soll. Sonst leer lassen - dann bleiben auch die übrigen Felder dieses Postfachs unbeachtet.",
      required: erstes,
    };
    felder[`password${s}`] = {
      type: "string",
      title: titel("Passwort"),
      description: erstes ? b.password.description : "Wird ebenfalls im Schlüsselbund des Systems gespeichert.",
      sensitive: true,
      required: erstes,
    };
    felder[`username${s}`] = {
      type: "string",
      title: titel("Benutzername (nur falls abweichend)"),
      description: erstes ? b.username.description : "Leer lassen, wenn der Anmeldename die E-Mail-Adresse dieses Postfachs ist.",
      required: false,
    };
    felder[`allow_send${s}`] = {
      type: "boolean",
      title: titel("Senden erlauben"),
      description: erstes ? b.allow_send.description : "Gilt nur für dieses Postfach, unabhängig von den anderen.",
      default: false,
      required: false,
    };
    felder[`display_name${s}`] = {
      type: "string",
      title: titel("Absendername"),
      description: erstes ? b.display_name.description : "Name im Absender bei diesem Postfach. Leer lassen, um nur die Adresse zu zeigen.",
      required: false,
    };

    // Die Server-Felder stehen wie im Standard-Paket gesammelt am Ende.
    server[`imap_host${s}`] = {
      type: "string",
      title: titel("IMAP-Server (leer lassen)"),
      description: erstes ? b.imap_host.description : b.imap_host_2.description,
      required: false,
    };
    server[`smtp_host${s}`] = {
      type: "string",
      title: titel("SMTP-Server (leer lassen)"),
      description: erstes ? b.smtp_host.description : b.smtp_host_2.description,
      required: false,
    };
  }
  env.MAIL_AUTODETECT_ONLINE = "${user_config.autodetect_online}";

  return {
    ...basis,
    name: "imap-mail-10-einzeln",
    display_name: "E-Mail (IMAP & SMTP) – 10 Postfächer, Felder je Postfach",
    description:
      "Verbindet Claude mit bis zu zehn E-Mail-Postfächern über IMAP und SMTP, jedes mit eigenen Feldern - ohne Umweg über einen Anbieter-Konnektor.",
    long_description: basis.long_description.replace(
      "Bis zu zwei Postfächer lassen sich gleichzeitig einrichten.",
      "Bis zu zehn Postfächer lassen sich gleichzeitig einrichten, jedes mit eigenen Feldern für Benutzername, Senden, Absendername und Server."
    ),
    server: { ...basis.server, mcp_config: { ...basis.server.mcp_config, env } },
    user_config: { ...felder, autodetect_online: b.autodetect_online, ...server },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await erzeugeManifest10Einzeln();
  await writeFile(join(root, "manifest-10-einzeln.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest-10-einzeln.json geschrieben (${Object.keys(manifest.user_config).length} Felder).`);
}
