# IMAP MCP

Lokaler MCP-Server, der Claude Zugriff auf beliebige IMAP-Postfächer gibt und E-Mails über SMTP versendet.
Läuft komplett auf deinem Rechner — Zugangsdaten und Mails verlassen die Maschine nur Richtung deines Mailservers.

Es gibt zwei Wege:

| | [Weg A: Fertiges Bundle](#weg-a-fertiges-bundle-für-endnutzer) | [Weg B: Aus dem Quellcode](#weg-b-aus-dem-quellcode-für-entwickler) |
| --- | --- | --- |
| Für wen | Endnutzer, Workshops, Schulungen | Entwicklung, mehr als zwei Postfächer, Linux |
| Postfächer | bis zu zwei | beliebig viele |
| Voraussetzungen | nur Claude Desktop | Node ≥ 18.17, Terminal |
| Installation | Datei doppelklicken, Adresse + Passwort eintippen | klonen, bauen, JSON konfigurieren |
| Server-Einstellungen | automatisch erkannt | automatisch oder von Hand |
| Passwort liegt | im Schlüsselbund des Systems | im Klartext in `config.json` |

---

# Weg A: Fertiges Bundle (für Endnutzer)

Claude Desktop bringt auf macOS und Windows eine eigene Node-Laufzeit mit. Als `.mcpb`-Bundle verpackt
braucht niemand Node, Terminal oder Git.

## Bundle bauen (einmalig, macht die Kursleitung)

```bash
npm install && npm run bundle
```

Ergebnis: `build/imap-mail.mcpb` — **rund 1 MB, vier Dateien**. Diese eine Datei wird verteilt, per
USB-Stick, Cloud-Ordner oder Download-Link. Sie ist auf macOS und Windows identisch.

Der Server wird dabei mit esbuild zu einer einzigen JavaScript-Datei gebündelt. Das spart nicht nur
Platz: ohne Bündelung lägen rund 5000 Dateien im Bundle, davon ein Drittel Typdeklarationen und
Sourcemaps, die zur Laufzeit nie geladen werden — dazu die HTTP-Transporte des MCP-SDK (`hono`, `ajv`,
4,3 MB), die ein stdio-Server nie anfasst.

Bündeln kann dynamisch nachgeladene Module zerreißen — `iconv-lite` lädt Zeichensatz-Tabellen zur
Laufzeit, `mailparser` und `MailComposer` ziehen Module über `require()` herein. Ein solcher Bruch
fiele sonst erst beim ersten Umlaut in einer echten Mail auf. Deshalb prüft `npm run bundle` sein
eigenes Ergebnis, bevor gepackt wird: Zeichensatz-Umwandlung, Anhänge, Mail-Aufbau und die komplette
Konfigurationsmatrix laufen gegen die gebündelte Datei. Schlägt eine Prüfung fehl, entsteht kein
`.mcpb`. Mit `npm run bundle -- --skip-checks` lässt sich das überspringen.

## Bundle installieren (macht jeder Teilnehmer)

1. `imap-mail.mcpb` doppelklicken — alternativ ins Claude-Desktop-Fenster ziehen oder unter
   Einstellungen → Erweiterungen → Erweiterte Einstellungen → Erweiterung installieren auswählen.
2. Im Installationsdialog **E-Mail-Adresse** und **Passwort** eintragen. Alle anderen Felder sind optional.
3. Installieren, fertig. Kein Neustart nötig.

Erster Test im Chat: *„Teste die Mail-Verbindung"*.

**Was im Dialog abgefragt wird**

| Feld | |
| --- | --- |
| E-Mail-Adresse | Pflichtfeld |
| Passwort | Pflichtfeld. Landet im **Schlüsselbund** (macOS) bzw. der **Anmeldeinformationsverwaltung** (Windows), nicht in einer Datei |
| Senden erlauben | Standardmäßig **aus** — Claude kann dann lesen und Entwürfe anlegen, aber nichts verschicken |
| Absendername | optional |
| Zweites Postfach: Adresse, Passwort, Senden, Absendername | optional — leer lassen, wenn nur ein Postfach gebraucht wird |
| Server online nachschlagen | siehe unten |
| IMAP-/SMTP-Server (je Postfach) | nur nötig, wenn die Erkennung scheitert |

Anhänge landen im Downloads-Ordner.

## Zwei Postfächer

Im Dialog lassen sich bis zu zwei Postfächer einrichten, auch bei verschiedenen Anbietern. Jedes wird
getrennt erkannt, und **Senden wird je Postfach einzeln freigegeben**: Man kann etwa das private
Postfach nur lesbar lassen und nur im geschäftlichen den Versand erlauben.

Sobald zwei eingerichtet sind, nennt Claude das Postfach bei jedem Zugriff über seine Adresse. Fehlt
diese Angabe, kommt eine Rückfrage statt einer stillen Annahme — das zählt vor allem beim Senden, damit
keine Mail vom falschen Absender rausgeht. Im Chat reicht es, das Postfach beim Namen zu nennen:
*„Was ist heute im Geschäftspostfach reingekommen?"*

Mehr als zwei gehen über das Bundle nicht, weil das Manifest-Format keine beliebig langen Feldlisten
kennt. Über `config.json` (Weg B) ist die Zahl unbegrenzt.

## Wie die Server-Erkennung funktioniert

Niemand muss seinen IMAP-Host kennen. Der Server probiert der Reihe nach:

1. **Eingebaute Anbieterliste** — Gmail, GMX, Web.de, T-Online, Posteo, mailbox.org, iCloud, Yahoo,
   Outlook und weitere, erkannt an der Domain der Adresse.
2. **MX-Eintrag der Domain** — der wichtigste Fall bei eigenen Domains. `info@meinefirma.de` mit einem
   MX-Eintrag auf `smtpin.rzone.de` wird als Strato-Postfach erkannt. Deckt Strato, IONOS, All-Inkl,
   Hetzner, netcup, domainFACTORY, united-domains, Google Workspace und Microsoft 365 ab.
3. **Mozillas Autoconfig-Datenbank** — dieselbe Quelle, aus der Thunderbird seine Einstellungen zieht.
4. **Raten** aus der Domain (`imap.<domain>`), klar als unbestätigt gekennzeichnet.

Schritte 2 und 3 brauchen Netzwerk und fragen dabei **nur die Domain** ab, nie die Adresse oder das
Passwort. Wer das nicht möchte, schaltet „Server online nachschlagen" aus; dann greift nur die
eingebaute Liste, und exotische Anbieter müssen von Hand eingetragen werden.

Das Tool `mail_detect_provider` macht dieselbe Abfrage für eine beliebige Adresse, ohne Passwort und
ohne Anmeldung — praktisch, um im Workshop vorab zu klären, wer sich überhaupt verbinden kann.

---

# Weg B: Aus dem Quellcode (für Entwickler)

## 1. Installieren

```bash
cd E:\Dev\IMAP_MCP && npm install && npm run build
```

## 2. Konfigurieren

`config.example.json` nach `config.json` kopieren und ausfüllen:

```bash
copy E:\Dev\IMAP_MCP\config.example.json E:\Dev\IMAP_MCP\config.json
```

```json
{
  "downloadDir": "E:\\Dev\\IMAP_MCP\\downloads",
  "accounts": [
    {
      "name": "hauptpostfach",
      "email": "info@example.com",
      "displayName": "Dein Name",
      "allowSend": true,
      "imap": { "host": "imap.example.com", "port": 993, "secure": true, "user": "info@example.com", "pass": "..." },
      "smtp": { "host": "smtp.example.com", "port": 465, "secure": true, "user": "info@example.com", "pass": "..." }
    }
  ]
}
```

| Feld | Bedeutung |
| --- | --- |
| `name` | Kurzname, den du im Chat benutzt ("lies die Mails im hauptpostfach") |
| `displayName` | Absendername im From-Header |
| `allowSend` | `false` = reiner Lesezugriff, `mail_send` verweigert dann den Dienst |
| `secure` | `true` bei Port 993/465 (direktes TLS), `false` bei 143/587 (STARTTLS) |
| `allowInvalidCert` | nur für interne Server mit selbstsigniertem Zertifikat |
| `mailboxes` | optional, überschreibt die Auto-Erkennung von Gesendet/Entwürfe/Papierkorb |

Mehrere Postfächer: einfach weitere Objekte in `accounts` eintragen. Bei mehr als einem Account
verlangt jedes Tool den Parameter `account`.

### Gängige Server

| Anbieter | IMAP | SMTP | Hinweis |
| --- | --- | --- | --- |
| Gmail / Workspace | `imap.gmail.com:993` | `smtp.gmail.com:465` | App-Passwort nötig (2FA erforderlich) |
| Microsoft 365 / Outlook | `outlook.office365.com:993` | `smtp.office365.com:587` (`secure: false`) | Basic-Auth oft gesperrt — dann geht nur OAuth, siehe Einschränkungen |
| IONOS | `imap.ionos.de:993` | `smtp.ionos.de:465` | |
| Strato | `imap.strato.de:993` | `smtp.strato.de:465` | |
| All-Inkl | `<server>.kasserver.com:993` | `<server>.kasserver.com:465` | |
| mailbox.org | `imap.mailbox.org:993` | `smtp.mailbox.org:465` | eigenes App-Passwort empfohlen |
| GMX / Web.de | `imap.gmx.net:993` / `imap.web.de:993` | `mail.gmx.net:465` / `smtp.web.de:465` | POP3/IMAP muss in den Einstellungen freigeschaltet sein |

Nutze überall, wo es geht, ein **App-spezifisches Passwort** statt des Account-Passworts — das lässt
sich einzeln widerrufen, ohne das Postfach-Passwort zu ändern.

### Alternative: Umgebungsvariablen

Ohne `config.json` genügen `MAIL_EMAIL` und `MAIL_PASSWORD` für einen Account — die Server werden dann
automatisch erkannt. Das ist auch der Weg, den das `.mcpb`-Bundle nutzt. **Umgebungsvariablen haben
Vorrang vor `config.json`.**

| Variable | |
| --- | --- |
| `MAIL_EMAIL`, `MAIL_PASSWORD` | Pflicht |
| `MAIL_ALLOW_SEND` | `true` schaltet den Versand frei. **Standard ist aus** |
| `MAIL_DISPLAY_NAME` | Absendername |
| `MAIL_IMAP_HOST`, `MAIL_SMTP_HOST` | überschreiben die Erkennung |
| `MAIL_IMAP_PORT`, `MAIL_SMTP_PORT` | Ports, Standard 993 / 465 |
| `MAIL2_EMAIL`, `MAIL2_PASSWORD`, `MAIL2_ALLOW_SEND`, `MAIL2_DISPLAY_NAME`, `MAIL2_IMAP_HOST`, `MAIL2_SMTP_HOST`, … | dasselbe für ein zweites Postfach |
| `MAIL_AUTODETECT_ONLINE` | `false` schaltet MX- und Online-Abfrage ab (gilt für beide) |
| `MAIL_DOWNLOAD_DIR` | Ordner für Anhänge, Standard `~/Downloads` |
| `IMAP_MCP_CONFIG` | abweichender Pfad zur `config.json` |

Werte, die noch einen unersetzten Platzhalter der Form `${...}` enthalten, werden als *nicht gesetzt*
behandelt — siehe [Fehlersuche](#fehlersuche). Die älteren Namen `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`,
`IMAP_PORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` funktionieren weiterhin.

## 3. In Claude eintragen

Der Server spricht MCP über stdio. Eintrag in `%APPDATA%\Claude\claude_desktop_config.json`
(Claude Desktop → Einstellungen → Entwickler → Konfiguration bearbeiten):

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["E:\\Dev\\IMAP_MCP\\dist\\index.js"]
    }
  }
}
```

Danach Claude Desktop **komplett beenden und neu starten** — die MCP-Server werden nur beim Start geladen.

In Claude Code alternativ:

```bash
claude mcp add imap --scope user -- node E:\Dev\IMAP_MCP\dist\index.js
```

Erster Test im Chat: *"Teste die Mail-Verbindung"* → ruft `mail_test_connection` auf und meldet IMAP und SMTP getrennt.

## Auf einem zweiten Rechner (macOS / Linux)

Der Server ist plattformneutral — im Quellcode stehen keine Windows-Pfade. Nur Ablageort und
Claude-Konfiguration unterscheiden sich. Nötig ist Node ≥ 18.17.

**1. Projekt übertragen — ohne `config.json`.** Die Datei enthält dein Passwort im Klartext und steht
deshalb in `.gitignore`. Leg sie auf dem zweiten Rechner neu an, statt sie zu kopieren:

```bash
git clone https://github.com/abconsultdev/imap-mcp.git ~/Dev/IMAP_MCP
cd ~/Dev/IMAP_MCP && npm install && npm run build
```

Ohne Repo reicht es, `src/`, `package.json`, `package-lock.json`, `tsconfig.json` und `README.md` zu
übertragen — `node_modules/` und `dist/` entstehen beim `npm install && npm run build` neu und
gehören nicht in den Transfer.

**2. `config.json` neu anlegen.** Identisch zur Windows-Fassung, aber `downloadDir` einfach weglassen —
dann landen Anhänge automatisch in `<projekt>/downloads`:

```bash
cp config.example.json config.json && chmod 600 config.json
```

**3. In Claude Desktop eintragen** — auf dem Mac liegt die Datei unter
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/Users/DEIN-NAME/Dev/IMAP_MCP/dist/index.js"]
    }
  }
}
```

