# export

Exportiert eine Vault-Notiz als PDF oder DOCX. PDF erzeugt fixierte Druckausgabe mit Headings, Listen, Checkboxen, Tabellen, Codeblocks, Blockquotes und Seitenzahlen. DOCX erzeugt ein bearbeitbares Word-Dokument.

## Modi

| Format | Zweck |
|---|---|
| pdf | Fixierte Druckausgabe via pdfkit |
| docx | Bearbeitbares Word-Dokument via docx-npm |

## Parameter

| Name | Typ | Pflicht | Modus | Beschreibung |
|---|---|---|---|---|
| `format` | enum | ja | alle | Ausgabeformat: "pdf" oder "docx" |
| `name` | string | ja | alle | Dateiname, Pfad oder Wikilink der zu exportierenden Notiz |
| `ausgabe` | string | nein | alle | Optionaler Ausgabeordner (vault-relativ). Default: EXPORT_DIR aus ENV |

## Rueckgabe

**format=pdf — Erfolg:** `📤 PDF exportiert: "Feature-Idee" — ./exports/Feature-Idee.pdf`
**format=docx — Erfolg:** `📤 DOCX exportiert: "Feature-Idee" — ./exports/Feature-Idee.docx`
**Fehler (Nicht gefunden):** `Datei "XYZ" nicht gefunden.`
**Fehler (Validation):** `Fehler: Kein Name angegeben.`
**Fehler (Format):** `Fehler: Unbekanntes Format: "txt". Erlaubt: pdf, docx.`
**Fehler (Export):** `Fehler: PDF-Export fehlgeschlagen: <details>.`

## Abhaengigkeiten

- `node:fs`, `node:path`
- `_lib/vault.ts`, `_lib/config.ts`, `_lib/format.ts`, `_lib/note-content.ts`, `_lib/types.ts`
- **pdfkit** (npm-Paket, nur fuer format=pdf)
- **docx** (npm-Paket, nur fuer format=docx)

## Beispiele

```json
{ "format": "pdf", "name": "Feature-Idee" }
{ "format": "docx", "name": "[[Projekt-Alpha]]" }
{ "format": "pdf", "name": "Projekte/WebApp/Notizen/Konzept.md", "ausgabe": "exports/WebApp" }
```
