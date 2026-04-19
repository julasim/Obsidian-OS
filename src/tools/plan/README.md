# plan

Verwaltet mehrstufige Aufgaben-Plaene. Damit das LLM bei grossen, langen Tasks den roten Faden behaelt — Schritte anlegen, als in-Arbeit markieren, abhaken, blockieren oder mit Notizen anreichern. Jeder Plan ist eine Markdown-Datei im `Plaene/`-Ordner.

## Modi

| Modus | Zweck |
|---|---|
| `erstellen` | Neuer Plan mit Titel + Schritte-Liste |
| `zeigen` | Aktuellen (oder spezifischen) Plan lesen |
| `schritt_start` | Schritt auf "in Arbeit" setzen (`[~]`) |
| `schritt_fertig` | Schritt abhaken (`[x]`) |
| `schritt_blockiert` | Schritt blockieren (`[!]`) mit Grund |
| `notiz` | Notiz/Kommentar zu einem Schritt hinzufuegen |
| `archivieren` | Plan abschliessen (status: archiviert) |
| `auflisten` | Alle Plaene mit Progress-Count |

## Parameter

| Name | Typ | Pflicht | Modus | Beschreibung |
|---|---|---|---|---|
| `modus` | string (enum) | ja | alle | Betriebsmodus |
| `titel` | string | ja | erstellen | Plan-Titel (3-8 Woerter) |
| `schritte` | string | ja | erstellen | Semikolon-separierte Schritt-Liste |
| `beschreibung` | string | nein | erstellen | Gesamtbeschreibung des Plans |
| `plan_id` | string | nein | alle ausser erstellen | Plan-ID. Default: aktiver Plan |
| `schritt` | number | ja | schritt_start/fertig/blockiert | 1-basierte Schrittnummer |
| `notiz` | string | nein | schritt_fertig, notiz | Abschluss-Kommentar oder Notiz |
| `grund` | string | ja | schritt_blockiert | Blocker-Beschreibung |

## Verhalten

### Plan-Datei-Format

Jeder Plan wird als Markdown im `Plaene/`-Ordner (konfigurierbar via `PLANS_DIR`) gespeichert:

```markdown
---
titel: Refactoring v2
erstellt: 2026-04-17
status: aktiv
---

# Refactoring v2

Optionale Beschreibung.

## Schritte

- [x] 1. Audit
- [~] 2. Plan
- [ ] 3. Implementation
- [!] 4. Tests
- [ ] 5. Docs

## Notizen

- 2026-04-17 — Schritt 1 (erledigt): Audit durchgefuehrt, 12 Befunde
- 2026-04-17 — Schritt 4 (blockiert): API-Doku unvollstaendig
```

### Status-Zeichen

- `[ ]` — todo (noch nicht begonnen)
- `[~]` — in Arbeit (Obsidian Tasks Custom)
- `[x]` — erledigt
- `[!]` — blockiert (Obsidian Tasks Custom)

### Aktiver Plan

Ohne `plan_id` wird der **zuletzt geaenderte Plan mit status=aktiv** verwendet. Archivierte Plaene werden ausgeschlossen. So kann das LLM einfach mit einem laufenden Plan arbeiten ohne jedes Mal die ID anzugeben.

### Datei-Benennung

`<YYYY-MM-DD-HH-MM>-<slug>.md` — Timestamp verhindert Kollisionen, Slug macht den Namen menschenlesbar.

## Rueckgabe

**Erfolg erstellen:** `ℹ️ Plan erstellt: [[2026-04-17-1430-refactoring-v2]] — 5 Schritte`
**Erfolg schritt_fertig:** `ℹ️ Schritt erledigt: Plaene/2026-...#2 — "Plan"`
**Erfolg notiz:** `ℹ️ Notiz gespeichert: Plaene/... — Schritt 3: Variante A gewaehlt`
**Erfolg archivieren:** `ℹ️ Plan archiviert: Plaene/... — 3/5 Schritte erledigt`
**Erfolg zeigen:** Raw Markdown-Inhalt des Plans
**Erfolg auflisten:**
```
2 Plaene:
▸ Refactoring v2 — 3/5 — [[2026-04-17-...]]
🗄️ Altes Projekt — 4/4 — [[2026-03-10-...]]
```
**Fehler (Validation):** `Fehler: titel ist Pflicht bei modus=erstellen.`
**Nicht gefunden:** `Schritt 99 nicht gefunden. Plan hat 5 Schritt(e).`

## Abhaengigkeiten

- `node:fs`, `node:path`
- `_lib/vault.ts` → `vaultPath`, `safePath`, `ensureDir`, `atomicWriteSync`
- `_lib/config.ts` → `PLANS_DIR`
- `_lib/date.ts` → `todayStr`
- `_lib/format.ts` → `ok`, `err`, `list`, `wikilink`

## Beispiele

### Neuer Plan
```json
{
  "modus": "erstellen",
  "titel": "Refactoring v2",
  "schritte": "Audit;Plan;Implementation;Tests;Docs",
  "beschreibung": "Komplettes Refactoring der Vault-Tool-Library"
}
```

### Schritt starten
```json
{ "modus": "schritt_start", "schritt": 2 }
```

### Schritt abhaken mit Notiz
```json
{
  "modus": "schritt_fertig",
  "schritt": 2,
  "notiz": "5 Module umgestellt, keine Tests gebrochen"
}
```

### Schritt blockieren
```json
{
  "modus": "schritt_blockiert",
  "schritt": 3,
  "grund": "API-Doku unvollstaendig, Rueckfrage an Max gestellt"
}
```

### Plan archivieren
```json
{ "modus": "archivieren" }
```
