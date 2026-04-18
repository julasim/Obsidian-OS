# notiz

Verwaltet Notizen im Vault: neue Notizen erstellen, bestehende bearbeiten oder loeschen, YAML-Frontmatter setzen und kurze Eintraege in Daily Notes schreiben.

## Modi

| Modus | Zweck |
|---|---|
| speichern | Neue Markdown-Notiz mit Frontmatter anlegen (Inbox, Ordner oder Projekt) |
| bearbeiten | Text anhaengen oder Suchen-und-Ersetzen in bestehender Notiz |
| loeschen | Notiz loeschen (Soft-Delete in .trash/ oder permanent) |
| frontmatter | YAML-Frontmatter-Feld setzen, aktualisieren oder loeschen |
| eintrag | Timestamped-Eintrag unter einem Abschnitt in der Daily Note anhaengen |

## Parameter

| Name | Typ | Pflicht | Modus | Beschreibung |
|---|---|---|---|---|
| `modus` | enum | ja | alle | Betriebsmodus: speichern, bearbeiten, loeschen, frontmatter, eintrag |
| `text` | string | ja | speichern, eintrag | Inhalt der Notiz (Markdown) bzw. des Daily-Eintrags. Bei bearbeiten: Text zum Anhaengen |
| `titel` | string | nein | speichern | Kurzer Titel (2-5 Woerter), wird Dateiname. IMMER angeben |
| `ordner` | string | nein | speichern | Expliziter Zielordner relativ zum Vault |
| `projekt` | string | nein | speichern | Projektname — Shortcut fuer Projekte/{name}/Notizen/ |
| `tags` | string | nein | speichern | Komma-separierte Tags (mindestens 1 empfohlen) |
| `quelle` | string | nein | speichern | Herkunft/Kontext (Default: "extern") |
| `name` | string | ja | bearbeiten, loeschen | Dateiname, Wikilink oder relativer Pfad |
| `suchen` | string | nein | bearbeiten | Suchtext oder Regex-Pattern zum Ersetzen |
| `ersetzen` | string | nein | bearbeiten | Ersetzungstext (Default: leer = loeschen). Nur mit suchen |
| `regex` | string | nein | bearbeiten | Auf "true" setzen wenn suchen ein Regex ist |
| `alle` | string | nein | bearbeiten | Auf "true" setzen um ALLE Vorkommen zu ersetzen |
| `permanent` | string | nein | loeschen | Auf "true" fuer endgueltiges Loeschen (Default: false, Soft-Delete) |
| `pfad` | string | ja | frontmatter | Vault-relativer Pfad zur Datei |
| `schluessel` | string | ja | frontmatter | Frontmatter-Key (z.B. "status", "tags") |
| `wert` | string | nein | frontmatter | Frontmatter-Wert. Leer lassen um Feld zu loeschen |
| `als_array` | string | nein | frontmatter | Auf "true" um Komma-Werte als Array zu speichern |
| `datum` | string | nein | eintrag | Datum YYYY-MM-DD fuer Ziel-Daily-Note (Default: heute) |
| `abschnitt` | string | nein | eintrag | Abschnitt im Daily Note (Default: "Log") |

## Rueckgabe

**modus=speichern — Erfolg:** `📝 Notiz gespeichert: [[Feature-Idee]] — Projekt: WebApp`
**modus=speichern — Inbox:** `📝 Notiz gespeichert: [[Feature-Idee]]`
**modus=speichern — Fehler:** `Fehler: Kein Text angegeben.`

**modus=bearbeiten (Append) — Erfolg:** `📝 Nachtrag gespeichert: [[Projekt-Alpha]]`
**modus=bearbeiten (Ersetzen) — Erfolg:** `📝 Notiz bearbeitet: [[Projekt-Alpha]] — 3x ersetzt, Regex, global`
**modus=bearbeiten — Fehler:** `Datei "XYZ" nicht gefunden.`

**modus=loeschen (Soft) — Erfolg:** `🗑️ Notiz in Papierkorb verschoben: [[Alt-Entwurf]] — .trash/`
**modus=loeschen (Permanent) — Erfolg:** `🗑️ Notiz geloescht: [[Alt-Entwurf]]`
**modus=loeschen — Fehler:** `Datei "XYZ" nicht gefunden.`

**modus=frontmatter (Setzen) — Erfolg:** `🏷️ Frontmatter gesetzt: [[Notiz]] — status = "offen"`
**modus=frontmatter (Loeschen) — Erfolg:** `🏷️ Frontmatter-Feld geloescht: [[Notiz]] — status`
**modus=frontmatter — Fehler:** `Fehler: Kein Pfad angegeben.`

**modus=eintrag — Erfolg:** `📆 Eintrag hinzugefuegt: 2026-04-16 — 14:30 -> Log`
**modus=eintrag — Fehler:** `Fehler: Kein Text angegeben.`

## Abhaengigkeiten

- `node:fs`, `node:path`
- `_lib/vault.ts`, `_lib/config.ts`, `_lib/format.ts`, `_lib/daily.ts`, `_lib/types.ts`

## Beispiele

```json
{ "modus": "speichern", "text": "Idee fuer neues Feature...", "titel": "Feature-Idee", "tags": "idee,feature", "projekt": "WebApp" }
{ "modus": "bearbeiten", "name": "Feature-Idee", "text": "Nachtrag: Prioritaet erhoehen" }
{ "modus": "bearbeiten", "name": "Feature-Idee", "suchen": "alt", "ersetzen": "neu", "alle": "true" }
{ "modus": "loeschen", "name": "Alt-Entwurf" }
{ "modus": "loeschen", "name": "Alt-Entwurf", "permanent": "true" }
{ "modus": "frontmatter", "pfad": "Projekte/WebApp/Notizen/Feature-Idee.md", "schluessel": "status", "wert": "offen" }
{ "modus": "frontmatter", "pfad": "Inbox/Idee.md", "schluessel": "tags", "wert": "idee, feature" }
{ "modus": "eintrag", "text": "Meeting mit Team besprochen" }
{ "modus": "eintrag", "text": "Arzt angerufen", "abschnitt": "Privat", "datum": "2026-04-15" }
```
