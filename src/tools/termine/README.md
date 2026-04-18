# termine

Verwaltet Kalendertermine im Vault. Erstellt Termine mit Datum, optionaler Uhrzeit und Ort, und listet Termine mit Datumsfilter auf.

## Modi

| Modus | Zweck |
|---|---|
| erfassen | Neuen Termin mit Datum, Zeit, Ort anlegen |
| auflisten | Termine auflisten mit Datumsbereich-Filter |

## Parameter

| Name | Typ | Pflicht | Modus | Beschreibung |
|---|---|---|---|---|
| `modus` | enum | ja | alle | Betriebsmodus: erfassen oder auflisten |
| `datum` | string | ja | erfassen | Datum YYYY-MM-DD |
| `text` | string | ja | erfassen | Terminbeschreibung |
| `zeit` | string | nein | erfassen | Startzeit HH:MM |
| `endZeit` | string | nein | erfassen | Endzeit HH:MM (nur mit zeit) |
| `ort` | string | nein | erfassen | Ort/Raum |
| `datei` | string | nein | erfassen | Zieldatei vault-relativ (Default: Termine.md) |
| `von` | string | nein | auflisten | Startdatum YYYY-MM-DD inklusiv (Default: heute) |
| `bis` | string | nein | auflisten | Enddatum YYYY-MM-DD inklusiv |
| `alle` | string | nein | auflisten | Auf "true" um ALLE Termine zu zeigen inkl. vergangene |
| `limit` | number | nein | auflisten | Max. Anzahl (Default: 50) |

## Rueckgabe

**modus=erfassen — Erfolg:** `📅 Termin erfasst: Termine.md — 2026-04-20 14:00-15:00 Kickoff (Buero 3)`
**modus=erfassen — Ganztaegig:** `📅 Termin erfasst: Termine.md — 2026-04-20 ganztaegig Feiertag`
**modus=erfassen — Fehler:** `Fehler: Datum muss YYYY-MM-DD sein, bekommen: "morgen".`
**modus=erfassen — Fehler:** `Fehler: Kein Termintext angegeben.`
**modus=erfassen — Fehler:** `Fehler: Endzeit ohne Startzeit ist nicht erlaubt.`

**modus=auflisten — Erfolg:** `5 Termine (ab heute):\n📅 2026-04-16 14:00 Teammeeting 📍 Buero 3 — Termine.md:5\n📅 2026-04-18 Feiertag — Termine.md:8\n...`
**modus=auflisten — Gefiltert:** `3 Termine (ab 2026-04-20, bis 2026-04-30):\n📅 ...`
**modus=auflisten — Leer:** `Keine Termine.`

## Abhaengigkeiten

- `node:fs`, `node:path`
- `_lib/vault.ts`, `_lib/config.ts`, `_lib/format.ts`, `_lib/types.ts`

## Beispiele

```json
{ "modus": "erfassen", "datum": "2026-04-20", "text": "Kickoff-Meeting", "zeit": "14:00", "endZeit": "15:00", "ort": "Buero 3" }
{ "modus": "erfassen", "datum": "2026-05-01", "text": "Feiertag" }
{ "modus": "auflisten" }
{ "modus": "auflisten", "von": "2026-04-20", "bis": "2026-04-30" }
{ "modus": "auflisten", "alle": "true", "limit": 100 }
```
