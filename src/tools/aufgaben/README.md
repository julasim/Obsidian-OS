# aufgaben

Verwaltet Aufgaben im Vault mit Section-basierter Struktur. Unterstuetzt Erfassen, Auflisten, Erledigen (Strikethrough + Datum + Verschieben nach Erledigt), Verschieben zwischen Sections und Warte-auf-Tracking.

## Modi

| Modus | Zweck |
|---|---|
| erfassen | Neue Checkbox-Aufgabe in Section "Aktiv" anlegen |
| auflisten | Offene Aufgaben mit Filtern auflisten |
| erledigen | Aufgabe abhaken, durchstreichen und nach "Erledigt" verschieben |
| verschieben | Aufgabe zwischen Sections (Aktiv, Warte auf, Irgendwann) verschieben |
| warte_auf | Warte-Aufgabe mit Person und Datum in Section "Warte auf" anlegen |

## Parameter

| Name | Typ | Pflicht | Modus | Beschreibung |
|---|---|---|---|---|
| `modus` | enum | ja | alle | "erfassen", "auflisten", "erledigen", "verschieben", "warte_auf" |
| `text` | string | ja | erfassen, erledigen, verschieben, warte_auf | Aufgabentext (erfassen/warte_auf) oder Suchtext (erledigen/verschieben) |
| `datum` | string | nein | erfassen | Faelligkeitsdatum YYYY-MM-DD |
| `prioritaet` | enum | nein | erfassen, auflisten | "hoch", "mittel", "niedrig". Bei erfassen: Emoji. Bei auflisten: Filter |
| `projekt` | string | nein | erfassen, warte_auf | Projektname — Shortcut fuer Projekte/{name}/Aufgaben.md |
| `datei` | string | nein | erfassen, erledigen, verschieben, warte_auf | Explizite Zieldatei vault-relativ (Default: Aufgaben.md) |
| `ordner` | string | nein | auflisten | Nur Aufgaben aus diesem Ordner |
| `faellig` | enum | nein | auflisten | "heute", "ueberfaellig", "woche", "alle" (Default) |
| `limit` | number | nein | auflisten | Max. Anzahl (Default: 50) |
| `nach` | enum | nein | verschieben | Ziel-Section: "aktiv", "warte_auf", "irgendwann" |
| `person` | string | ja | warte_auf | Auf wen gewartet wird |

## Verhalten

**Section-Struktur in Aufgaben.md:**
Jede Aufgabendatei hat vier H2-Sections: `## Aktiv`, `## Warte auf`, `## Irgendwann`, `## Erledigt`. Neue Dateien werden automatisch mit diesem Template erstellt.

**Erfassen:** Neue Aufgaben werden in `## Aktiv` eingefuegt. Format: `- [ ] Text <Prio-Emoji> <Datum-Emoji>`. Prioritaet-Emojis: hoch=rot, mittel=orange, niedrig=blau. Bei `projekt`-Parameter wird automatisch `Projekte/{name}/Aufgaben.md` genutzt.

**Erledigen-Workflow:** Sucht die Aufgabe per Suchtext, entfernt sie aus der aktuellen Section, wandelt sie in `- [x] ~~Text~~ (YYYY-MM-DD)` um und fuegt sie in `## Erledigt` ein.

**Verschieben:** Sucht die Aufgabe per Suchtext (offene oder geschlossene Checkboxen), entfernt sie und fuegt sie in die Ziel-Section ein.

**Warte-auf:** Erstellt eine Aufgabe im Format `- [ ] **Text** — warte auf Person, seit YYYY-MM-DD` direkt in `## Warte auf`.

**Backward-Kompatibel:** Dateien ohne Section-Struktur werden im flachen Format unterstuetzt (Aufgaben werden ans Ende angehaengt).

**Auflisten:** Scannt alle .md-Dateien im Vault (oder Ordner) nach offenen Checkboxen. Sortiert nach Faelligkeitsdatum. Filter: faellig (heute/ueberfaellig/woche), prioritaet, ordner.

## Rueckgabe

**modus=erfassen — Erfolg:** `[task] Aufgabe erfasst: Aufgaben.md — "Prototyp bauen", hoch, faellig 2026-04-20`
**modus=erfassen — Fehler:** `Fehler: Kein Aufgabentext angegeben`
**modus=erfassen — Fehler:** `Fehler: Datum muss YYYY-MM-DD sein, bekommen: "2026/04/20"`

**modus=auflisten — Erfolg:** `5 offene Aufgaben:\n- [ ] Prototyp bauen ... — Aufgaben.md:3\n...`
**modus=auflisten — Gefiltert:** `2 offene Aufgaben (ueberfaellig):\n...`
**modus=auflisten — Leer:** `Keine offenen Aufgaben.`

**modus=erledigen — Erfolg:** `[task] Aufgabe erledigt: Aufgaben.md — "~~Prototyp bauen~~"`
**modus=erledigen — Nicht gefunden:** `Fehler: Aufgabe mit 'xyz' nicht gefunden`
**modus=erledigen — Fehler:** `Fehler: Kein Suchtext angegeben`

**modus=verschieben — Erfolg:** `[task] Aufgabe verschoben: nach irgendwann — Prototyp bauen`
**modus=verschieben — Nicht gefunden:** `Fehler: Aufgabe mit 'xyz' nicht gefunden`
**modus=verschieben — Fehler:** `Fehler: Ungueltiges Ziel: "xyz". Erlaubt: aktiv, warte_auf, irgendwann`

**modus=warte_auf — Erfolg:** `[task] Warte-Aufgabe erfasst: Aufgaben.md — "Review" — Max`
**modus=warte_auf — Fehler:** `Fehler: Keine Person angegeben (person ist Pflicht bei modus=warte_auf)`

## Abhaengigkeiten

- `node:fs`, `node:path`
- `_lib/vault.ts` (`vaultPath`, `safePath`, `ensureDir`, `projectPath`, `walkMarkdownFiles`, `atomicWriteSync`)
- `_lib/config.ts` (`DEFAULT_TASK_FILE`)
- `_lib/format.ts` (`ok`, `err`, `list`)
- `_lib/types.ts`

## Beispiele

```json
{ "modus": "erfassen", "text": "Prototyp bauen", "datum": "2026-04-20", "prioritaet": "hoch" }
{ "modus": "erfassen", "text": "Doku schreiben", "projekt": "WebApp" }
{ "modus": "auflisten" }
{ "modus": "auflisten", "faellig": "ueberfaellig", "prioritaet": "hoch" }
{ "modus": "auflisten", "ordner": "Projekte/WebApp" }
{ "modus": "erledigen", "text": "Prototyp" }
{ "modus": "erledigen", "text": "Prototyp", "datei": "Projekte/WebApp/Aufgaben.md" }
{ "modus": "verschieben", "text": "Doku schreiben", "nach": "irgendwann" }
{ "modus": "verschieben", "text": "Review", "nach": "aktiv" }
{ "modus": "warte_auf", "text": "Code Review", "person": "Max", "projekt": "WebApp" }
```