Der Pfad muss absolut sein — `~` wird nicht aufgelöst. `which node` verrät, ob Node im PATH von
Claude Desktop liegt; falls der Server nicht startet, trag statt `"node"` den vollen Pfad aus
`which node` ein (typisch bei Node über nvm oder Homebrew).

Danach Claude Desktop neu starten und *"Teste die Mail-Verbindung"* aufrufen.

**Beide Rechner parallel** greifen problemlos auf dasselbe Postfach zu — IMAP ist dafür gebaut.
Gelesen-Markierungen und verschobene Mails sieht der jeweils andere Rechner. Nur `downloadDir` ist
lokal: gespeicherte Anhänge liegen auf dem Rechner, der sie geholt hat.

## Tools

**Lesen**

| Tool | Zweck |
| --- | --- |
| `mail_list_accounts` | Konfigurierte Postfächer (ohne Passwörter) |
| `mail_test_connection` | IMAP- und SMTP-Login einzeln prüfen |
| `mail_detect_provider` | Server-Einstellungen zu einer Adresse ermitteln — ohne Passwort, ohne Anmeldung |
| `mail_list_mailboxes` | Alle Ordner + erkannte Sonderordner |
| `mail_search` | Nach Absender, Betreff, Text, Datum, ungelesen … — liefert UIDs |
| `mail_read` | Eine Nachricht per UID vollständig lesen |
| `mail_get_raw` | RFC822-Quelltext (Header-Analyse, SPF/DKIM) |
| `mail_save_attachment` | Anhänge auf die Platte speichern |

