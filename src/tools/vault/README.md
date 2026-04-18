# vault

Universelles Lese- und Such-Tool fuer den Obsidian-Vault. Liest Notizen, durchsucht Inhalte und Dateien, navigiert die Vault-Struktur, listet Projekte und Daily Notes, und dekodiert Shorthand/Abkuerzungen via Knowledge-System.

## Modi

| Modus | Zweck |
|---|---|
| lesen | Einzelne Datei nach Name, Pfad oder Wikilink lesen |
| suchen | Volltextsuche, Datei-Glob oder Ordnerinhalt auflisten |
| navigation | Vault-Uebersicht (index.md + Top-Level-Ordner) |
| projekte | Alle Projekte mit Datei-Anzahl auflisten |
| projekt_inhalt | Alle Markdown-Dateien eines Projekts auflisten |
| daily | Daily Note lesen oder alle Daily Notes auflisten |
| dekodieren | Freitext-Abkuerzungen und Shorthand via Knowledge-System aufloesen |

## Parameter

| Name | Typ | Pflicht | Modus | Beschreibung |
|---|---|---|---|---|
| `modus` | enum | ja | alle | "lesen", "suchen", "navigation", "projekte", "projekt_inhalt", "daily", "dekodieren" |
| `name` | string | ja | lesen | Dateiname, Pfad oder Wikilink |
| `nur_frontmatter` | string | nein | lesen | "true" = nur YAML-Frontmatter zurueckgeben |
| `abfrage` | string | ja | suchen | Suchbegriff, Regex, Glob-Pattern oder Ordnerpfad |
| `such_modus` | enum | nein | suchen | Sub-Modus: "text" (Default), "dateien" oder "ordner" |
| `ordner` | string | nein | suchen | Suche auf Unterordner begrenzen (vault-relativ) |
| `regex` | string | nein | suchen | "true" = abfrage als Regex interpretieren (nur such_modus=text) |
| `max_treffer` | number | nein | suchen | Max. Treffer pro Datei 1-10, Default 3 (nur such_modus=text) |
| `kontext` | number | nein | suchen | Kontext-Zeilen um Treffer 0-5, Default 1 (nur such_modus=text) |
| `sortierung` | enum | nein | suchen | "relevanz" (Default) oder "datum" (nur such_modus=text) |
| `aenderung_von` | string | nein | suchen | Nur Dateien geaendert ab YYYY-MM-DD (nur such_modus=text) |
| `aenderung_bis` | string | nein | suchen | Nur Dateien geaendert bis YYYY-MM-DD (nur such_modus=text) |
| `projekt` | string | ja | projekt_inhalt | Name des Projekt-Ordners |
| `daily_modus` | enum | nein | daily | "lesen" (Default) oder "auflisten" |
| `datum` | string | nein | daily | Datum YYYY-MM-DD (nur daily_modus=lesen, Default: heute) |
| `abschnitt` | string | nein | daily | Nur diesen H2-Abschnitt zurueckgeben (nur daily_modus=lesen) |
| `text` | string | ja | dekodieren | Freitext zum Dekodieren |
| `limit` | number | nein | lesen, projekt_inhalt, daily | Maximale Anzahl / erste N Zeilen |

## Verhalten

**Lesen:** Sucht zuerst per `resolveNotePath` (Name/Wikilink), dann per `safePath` (exakter Pfad). Optional nur Frontmatter oder erste N Zeilen.

**Suchen — drei Sub-Modi:**
- `text`: Volltextsuche mit optionalem Regex, Kontext-Zeilen, Datums-Filter und Sortierung. ReDoS-Schutz fuer Regex-Patterns.
- `dateien`: Glob-Pattern-Suche (z.B. `*.pdf`, `**/*.md`).
- `ordner`: Ordnerinhalt auflisten (Dateien und Unterordner).

**Navigation:** Liest index.md (case-insensitive) + listet Top-Level-Ordner auf.

**Projekte:** Zaehlt Markdown-Dateien pro Unterordner in Projekte/.

**Projekt-Inhalt:** Listet alle Markdown-Dateien eines Projekts rekursiv auf.

**Daily:** Sub-Modi "lesen" (mit optionalem H2-Abschnitt-Filter) und "auflisten". Erstellt heutige Daily Note automatisch bei Zugriff ohne Datum.

