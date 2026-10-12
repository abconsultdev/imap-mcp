# IMAP MCP

Lokaler MCP-Server, der Claude Zugriff auf beliebige IMAP-Postfächer gibt und E-Mails über SMTP versendet.
Läuft komplett auf deinem Rechner — Zugangsdaten und Mails verlassen die Maschine nur Richtung deines Mailservers.

Es gibt zwei Wege:

| | [Weg A: Fertiges Bundle](#weg-a-fertiges-bundle) | [Weg B: Aus dem Quellcode](#weg-b-aus-dem-quellcode) |
| --- | --- | --- |
| Für wen | alle, die einfach ihr Postfach anbinden wollen | Entwicklung, mehr als zehn Postfächer, Linux, Claude Code |
| Postfächer | bis zu zwei, mit den [Zehner-Paketen](#mehr-als-zwei-postfächer-die-zehner-pakete) bis zu zehn | beliebig viele |
| Voraussetzungen | nur Claude Desktop (macOS oder Windows) | Node ≥ 18.17, Terminal |
| Installation | Datei doppelklicken, Adresse + Passwort eintippen | klonen, bauen, JSON konfigurieren |
| Server-Einstellungen | automatisch erkannt | automatisch oder von Hand |
| Passwort liegt | im Schlüsselbund des Systems | im Klartext in `config.json` |

---

# Weg A: Fertiges Bundle

Claude Desktop bringt auf macOS und Windows eine eigene Node-Laufzeit mit. Als `.mcpb`-Bundle verpackt
braucht der Server weder Node noch Terminal noch Git.

## Installieren

1. **[`imap-mail.mcpb` herunterladen](https://github.com/abconsultdev/imap-mcp/releases/latest/download/imap-mail.mcpb)**
   (rund 1 MB, dieselbe Datei für macOS und Windows).
2. Die Datei doppelklicken — alternativ ins Claude-Desktop-Fenster ziehen oder unter
   Einstellungen → Erweiterungen → Erweiterte Einstellungen → Erweiterung installieren auswählen.
3. Im Installationsdialog **E-Mail-Adresse** und **Passwort** eintragen. Alle anderen Felder sind optional.
4. Installieren, fertig. Kein Neustart nötig.

Erster Test im Chat: *„Teste die Mail-Verbindung"*.

Das Bundle ist nicht signiert. Claude Desktop kann deshalb beim Installieren auf einen unbekannten
Herausgeber hinweisen.

**Was im Dialog abgefragt wird**

| Feld | |
| --- | --- |
| E-Mail-Adresse | Pflichtfeld |
| Passwort | Pflichtfeld. Landet im **Schlüsselbund** (macOS) bzw. der **Anmeldeinformationsverwaltung** (Windows), nicht in einer Datei |
| Benutzername | optional — leer lassen, wenn man sich mit der E-Mail-Adresse anmeldet. Nur ausfüllen, wenn der Anbieter einen eigenen Anmeldenamen vergibt (siehe [unten](#vor-der-einrichtung)) |
| Senden erlauben | Standardmäßig **aus** — Claude kann dann lesen und Entwürfe anlegen, aber nichts verschicken |
| Absendername | optional |
| Zweites Postfach: Adresse, Passwort, Benutzername, Senden, Absendername | optional — leer lassen, wenn nur ein Postfach gebraucht wird |
| Server online nachschlagen | siehe [Server-Erkennung](#wie-die-server-erkennung-funktioniert) |
| IMAP-/SMTP-Server (je Postfach) | leer lassen, nur nötig, wenn die Erkennung scheitert |

Anhänge landen im Downloads-Ordner.

## Vor der Einrichtung

Die meisten Probleme entstehen nicht im Connector, sondern beim Mail-Anbieter:

- **Gmail, iCloud, Yahoo:** Das normale Passwort wird abgelehnt. Nötig ist ein App-Passwort aus den
  Kontoeinstellungen, bei Gmail zusätzlich aktivierte Zwei-Faktor-Anmeldung.
- **GMX, Web.de:** IMAP ist standardmäßig aus und muss im Webmail unter Einstellungen freigeschaltet werden.
- **Hotmail, Outlook.com, Live, MSN: werden nicht unterstützt.** Microsoft lässt bei privaten Konten seit
  September 2024 keine Anmeldung per Passwort mehr zu, auch nicht mit App-Passwort, sondern nur noch
  OAuth2. Daran ändert auch der Schalter „IMAP erlauben“ im Microsoft-Konto nichts; der Server antwortet
  mit „LOGIN failed“ bzw. „Login disabled“. Ausweg: die Mails an ein anderes Postfach weiterleiten.
- **Microsoft 365 (Firmenkonten):** Viele Organisationen haben die Anmeldung per Passwort ebenfalls
  abgeschaltet. Dann lässt sich das Postfach mit diesem Connector nicht anbinden (siehe [Einschränkungen](#einschränkungen)).
- **Anmeldename ist nicht die Adresse:** Manche Anbieter und viele Firmenserver vergeben eigene
  Benutzernamen, etwa `m0123456` bei All-Inkl oder einen Windows-Anmeldenamen bei Exchange. Den dann im
  Feld **Benutzername** eintragen (im Zehner-Paket mit Sammelfeldern: **Abweichende Benutzernamen**); er gilt für IMAP und SMTP. Die Server werden trotzdem aus der
  Adresse erkannt.
- **Eigene Domain:** Funktioniert in der Regel ohne weitere Angaben, weil der Anbieter über den
  MX-Eintrag der Domain erkannt wird.

Wer vorab wissen will, ob eine Adresse erkannt wird, kann Claude mit `mail_detect_provider` fragen —
das braucht weder Passwort noch Anmeldung.

Wo der Anbieter App-Passwörter anbietet, lohnen sie sich auch ohne Pflicht: Sie lassen sich einzeln
widerrufen, ohne das Postfach-Passwort zu ändern.

## Erste Schritte

Gute erste Fragen, die nur lesen und nichts verändern:

- *„Was ist heute ungelesen reingekommen?"*
- *„Fass mir den längsten Mailverlauf dieser Woche zusammen."*
- *„Von welchen Newslettern bekomme ich am meisten Mails?"*

Senden bleibt so lange aus, bis es im Dialog freigegeben wird. Wer den Versand ausprobieren will,
schickt die erste Testmail am besten an die eigene Adresse.

## Zwei Postfächer

Im Dialog lassen sich bis zu zwei Postfächer einrichten, auch bei verschiedenen Anbietern. Jedes wird
getrennt erkannt, und **Senden wird je Postfach einzeln freigegeben**: Man kann etwa das private
Postfach nur lesbar lassen und nur im geschäftlichen den Versand erlauben.

Sobald zwei eingerichtet sind, nennt Claude das Postfach bei jedem Zugriff über seine Adresse. Fehlt
diese Angabe, kommt eine Rückfrage statt einer stillen Annahme — das zählt vor allem beim Senden, damit
keine Mail vom falschen Absender rausgeht. Im Chat reicht es, das Postfach beim Namen zu nennen:
*„Was ist heute im Geschäftspostfach reingekommen?"*

## Mehr als zwei Postfächer: die Zehner-Pakete

Für bis zu zehn Postfächer gibt es zwei eigene Pakete mit demselben Funktionsumfang. Sie unterscheiden
sich nur darin, wie der Installationsdialog aufgebaut ist:

| | Felder je Postfach | Sammelfelder |
| --- | --- | --- |
| Download | **[`imap-mail-10-einzeln.mcpb`](https://github.com/abconsultdev/imap-mcp/releases/latest/download/imap-mail-10-einzeln.mcpb)** | **[`imap-mail-10.mcpb`](https://github.com/abconsultdev/imap-mcp/releases/latest/download/imap-mail-10.mcpb)** |
| Dialog | wie im Standard-Paket, nur zehnmal: jedes Postfach hat eigene Felder | je Postfach nur Adresse und Passwort, Sonderfälle in wenigen gemeinsamen Feldern |
| Felder | 71, langer Dialog | 25, kurzer Dialog |
| Geeignet für | alle, die nichts in Listen tippen möchten | viele Postfächer, die bis auf Adresse und Passwort nichts brauchen |

### Felder je Postfach (`imap-mail-10-einzeln.mcpb`)

Für jedes der zehn Postfächer gibt es dieselben Felder wie im Standard-Paket: Adresse, Passwort,
Benutzername, „Senden erlauben", Absendername und — gesammelt am Ende des Dialogs — IMAP- und
SMTP-Server. Nicht benötigte Postfächer bleiben einfach leer.

### Sammelfelder (`imap-mail-10.mcpb`)

Hier stehen je Postfach nur Adresse und Passwort. Alles, was man selten braucht, steht darunter in
wenigen gemeinsamen Feldern, in denen jeder Eintrag mit der Adresse des Postfachs beginnt:

| Feld | |
| --- | --- |
| Postfach 1: E-Mail-Adresse, Passwort | Pflichtfelder |
| Postfach 2–10: E-Mail-Adresse, Passwort | optional — leer lassen, was nicht gebraucht wird |
| Senden erlauben für | Adressen mit Komma getrennt, z.B. `info@firma.de, anna@web.de`, oder `alle`. **Leer = aus** |
| Absendernamen | optional: `info@firma.de = Firma GmbH; anna@web.de = Anna Beispiel` |
| Abweichende Benutzernamen | optional, nur wenn der Anmeldename nicht die Adresse ist: `info@firma.de = m0123456` |
| Server von Hand | leer lassen, nur nötig, wenn die Erkennung scheitert: `info@firma.de = imap.firma.de, smtp.firma.de` |
| Server online nachschlagen | wie im Standard-Paket |

In den gemeinsamen Feldern trennt ein **Semikolon** die Postfächer, so dürfen Namen Kommas enthalten
(`anna@web.de = Beispiel, Anna`). Groß- und Kleinschreibung der Adresse spielt keine Rolle. Steht dort
eine Adresse, die oben nicht eingetragen ist, startet der Connector nicht, sondern meldet genau diese
Zeile — ein Tippfehler bleibt also nicht unbemerkt.

### Nur ein Paket installieren

Claude Desktop führt alle drei Pakete als getrennte Erweiterungen; mehrere zugleich würden jedes
Werkzeug doppelt anbieten. Wer wechselt, deinstalliert das alte Paket vorher.

Mehr als zehn gehen über ein Bundle nicht, weil das Manifest-Format keine beliebig langen Feldlisten
kennt. Über `config.json` (Weg B) ist die Zahl unbegrenzt.

## Wie die Server-Erkennung funktioniert

Niemand muss seinen IMAP-Server kennen. Der Connector probiert der Reihe nach:

1. **Eingebaute Anbieterliste** — Gmail, GMX, Web.de, T-Online, Posteo, mailbox.org, iCloud, Yahoo,
   Outlook und weitere, erkannt an der Domain der Adresse.
2. **MX-Eintrag der Domain** — der wichtigste Fall bei eigenen Domains. `info@meinefirma.de` mit einem
   MX-Eintrag auf `smtpin.rzone.de` wird als Strato-Postfach erkannt. Deckt Strato, IONOS, All-Inkl,
   Hetzner, netcup, domainFACTORY, united-domains, Google Workspace und Microsoft 365 ab.
3. **Mozillas Autoconfig-Datenbank** — dieselbe Quelle, aus der Thunderbird seine Einstellungen zieht.
4. **Raten** aus der Domain (`imap.<domain>`), klar als unbestätigt gekennzeichnet.

Schritte 2 und 3 brauchen Netzwerk und fragen dabei **nur die Domain** ab, nie die Adresse oder das
Passwort. Wer das nicht möchte, schaltet „Server online nachschlagen" aus; dann greift nur die
eingebaute Liste, und seltenere Anbieter müssen von Hand eingetragen werden.

## Aktualisieren und entfernen

**Update:** Unter Einstellungen → Erweiterungen die alte Version deinstallieren, dann die neue Datei
installieren. Die Zugangsdaten werden dabei neu abgefragt.

**Entfernen:** Ebenfalls über Einstellungen → Erweiterungen. Die Passwörter werden dabei aus dem
Schlüsselbund gelöscht, es bleiben keine Zugangsdaten auf dem Rechner zurück.

---

# Weg B: Aus dem Quellcode

## 1. Installieren

```bash
git clone https://github.com/abconsultdev/imap-mcp.git
cd imap-mcp && npm install && npm run build
```

## 2. Konfigurieren

`config.example.json` nach `config.json` kopieren und ausfüllen. Die Datei enthält Passwörter im
Klartext und steht deshalb in `.gitignore`.

```json
{
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
| `name` | Kurzname, den du im Chat benutzt (*„lies die Mails im hauptpostfach"*) |
| `displayName` | Absendername im From-Header |
| `imap.user`, `smtp.user` | Anmeldename, meist die Adresse. Weicht er ab, hier eintragen |
| `allowSend` | `false` = reiner Lesezugriff, `mail_send` verweigert dann den Dienst |
| `secure` | `true` bei Port 993/465 (direktes TLS), `false` bei 143/587 (STARTTLS) |
| `allowInvalidCert` | nur für interne Server mit selbstsigniertem Zertifikat |
| `enableIMAP4rev2` | IMAP4rev2 nutzen, falls der Server es anbietet. Standard aus, siehe [Fehlersuche](#fehlersuche) |
| `mailboxes` | optional, überschreibt die Auto-Erkennung von Gesendet/Entwürfe/Papierkorb |
| `downloadDir` | (oberste Ebene) Ordner für Anhänge, Standard `<projekt>/downloads` |

Mehrere Postfächer: einfach weitere Objekte in `accounts` eintragen. Bei mehr als einem Account
verlangt jedes Tool den Parameter `account`.

### Gängige Server

| Anbieter | IMAP | SMTP | Hinweis |
| --- | --- | --- | --- |
| Gmail / Workspace | `imap.gmail.com:993` | `smtp.gmail.com:465` | App-Passwort nötig (2FA erforderlich) |
| Microsoft 365 | `outlook.office365.com:993` | `smtp.office365.com:587` (`secure: false`) | Passwort-Anmeldung oft gesperrt, siehe Einschränkungen |
| Hotmail / Outlook.com | — | — | nicht unterstützt, nur OAuth2 möglich |
| IONOS | `imap.ionos.de:993` | `smtp.ionos.de:465` | |
| Strato | `imap.strato.de:993` | `smtp.strato.de:465` | |
| All-Inkl | `<server>.kasserver.com:993` | `<server>.kasserver.com:465` | |
| mailbox.org | `imap.mailbox.org:993` | `smtp.mailbox.org:465` | eigenes App-Passwort empfohlen |
| GMX / Web.de | `imap.gmx.net:993` / `imap.web.de:993` | `mail.gmx.net:465` / `smtp.web.de:465` | IMAP muss in den Einstellungen freigeschaltet sein |

### Alternative: Umgebungsvariablen

Ohne `config.json` genügen `MAIL_EMAIL` und `MAIL_PASSWORD` für einen Account — die Server werden dann
automatisch erkannt. Das ist auch der Weg, den das `.mcpb`-Bundle nutzt. **Umgebungsvariablen haben
Vorrang vor `config.json`.**

| Variable | |
| --- | --- |
| `MAIL_EMAIL`, `MAIL_PASSWORD` | Pflicht |
| `MAIL2_EMAIL`, `MAIL2_PASSWORD` … `MAIL10_EMAIL`, `MAIL10_PASSWORD` | weitere Postfächer |
| `MAIL_ALLOW_SEND_FOR` | Adressen, die senden dürfen, mit Komma getrennt, oder `alle`. **Standard: keine** |
| `MAIL_DISPLAY_NAMES` | `adresse = Name; adresse = Name` |
| `MAIL_USERNAMES` | `adresse = Benutzername; …`, nur wo der Anmeldename nicht die Adresse ist |
| `MAIL_SERVERS` | `adresse = imap-server, smtp-server; …`, überschreibt die Erkennung. Ein Server gilt für beides, `:port` ist erlaubt |
| `MAIL_AUTODETECT_ONLINE` | `false` schaltet MX- und Online-Abfrage ab (gilt für alle) |
| `MAIL_DOWNLOAD_DIR` | Ordner für Anhänge, Standard `~/Downloads` |
| `IMAP_MCP_CONFIG` | abweichender Pfad zur `config.json` |

Einzeln je Postfach gehen weiterhin `MAIL_USER`, `MAIL_DISPLAY_NAME`, `MAIL_ALLOW_SEND`, `MAIL_IMAP_HOST`,
`MAIL_SMTP_HOST`, `MAIL_IMAP_PORT`, `MAIL_SMTP_PORT` und dasselbe mit `MAIL2_` bis `MAIL10_`. Sie haben Vorrang
vor den gemeinsamen Variablen; fürs Senden genügt eine der beiden Freigaben.

Werte, die noch einen unersetzten Platzhalter der Form `${...}` enthalten, werden als *nicht gesetzt*
behandelt. Die älteren Namen `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`, `IMAP_PORT`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` funktionieren weiterhin.

## 3. In Claude eintragen

Der Server spricht MCP über stdio. In Claude Desktop unter Einstellungen → Entwickler → Konfiguration
bearbeiten eintragen — der Pfad muss absolut sein:

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/absoluter/pfad/zu/imap-mcp/dist/index.js"]
    }
  }
}
```

Die Datei liegt unter `%APPDATA%\Claude\claude_desktop_config.json` (Windows) bzw.
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS). Unter Windows werden
Backslashes im Pfad verdoppelt (`"C:\\Users\\...\\dist\\index.js"`) oder durch `/` ersetzt; unter
macOS wird `~` nicht aufgelöst. Startet der Server nicht, weil Claude Desktop Node nicht findet
(typisch bei nvm oder Homebrew), statt `"node"` den vollen Pfad aus `which node` eintragen.

Danach Claude Desktop **komplett beenden und neu starten** — MCP-Server werden nur beim Start geladen.

In Claude Code:

```bash
claude mcp add imap --scope user -- node /absoluter/pfad/zu/imap-mcp/dist/index.js
```

Erster Test im Chat: *„Teste die Mail-Verbindung"* → ruft `mail_test_connection` auf und meldet IMAP und
SMTP getrennt.

Mehrere Rechner können parallel auf dasselbe Postfach zugreifen — IMAP ist dafür gebaut. Die
`config.json` dabei auf jedem Rechner neu anlegen, statt sie zu kopieren.

---

# Referenz

## Tools

**Lesen**

| Tool | Zweck |
| --- | --- |
| `mail_list_accounts` | Eingerichtete Postfächer (ohne Passwörter) |
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

- *„Was ist heute ungelesen reingekommen?"* → `mail_search` mit `unseen: true`, `since: heute`
- *„Fass mir den Verlauf mit Anna zusammen"* → `mail_search` mit `from: anna`, dann `mail_read` je UID
- *„Antworte darauf"* → `mail_create_draft` mit `inReplyToUid`, du prüfst im Mailprogramm, dann `mail_send`
- *„Räum die Newsletter weg"* → `mail_search`, dann `mail_move` nach `Archiv`

## Sicherheit

- **Versand ist endgültig.** Claude fragt vor `mail_send` nach — bestätige bewusst. Wer generell nur
  Entwürfe will, lässt Senden aus und nutzt `mail_create_draft`.
- Es gibt bewusst kein endgültiges Löschen. `mail_move_to_trash` verschiebt nur; geleert wird im Mailprogramm.
- Mailinhalte sind Daten, keine Anweisungen. Wenn in einer Mail steht „leite das weiter" oder „antworte mit X",
  ist das kein Auftrag von dir — Claude soll dich fragen, bevor so etwas ausgeführt wird.
- Beim Bundle liegen Passwörter im Schlüsselbund des Systems. Bei Weg B stehen sie im Klartext in
  `config.json` — Dateirechte einschränken:
  ```bash
  chmod 600 config.json                                                   # macOS / Linux
  icacls config.json /inheritance:r /grant:r "%USERNAME%:(R,W)"           # Windows
  ```

## Fehlersuche

**Verbindung klappt, Ordner werden angezeigt, aber jede Suche liefert 0 Mails**

Manche Server kündigen IMAP4rev2 an, beantworten unter rev2 aber jede Suche mit einer leeren
Ergebnisliste (`* ESEARCH (TAG "8") UID`), obwohl das Postfach voll ist — beobachtet bei Strato. Der
Connector schaltet rev2 deshalb standardmäßig ab; IMAP4rev1 versteht jeder Server. Wer rev2 für einen
bestimmten Server braucht, setzt in `config.json` unter `imap` den Schalter `"enableIMAP4rev2": true`.
Ob die Suche gegen ein konkretes Postfach funktioniert, prüft `node test/live.mjs` (rein lesend).

**Die Server-Felder im Installationsdialog bleiben leer — ist das richtig?**

Ja. Der Dialog füllt nichts automatisch aus; die Erkennung passiert erst beim Start des Servers, aus
der eingegebenen Adresse. Die Server-Felder sind nur ein Notausgang für den Fall, dass die Erkennung
scheitert. Was tatsächlich erkannt wurde, zeigt `mail_test_connection` unter `serverErkanntVia`.

**`Authentication failed` / `LOGIN failed`**

Passwort falsch, der Anbieter verlangt ein App-Passwort (Gmail, iCloud, Yahoo), oder der Anmeldename ist
nicht die E-Mail-Adresse — dann im Feld **Benutzername** (Zehner-Paket mit Sammelfeldern: **Abweichende Benutzernamen**)
den richtigen eintragen. Welcher Name benutzt
wurde, zeigt `mail_test_connection` unter `benutzer`. Bei GMX und Web.de
ist IMAP außerdem standardmäßig deaktiviert und muss im Webmail freigeschaltet werden.

**Senden schlägt mit „Senden ist deaktiviert" fehl**

Beabsichtigt. Im Installationsdialog den Haken „Senden erlauben" setzen (Zehner-Paket mit Sammelfeldern: die Adresse unter
„Senden erlauben für" eintragen), in `config.json` `"allowSend": true`, per Umgebungsvariable
`MAIL_ALLOW_SEND=true` oder `MAIL_ALLOW_SEND_FOR=adresse`.

**Falscher Server erkannt**

`mail_detect_provider` mit der Adresse aufrufen — die Antwort zeigt, aus welcher Quelle die Werte
stammen. Notfalls die Server im Installationsdialog von Hand eintragen.

**`getaddrinfo ENOTFOUND ${user_config.imap_host}`**

Tritt nur mit Versionen vor 1.0.1 auf. Alte Erweiterung deinstallieren, aktuelle installieren.

## Einschränkungen

- **Nur Passwort-Authentifizierung.** Kein OAuth2/XOAUTH2. Postfächer, bei denen der Anbieter die
  Passwort-Anmeldung abgeschaltet hat, lassen sich damit nicht anbinden. Das betrifft **alle privaten
  Microsoft-Konten** (Hotmail, Outlook.com, Live, MSN; seit September 2024) und viele Microsoft-365-Organisationen.
  Ein Wechsel zu Microsoft 365 hilft nicht: Beim Umzug auf ein **Business-Konto** wird die Hotmail-Adresse
  nicht übernommen, es entsteht eine neue `…onmicrosoft.com`-Adresse. Ein **persönliches** Microsoft-365-Abo
  behält die Adresse zwar, bleibt aber ein privates Microsoft-Konto — es lässt sich weder mit diesem
  Connector anbinden noch über die Microsoft-365-Connectoren von Claude oder ChatGPT.
- Die Volltextsuche macht der IMAP-Server, nicht dieser Connector — wie gut `body`/`text` funktioniert,
  hängt vom Anbieter ab.
- `mail_search` holt Kopfdaten für bis zu 200 Treffer pro Aufruf.
- Kein Push/IDLE — Claude sieht neue Mails, wenn es aktiv nachschaut.

## Entwicklung

```bash
npm run build              # nach dist/ kompilieren (Weg B)
npm run watch              # während der Entwicklung
npm run bundle             # alle drei .mcpb-Pakete nach build/, inkl. aller Prüfungen (Weg A)
node test/unit.mjs         # Helfer + MailComposer (ohne Netzwerk)
node test/detect.mjs       # Anbieter-Erkennung: Liste, MX-Muster, Autoconfig
node test/env-matrix.mjs   # Konfiguration über Umgebungsvariablen, 39 Fälle
node test/live.mjs         # gegen das echte Postfach aus config.json, rein lesend
```

**Drei Pakete, ein Server:** `imap-mail.mcpb`, `imap-mail-10.mcpb` und `imap-mail-10-einzeln.mcpb` enthalten
denselben Server und unterscheiden sich nur im Manifest (`manifest.json`, `manifest-10.json`,
`manifest-10-einzeln.json`), also im Installationsdialog. Der Server versteht beide Arten von Feldern.
`manifest-10-einzeln.json` wird von `scripts/manifest-10-einzeln.mjs` aus `manifest.json` erzeugt (läuft bei
`npm run bundle` mit) und wird nicht von Hand bearbeitet. Die Konfigurationsmatrix liest die Felder direkt
aus allen drei Manifesten.

**Das Bundle** wird mit esbuild zu einer einzigen JavaScript-Datei gebündelt: vier Dateien statt rund
5000, knapp 1 MB statt 6 MB. Ohne Bündelung lägen Typdeklarationen, Sourcemaps und die HTTP-Transporte
des MCP-SDK im Bundle, die ein stdio-Server nie lädt.

Bündeln kann dynamisch nachgeladene Module zerreißen — `iconv-lite` lädt Zeichensatz-Tabellen zur
Laufzeit, `mailparser` und `MailComposer` ziehen Module über `require()` herein. Ein solcher Bruch fiele
sonst erst beim ersten Umlaut in einer echten Mail auf. Deshalb prüft `npm run bundle` sein eigenes
Ergebnis, bevor gepackt wird: Zeichensatz-Umwandlung, Anhänge, Mail-Aufbau und die komplette
Konfigurationsmatrix laufen gegen die gebündelte Datei (`test/bundle-libs.ts` wird dafür eigens
mitgebündelt). Schlägt eine Prüfung fehl, entsteht kein `.mcpb`. Mit `npm run bundle -- --skip-checks`
lässt sich das überspringen.

**Der Live-Test** ist der einzige, der einen echten Mailserver fragt. Er vergleicht, was der Server laut
`STATUS` enthält, mit dem, was die Suche findet — eine erfolgreiche Verbindung und eine vollständige
Ordnerliste allein beweisen nicht, dass die Suche funktioniert. Vor einer neuen Version lohnt es sich,
ihn mit Postfächern der wichtigsten Anbieter laufen zu lassen. Die MX-Erkennung einer eigenen Domain
lässt sich live mit `TEST_MX_EMAIL=name@domain.de node test/detect.mjs` prüfen.

IMAP-Verbindungen werden pro Account wiederverwendet und nach 5 Minuten Leerlauf geschlossen.

## Versionen

| Version | |
| --- | --- |
| 1.4.0 | Drittes Paket `imap-mail-10-einzeln.mcpb`: bis zu zehn Postfächer, jedes mit eigenen Feldern wie im Standard-Paket. Behoben: Gelesen-Status (`seen`) war immer `false`, `markSeen` markierte nicht als gelesen, Sonderordner wurden nicht über SPECIAL-USE erkannt |
| 1.3.1 | Klarer Hinweis, dass Hotmail, Outlook.com, Live und MSN nicht unterstützt werden (Microsoft erlaubt dort nur noch OAuth2) |
| 1.3.0 | Zusätzliches Zehner-Paket `imap-mail-10.mcpb`: bis zu zehn Postfächer, Senden, Absendernamen, Benutzernamen und Server in gemeinsamen Feldern. Das Standard-Paket bleibt unverändert |
| 1.2.0 | Eigener Benutzername, falls er nicht der E-Mail-Adresse entspricht |
| 1.1.0 | Zweites Postfach im Installationsdialog, Senden je Postfach getrennt |
| 1.0.2 | IMAP4rev2 standardmäßig aus (leere Suchergebnisse bei Strato); neueste Mails ohne Suche |
| 1.0.1 | Leer gelassene Dialogfelder kamen als Platzhalter an und verhinderten die Server-Erkennung |
| 1.0.0 | Erste Version |

## Lizenz

MIT — siehe [LICENSE](LICENSE).