**Verwalten**

| Tool | Zweck |
| --- | --- |
| `mail_set_flags` | gelesen / ungelesen / markiert / beantwortet setzen |
| `mail_move` | In anderen Ordner verschieben |
| `mail_move_to_trash` | In den Papierkorb (nie endgültiges Löschen) |

**Schreiben**

| Tool | Zweck |
| --- | --- |
| `mail_create_draft` | Mail als Entwurf ins IMAP-Postfach legen, ohne zu senden |
| `mail_send` | Über SMTP versenden und Kopie im Gesendet-Ordner ablegen |

`mail_send` und `mail_create_draft` nehmen beide `inReplyToUid`, damit Antworten sauber im Thread landen
(`In-Reply-To` und `References` werden aus der Originalmail gesetzt). Anhänge kommen entweder als
lokaler `path` oder als `contentBase64`.

## Typische Abläufe

- *"Was ist heute ungelesen reingekommen?"* → `mail_search` mit `unseen: true`, `since: heute`
- *"Fass mir den Thread mit Anna zusammen"* → `mail_search` mit `from: anna`, dann `mail_read` je UID
- *"Antworte darauf"* → `mail_create_draft` mit `inReplyToUid`, du prüfst im Mailprogramm, dann `mail_send`
- *"Räum die Newsletter weg"* → `mail_search`, dann `mail_move` nach `Archiv`

