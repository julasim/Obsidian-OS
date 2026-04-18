# memory

Verwaltet dauerhaftes Wissen im Two-Tier Knowledge System. Tier 1: KNOWLEDGE.md (Hot Cache, ~100 Zeilen Schnellzugriff). Tier 2: knowledge/ (Deep Storage mit glossary.md, people/, projects/, context/).

## Modi

| Modus | Zweck |
|---|---|
| speichern | Info dauerhaft merken mit intelligentem Kategorie-Routing (Default) |
| lesen | Hot Cache (KNOWLEDGE.md) zurueckgeben |
| loeschen | Eintraege per Suchtext aus KNOWLEDGE.md entfernen |
| nachschlagen | Begriff progressiv suchen: Hot Cache, Glossar, People, Projects |
| profil | Personenprofil lesen oder erstellen/aktualisieren |
| glossar | Glossar lesen oder Eintrag hinzufuegen |

## Parameter

| Name | Typ | Pflicht | Modus | Beschreibung |
|---|---|---|---|---|
| `modus` | enum | ja | alle | "speichern", "lesen", "loeschen", "nachschlagen", "profil", "glossar" |
| `eintrag` | string | ja | speichern, loeschen | Text zum Speichern oder Suchtext zum Loeschen |
| `kategorie` | enum | nein | speichern | Routing-Kategorie: "person", "projekt", "begriff", "praeferenz", "kontext". Ohne Kategorie: Freitext in Hot Cache |
| `begriff` | string | ja | nachschlagen | Term zum Nachschlagen |
| `name` | string | ja | profil | Personenname. Nur name = lesen; name + Details = schreiben |
| `rolle` | string | nein | profil | Rolle der Person |
| `team` | string | nein | profil | Team der Person |
| `alias` | string | nein | profil | Spitzname oder Alias |
| `glossar_begriff` | string | ja* | glossar | Begriff fuer das Glossar (*beide leer = ganzes Glossar lesen) |
| `bedeutung` | string | ja* | glossar | Bedeutung des Begriffs (*beide leer = ganzes Glossar lesen) |
| `kontext` | string | nein | glossar | Optionaler Kontext zum Glossar-Eintrag |
| `section` | enum | nein | glossar | Glossar-Section: "Abkuerzungen" (Default), "Interne Begriffe", "Spitznamen", "Projekt-Codenamen" |

## Verhalten

**Kategorie-Routing (modus=speichern):**
- `person` — erstellt Profil in knowledge/people/{slug}.md + Hot-Cache-Zeile
- `projekt` — erstellt Profil in knowledge/projects/{slug}.md + Hot-Cache-Zeile
- `begriff` — fuegt Glossar-Eintrag hinzu + Hot-Cache-Zeile
- `praeferenz` — fuegt Zeile in Hot Cache Section "Praeferenzen" ein
- `kontext` — erstellt Datei in knowledge/context/{slug}.md
- ohne Kategorie — haengt Freitext-Zeile mit Datum an KNOWLEDGE.md an

**Progressiver Lookup (modus=nachschlagen):**
Hot Cache → Glossar → People (Dateiname-Match) → Projects (Dateiname-Match). Stoppt beim ersten Treffer.

**Profil-Logik (modus=profil):**
Nur `name` ohne weitere Felder = Profil lesen. `name` + mindestens ein Detail (rolle/team/alias) = Profil erstellen oder aktualisieren + Hot-Cache-Zeile.

**Glossar-Logik (modus=glossar):**
Ohne Parameter = ganzes Glossar lesen. Mit `glossar_begriff` + `bedeutung` = Eintrag in die gewaehlte Section hinzufuegen + Hot-Cache-Zeile.

**Initialisierung:**
Bei jedem Schreibzugriff wird `ensureKnowledgeStructure()` aufgerufen — erstellt KNOWLEDGE.md (Template mit Sections: Ich, Personen, Begriffe, Projekte, Praeferenzen) und knowledge/ (glossary.md, people/, projects/, context/) falls nicht vorhanden.

## Rueckgabe

**modus=speichern — Erfolg:** `[memory] Wissen gespeichert: <kategorie> — "<eintrag>"`
**modus=speichern — Fehler:** `Fehler: Kein Eintrag angegeben`

**modus=lesen — Erfolg:** Markdown-Inhalt der KNOWLEDGE.md (raw).
**modus=lesen — Leer:** `Kein Wissen vorhanden. KNOWLEDGE.md ist leer.`

**modus=loeschen — Erfolg:** `[memory] Eintrag geloescht: <suchtext> — N Zeile(n) entfernt`
**modus=loeschen — Nicht gefunden:** `Kein Eintrag mit "<suchtext>" in KNOWLEDGE.md gefunden.`
**modus=loeschen — Fehler:** `Fehler: Kein Suchtext zum Loeschen angegeben`

**modus=nachschlagen — Gefunden:** `<term> -> <meaning> (Quelle: <source>)`
**modus=nachschlagen — Unbekannt:** `Unbekannt: <term>. Sag mir was es bedeutet, dann merke ich es mir.`
**modus=nachschlagen — Fehler:** `Fehler: Kein Begriff zum Nachschlagen angegeben`

**modus=profil — Lesen:** Markdown-Inhalt des Profils (raw) oder `Kein Profil fuer "<name>" vorhanden.`
**modus=profil — Schreiben:** `[memory] Profil gespeichert: <name> — <rolle>`
**modus=profil — Fehler:** `Fehler: Kein Name angegeben (name ist Pflicht fuer modus=profil)`

**modus=glossar — Lesen:** Markdown-Inhalt des Glossars (raw) oder `Glossar ist leer.`
**modus=glossar — Schreiben:** `[memory] Glossar-Eintrag hinzugefuegt: <begriff> — <bedeutung>`
**modus=glossar — Fehler:** `Fehler: glossar_begriff und bedeutung sind beide erforderlich`

## Abhaengigkeiten

- `node:fs`
- `_lib/vault.ts` (`ensureDir`, `vaultPath`)
- `_lib/config.ts` (`LOCALE`)
- `_lib/format.ts` (`ok`, `err`)
- `_lib/knowledge.ts` (Two-Tier Knowledge System Primitives)
- `_lib/types.ts`

## Beispiele

```json
{ "modus": "speichern", "eintrag": "User bevorzugt dunklen Modus" }
{ "modus": "speichern", "eintrag": "Max Mustermann", "kategorie": "person" }
{ "modus": "speichern", "eintrag": "Phoenix", "kategorie": "projekt" }
{ "modus": "speichern", "eintrag": "PSR = Pipeline Status Report", "kategorie": "begriff" }
{ "modus": "speichern", "eintrag": "25-Minuten-Meetings", "kategorie": "praeferenz" }
{ "modus": "speichern", "eintrag": "Q2-Planungsrunde Notizen", "kategorie": "kontext" }
{ "modus": "lesen" }
{ "modus": "loeschen", "eintrag": "dunklen Modus" }
{ "modus": "nachschlagen", "begriff": "PSR" }
{ "modus": "profil", "name": "Max Mustermann" }
{ "modus": "profil", "name": "Max Mustermann", "rolle": "Projektleiter", "team": "Engineering" }
{ "modus": "glossar" }
{ "modus": "glossar", "glossar_begriff": "PSR", "bedeutung": "Pipeline Status Report", "section": "Abkuerzungen" }
```