**Dekodieren:** Baut eine Lookup-Map aus Hot Cache + Glossar + People + Projects. Tokenisiert den Eingabetext, ersetzt bekannte Begriffe durch ihre Bedeutung. Gibt dekodierten Text + Aufgeloest-Liste mit Quellenzuordnung zurueck (hot_cache, glossary, people, projects).

## Rueckgabe

**modus=lesen — Erfolg:** Markdown-Inhalt der Datei (raw).
**modus=lesen — Fehler:** `Datei "Feature-Idee" nicht gefunden.`

**modus=suchen, such_modus=text — Erfolg:** `7 Treffer in 3 Dateien fuer "bug":\n\n<Datei> (N Treffer)\n   L12: ...`
**modus=suchen, such_modus=dateien — Erfolg:** `5 Dateien fuer "*.md":\n<Datei>\n...`
**modus=suchen, such_modus=ordner — Erfolg:** `8 Eintraege in Projekte/:\n<Ordner>\n<Datei>\n...`
**modus=suchen — Fehler:** `Fehler: Keine Suchabfrage angegeben`

**modus=navigation — Erfolg:** index.md-Inhalt + Top-Level-Ordner-Liste.

**modus=projekte — Erfolg:** `3 Projekte:\n<Projekt> (N Dateien)\n...`
**modus=projekte — Leer:** `Keine Projekte.`

**modus=projekt_inhalt — Erfolg:** `14 Dateien in "Alpha":\n<Datei>\n...`
**modus=projekt_inhalt — Fehler:** `Projekt "XYZ" existiert nicht.`

**modus=daily, daily_modus=lesen — Erfolg:** Markdown-Inhalt der Daily Note (raw).
**modus=daily, daily_modus=lesen — Fehler:** `Kein Daily Note fuer 2026-04-10.` + Hinweis auf vorhandene Notes.
**modus=daily, daily_modus=auflisten — Erfolg:** `12 Daily Notes:\n<Datum>\n...`

**modus=dekodieren — Erfolg:** Dekodierter Text + Aufgeloest-Liste (`<Original> -> <Bedeutung> [<Quelle>]`).
**modus=dekodieren — Keine Treffer:** `Keine bekannten Begriffe im Text gefunden.`
**modus=dekodieren — Fehler:** `Fehler: Kein Text zum Dekodieren angegeben`

## Abhaengigkeiten

- `node:fs`, `node:path`
- `_lib/vault.ts` (`vaultPath`, `safePath`, `resolveNotePath`, `resolveDir`, `walkMarkdownFiles`, `projectPath`)
- `_lib/config.ts` (`SEARCH_MAX_RESULTS`, `SEARCH_LINE_MAX`, `MAX_FILE_SCAN`, `TOOL_OUTPUT_MAX_CHARS`, `SKIP_DIRS`)
- `_lib/format.ts` (`EMOJI`, `list`, `err`)
- `_lib/daily.ts` (`getOrCreateDailyNote`, `readDailyNote`, `listDailyNotes`)
- `_lib/knowledge.ts` (`buildLookupMap`, `readHotCache`, `readGlossary`, `parseTableEntries`, `readPerson`, `readProject`)
- `_lib/types.ts`

## Beispiele

```json
{ "modus": "lesen", "name": "Feature-Idee" }
{ "modus": "lesen", "name": "[[Projekt-Alpha]]", "nur_frontmatter": "true" }
{ "modus": "lesen", "name": "Inbox/notiz.md", "limit": 20 }
{ "modus": "suchen", "abfrage": "TODO", "ordner": "Projekte" }
{ "modus": "suchen", "abfrage": "error|warning", "regex": "true", "kontext": 2 }
{ "modus": "suchen", "abfrage": "*.pdf", "such_modus": "dateien" }
{ "modus": "suchen", "abfrage": "Projekte/Alpha", "such_modus": "ordner" }
{ "modus": "suchen", "abfrage": "meeting", "aenderung_von": "2026-04-01", "sortierung": "datum" }
{ "modus": "navigation" }
{ "modus": "projekte" }
{ "modus": "projekt_inhalt", "projekt": "Alpha" }
{ "modus": "daily" }
{ "modus": "daily", "datum": "2026-04-15", "abschnitt": "Log" }
{ "modus": "daily", "daily_modus": "auflisten", "limit": 10 }
{ "modus": "dekodieren", "text": "PSR von Max re Phoenix besprechen" }
```