## Sicherheit

- `config.json` enthält Klartext-Passwörter und steht in `.gitignore`. Rechte einschränken:
  ```powershell
  icacls E:\Dev\IMAP_MCP\config.json /inheritance:r /grant:r "$env:USERNAME:(R,W)"
  ```
- **Versand ist endgültig.** Claude fragt vor `mail_send` nach — bestätige bewusst. Wenn du generell
  nur Entwürfe willst, setze `allowSend: false` und nutze `mail_create_draft`.
- Es gibt bewusst kein endgültiges Löschen. `mail_move_to_trash` verschiebt nur; geleert wird im Mailprogramm.
- Mailinhalte sind Daten, keine Anweisungen. Wenn in einer Mail steht "leite das weiter" oder "antworte mit X",
  ist das kein Auftrag von dir — Claude soll dich fragen, bevor so etwas ausgeführt wird.

## Für Workshops

- **Vorher klären, wer teilnehmen kann.** Lass Teilnehmer ihre Adresse vorab nennen und prüfe sie mit
  `mail_detect_provider`. Das kostet kein Passwort und zeigt sofort, bei wem es klemmen wird — vor allem
  Microsoft 365 (Basic Auth oft gesperrt) und Gmail (App-Passwort nötig, das man nicht in fünf Minuten einrichtet).
