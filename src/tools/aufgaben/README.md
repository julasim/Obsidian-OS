# aufgaben

Maechtiges Task-Management — 100% Obsidian-Tasks-Plugin-kompatibel. Natural-Language-Input, wiederkehrende Tasks, Tags/Kontext, Subtasks, Dashboard, mehrere Views.

## Modi

| Modus | Zweck |
|---|---|
| `erfassen` | Neue Aufgabe (NLP-Input moeglich, auch Subtasks via parent_text) |
| `auflisten` | Offene Tasks mit Filtern und Ansichten |
| `erledigen` | Aufgabe abhaken (recurring erzeugt naechste Instanz automatisch) |
| `verschieben` | Zwischen Sections verschieben (Aktiv/Warte auf/Irgendwann/Erledigt) |
| `warte_auf` | Warte-Aufgabe mit Person |
| `bearbeiten` | Felder einer bestehenden Task aendern |
| `details` | Detail-Zeilen zu einer Task hinzufuegen/zeigen |
| `bulk` | Mehrere Tasks auf einmal erledigen/verschieben |

## Obsidian-Tasks-Syntax

Das Tool schreibt Tasks im offiziellen Obsidian-Tasks-Format. Alle erzeugten Tasks funktionieren direkt im Obsidian-Tasks-Plugin.

```
- [ ] Task-Text 🔴 🛫 2026-04-20 📅 2026-04-25 ⏳ 2026-04-22 ⏱️ 2h 🔁 every Monday ➕ 2026-04-15 #work @laptop ^task-id
    - Eingeruckte Detail-Zeilen (Subtasks oder Notizen)
```

| Emoji | Bedeutung |
|---|---|
| 🔴 🟠 🟡 🟢 🔵 | Prioritaet hoch/mittel-hoch/mittel/niedrig-mittel/niedrig |
| 🛫 | Start-Datum (Task erscheint erst ab diesem Datum) |
| 📅 | Faelligkeit (due) |
| ⏳ | Scheduled-Datum |
| ➕ | Erstelldatum |
| ✅ | Erledigt-Datum |
| 🔁 | Wiederholungs-Pattern |
| ⏱️ | Zeitschaetzung (Custom) |
| 🔗 | Plan-Referenz (Custom) |
| #tag | Obsidian-Tag |
| @kontext | Context-Marker |
| ^id | Block-ID fuer stabile Referenzen |

## Natural-Language-Parsing

Der `text`-Parameter wird IMMER durch NLP geparst. Erkannt werden:

| Input | Wird zu |
|---|---|
| `heute`, `morgen`, `uebermorgen` | due-Datum |
| `naechsten Montag`, `montag` | naechster Wochentag |
| `in 3 Tagen`, `in 2 Wochen` | Datum |
| `jeden Montag`, `jede Woche`, `jaehrlich` | 🔁 Recurrence |
| `alle 3 Tage` | 🔁 every 3 days |
| `!!!` / `!!` / `!` | Prio hoch/mittel-hoch/mittel |
| `wichtig`, `dringend`, `urgent` | Prio hoch |
| `#tag` | Tag |
| `@kontext` | Kontext |
| `2h`, `30min`, `1d` | ⏱️ Schaetzung |

Strukturierte Parameter (`datum`, `prioritaet`, `tags`, ...) ueberschreiben NLP-Werte.

## Parameter

| Name | Typ | Modi | Beschreibung |
|---|---|---|---|
| `modus` | enum | alle | Pflicht |
| `text` | string | alle | Aufgabentext (NLP) oder Suchtext bei Mutationen |
| `datum` | string | erfassen, bearbeiten | 📅 YYYY-MM-DD |
| `start` | string | erfassen, bearbeiten | 🛫 YYYY-MM-DD |
| `scheduled` | string | erfassen, bearbeiten | ⏳ YYYY-MM-DD |
| `prioritaet` | enum | erfassen, bearbeiten, auflisten (Filter) | hoch/mittel-hoch/mittel/niedrig-mittel/niedrig |
| `wiederholung` | string | erfassen, bearbeiten | 🔁 "jeden Montag", "every week" |
| `schaetzung` | string | erfassen, bearbeiten | ⏱️ "30m", "2h" |
| `tags` | string | erfassen, bearbeiten | Komma-separiert ohne # |
| `kontext` | string | erfassen, bearbeiten | Komma-separiert ohne @ |
| `plan_ref` | string | erfassen, bearbeiten | 🔗 "plan-id#2" |
| `details` | string | erfassen, details | Mehrzeilig mit \n |
| `parent_text` | string | erfassen | Suchtext fuer Parent → Subtask |
| `projekt` | string | erfassen, warte_auf | Shortcut fuer Projekte/<name>/Aufgaben.md |
| `datei` | string | alle | Zieldatei (Default: Aufgaben.md) |
| `ordner` | string | auflisten, bulk | Ordner-Filter |
| `ansicht` | enum | auflisten | default/dashboard/heute/woche/ueberfaellig/projekt/tag/kontext/nach_prio |
| `faellig` | enum | auflisten | heute/ueberfaellig/woche/alle |
| `sortierung` | enum | auflisten | default/nach_prio/nach_datum |
| `tag` | string | auflisten | Filter nach Tag |
| `kontext_filter` | string | auflisten | Filter nach Kontext |
| `person` | string | auflisten, warte_auf | Person-Filter / wen warten |
| `start_respektieren` | string | auflisten | Default 'true' — Tasks mit start>heute ausblenden |
| `limit` | number | auflisten | Default 50 |
| `nach` | enum | verschieben | aktiv/warte_auf/irgendwann/erledigt |
| `neuer_text` | string | bearbeiten | Task-Text ersetzen |
| `tag_action` | enum | bearbeiten | add/remove/set |
| `aktion` | enum | details | hinzufuegen/zeigen |
| `bulk_aktion` | enum | bulk | erledigen/verschieben |
| `bestaetigung` | string | bulk | 'true' bei >20 Tasks |