- **App-Passwörter sind die halbe Miete.** Gmail, iCloud und Yahoo verlangen sie zwingend. Am besten als
  Hausaufgabe vor dem Termin, sonst geht die erste halbe Stunde dafür drauf.
- **Senden aus lassen.** Die Voreinstellung im Bundle ist „aus". So kann im Kurs niemand versehentlich
  eine echte Mail an einen echten Empfänger schicken. Zum Vorführen des Versands reicht ein
  vorbereitetes Testpostfach, das an sich selbst schreibt.
- **IMAP muss freigeschaltet sein.** Bei GMX und Web.de ist es standardmäßig aus und muss im
  Webinterface aktiviert werden.
- **Gute erste Aufgaben:** „Was ist heute ungelesen reingekommen?", „Fass mir den längsten Thread der
  Woche zusammen", „Welche Newsletter bekomme ich am häufigsten?". Alle drei sind lesend, brauchen kein
  Senden und zeigen den Nutzen sofort.
- **Deinstallation** geht über Einstellungen → Erweiterungen. Das Passwort wird dabei aus dem
  Schlüsselbund entfernt — ein sauberer Punkt zum Abschluss, wenn Teilnehmer auf Leihgeräten arbeiten.

## Fehlersuche

**`getaddrinfo ENOTFOUND ${user_config.imap_host}`** (behoben in 1.0.1)

Claude Desktop ersetzt die Platzhalter für optionale Felder nicht, wenn man sie im Installationsdialog
leer lässt — der Text `${user_config.imap_host}` kommt dann wörtlich beim Server an und wird als
Hostname im DNS gesucht. Seit 1.0.1 gelten solche Werte als „nicht gesetzt", die automatische Erkennung
greift wie vorgesehen. Wer die Meldung noch sieht, hat eine ältere Version installiert: Extension
deinstallieren, neues Bundle installieren.

**Verbindung klappt, Ordner werden angezeigt, aber jede Suche liefert 0 Mails** (behoben in 1.0.2)

Betraf Strato und potenziell weitere Anbieter. Der Server kündigt IMAP4rev2 an; unter rev2 beantwortet
er aber jede Suche mit einer leeren Ergebnisliste (`* ESEARCH (TAG "8") UID`), obwohl das Postfach voll
ist. Seit 1.0.2 bleibt rev2 ausgeschaltet — IMAP4rev1 versteht jeder Server. Außerdem kommen „die
neuesten N Mails" ohne Filter gar nicht mehr über eine Suche, sondern direkt über die Nachrichtennummern.
Wer rev2 für einen bestimmten Server braucht, setzt in `config.json` unter `imap` den Schalter
`"enableIMAP4rev2": true`.

Ob die Suche gegen ein konkretes Postfach funktioniert, prüft `node test/live.mjs` (rein lesend).

**Die Server-Felder im Installationsdialog bleiben leer — ist das richtig?**

Ja. Der Dialog füllt nichts automatisch aus; die Erkennung passiert erst beim Start des Servers, aus
der eingegebenen Adresse. Die beiden Host-Felder sind nur ein Notausgang für den Fall, dass die
Erkennung scheitert. Was tatsächlich erkannt wurde, zeigt `mail_test_connection` unter
`serverErkanntVia`.

**`Authentication failed` / `LOGIN failed`**

Passwort falsch oder der Anbieter verlangt ein App-Passwort (Gmail, iCloud, Yahoo) — bei GMX und Web.de
ist IMAP zusätzlich standardmäßig deaktiviert und muss im Webinterface freigeschaltet werden.

**Senden schlägt mit „Senden ist deaktiviert" fehl**

Beabsichtigt. Im Installationsdialog den Haken „Senden erlauben" setzen, in `config.json`
`"allowSend": true`, per Umgebungsvariable `MAIL_ALLOW_SEND=true`.

**Falscher Server erkannt**

`mail_detect_provider` mit der Adresse aufrufen — die Antwort zeigt, aus welcher Quelle die Werte
stammen. Notfalls IMAP- und SMTP-Server im Installationsdialog von Hand eintragen.

## Einschränkungen

- **Nur Passwort-Authentifizierung.** Kein OAuth2/XOAUTH2. Postfächer, bei denen der Anbieter Basic Auth
  abgeschaltet hat (viele Microsoft-365-Tenants), lassen sich damit nicht anbinden.
- Volltextsuche macht der IMAP-Server, nicht dieser Wrapper — wie gut `body`/`text` funktioniert, hängt vom Anbieter ab.
- Sehr große Postfächer: `mail_search` holt Kopfdaten für bis zu 200 Treffer pro Aufruf.
- Kein Push/IDLE — Claude sieht neue Mails, wenn es aktiv nachschaut.

## Entwicklung

```bash
npm run build          # nach dist/ kompilieren (Weg B)
npm run watch          # während der Entwicklung
npm run bundle         # .mcpb bauen, inkl. aller Prüfungen (Weg A)
node test/unit.mjs     # Helfer + MailComposer (ohne Netzwerk)
node test/detect.mjs   # Anbieter-Erkennung gegen echte DNS-/Autoconfig-Abfragen
node test/env-matrix.mjs   # Konfiguration über Umgebungsvariablen, 15 Fälle
node test/live.mjs     # gegen das echte Postfach aus config.json, rein lesend
```

Der Live-Test ist der einzige, der einen echten Mailserver fragt. Er vergleicht, was der Server laut
`STATUS` enthält, mit dem, was die Suche findet — Verbindung und Ordnerliste allein beweisen nichts,
wie der Strato-Fehler gezeigt hat. **Vor einem Workshop lohnt es sich, ihn mit einem Postfach jedes
Anbieters laufen zu lassen, den die Teilnehmer voraussichtlich nutzen.**

`test/bundle-libs.ts` wird nicht direkt ausgeführt, sondern von `npm run bundle` gebündelt und gegen
das Bundle gefahren — nur so prüft es das, was tatsächlich ausgeliefert wird.

**Vor jedem Workshop** genügt ein `npm run bundle`: läuft es durch, sind Typen, Bibliotheken im Bundle
und alle Konfigurationswege geprüft.

IMAP-Verbindungen werden pro Account wiederverwendet und nach 5 Minuten Leerlauf geschlossen.