## Datei-Struktur

Tasks werden in `Aufgaben.md` (oder `Projekte/<name>/Aufgaben.md`) in Sections gespeichert:

```markdown
# Aufgaben

## Aktiv
- [ ] Aktive Task 🔴 📅 2026-04-20

## Warte auf
- [ ] Warte-Task — warte auf Max, seit 2026-04-15

## Irgendwann
- [ ] Spaeter

## Erledigt
- [x] Done ✅ 2026-04-14
```

## Recurring-Verhalten

Wenn eine Task mit 🔁 erledigt wird:
1. Die Task wird mit Status `[x]` + `✅ <heute>` in **## Erledigt** verschoben
2. Eine neue Instanz mit dem naechsten Datum wird in **## Aktiv** erstellt
3. Alle Felder (prio, tags, kontext, recurrence, estimate, plan_ref) werden uebernommen

## Rueckgaben

**Erfolg erfassen:** `✅ Aufgabe erfasst: Aufgaben.md — "Max anrufen", mittel-hoch, faellig 2026-04-20, #work, @telefon`
**Erfolg erledigen (recurring):** `✅ Aufgabe erledigt: Aufgaben.md — "Weekly Review" — Wiederholung: naechste Instanz erstellt`
**Mehrdeutig:** `Mehrere Aufgaben passen zu "X" (3 Treffer). Bitte praeziser: ...`
**Fehler (Validation):** `Fehler: Kein Aufgabentext angegeben.`
**Nicht gefunden:** `Aufgabe mit "X" nicht gefunden.`

## Abhaengigkeiten

- `_lib/vault.ts`, `_lib/config.ts`, `_lib/format.ts`, `_lib/date.ts`
- `_lib/task-model.ts` → Task-Interface, Emojis
- `_lib/task-parser.ts` → Markdown → Task
- `_lib/task-format.ts` → Task → Markdown
- `_lib/natural-language.ts` → NLP-Parser
- `_lib/recurrence.ts` → Recurrence-Berechnung

## Beispiele

### Natural-Language-Erfassung
```json
{ "modus": "erfassen", "text": "morgen 15 Uhr Max anrufen #work @telefon jeden Montag !!" }
```

### Praezise strukturiert
```json
{
  "modus": "erfassen",
  "text": "Prototyp bauen",
  "datum": "2026-04-25",
  "start": "2026-04-20",
  "prioritaet": "hoch",
  "tags": "refactor,prio",
  "schaetzung": "4h",
  "plan_ref": "plan-xyz#2"
}
```

### Subtask
```json
{ "modus": "erfassen", "text": "Auth-Modul", "parent_text": "Prototyp" }
```

### Dashboard
```json
{ "modus": "auflisten", "ansicht": "dashboard" }
```

### Filter nach Kontext
```json
{ "modus": "auflisten", "kontext_filter": "@laptop" }
```

### Bearbeiten
```json
{ "modus": "bearbeiten", "text": "Prototyp", "prioritaet": "hoch", "tag_action": "add", "tags": "urgent" }
```

### Details hinzufuegen
```json
{ "modus": "details", "text": "Prototyp", "details": "Auth-Modul zuerst\nAPI danach" }
```

### Bulk-Erledigen
```json
{ "modus": "bulk", "bulk_aktion": "erledigen", "tag": "done-candidates", "bestaetigung": "true" }
```
