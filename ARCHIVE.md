# KI-OS Obsidian — Projektabschluss

**Status:** Archiviert — April 2026
**Grund:** Ollama-Cloud-Subscription-Wall (siehe unten)
**Folgeprojekt:** Tools extrahiert nach `3_Unternehmen/KI-OS/KI Tools/`

---

## Was war das?

Ein persönlicher Telegram-Bot, der ein Obsidian-Vault autonom verwaltet.
Input per Text, Sprache oder Datei. Der Bot entscheidet selbst:
- Ist das ein Termin? → in Termine.md
- Eine Aufgabe? → in Aufgaben.md (Obsidian-Tasks-kompatibel)
- Ein kurzer Gedanke? → Daily Note
- Längerer Inhalt? → Inbox oder Projekt-Ordner
- Memory-Wunsch ("merk dir …")? → MEMORY.md

Ohne Rückfragen. Ohne Buttons. Einfach drauflos tippen.

## Architektur — was davon ist wertvoll

Auch wenn das Projekt hier endet, drei Design-Entscheidungen waren gut
und lohnen sich, weiterzutragen:

### 1. Zwei-Welten-Trennung `/data` ↔ Vault
- **Vault** (OneDrive-Mount) = User-Inhalt, sync-sauber, Git-fähig
- **`/data`** = Bot-State: Memory, Konversations-Logs, Konfiguration
- Nie vermischen. Ein User kann sein Vault löschen — der Bot kommt mit
  Memory + Setup intakt wieder hoch.
- Implementiert via Docker-Volume-Mapping.

### 2. Tool-Loop mit Pflicht-`antworten`-Tool
- `tool_choice: "required"` zwingt das LLM, immer mindestens ein Tool zu
  wählen.
- Ein spezielles `antworten`-Tool ist der einzige Weg, dem User zu antworten.
- Dadurch gibt es **keine "naked replies"** mehr — jede Bot-Antwort durchläuft
  den Tool-Pfad, ist strukturiert, loggbar, und kann Seiteneffekte mit der
  Antwort kombinieren.
- Subtile Race zu fixen: `antworten` muss auf andere Tool-Results warten
  (siehe Plan-Doc `partitioned-meandering-pearl.md`, Phase 2, runtime.ts).

### 3. One-Container-Stack
- Docker-compose.yml startet **ein** Container (`obsidian-os-bot-1`).
- Darin: Node-App + Ollama (lokal, `/api/generate`) + Whisper + entrypoint.sh.
- Kein Kubernetes, kein Microservice-Unfug. Ein Cron-taugliches Ding.

## Kernprinzip — das Einfachheits-Mantra

**Ein Projekt = ein Ordner.** Keine Metadata-JSONs, keine Parallel-Datenbank.
Wenn unter `Projekte/` ein Ordner liegt, ist das ein Projekt. Punkt.

Ursprünglich hatten wir `projects.ts`, `tasks.ts`, `termine.ts` als
JSON-Store parallel zum Vault — das war Feature-Creep. Phase 3 hätte das
durch pure Markdown ersetzt (Aufgaben als `- [ ]` Checkboxen im Vault,
Termine als Zeilen in `Termine.md`). Diese Richtung ist richtig.

## Was schief ging — Ollama-Cloud-403

**Der konkrete Showstopper:**

- Zielmodell: `kimi-k2.5:cloud` (Ollama Cloud-Modell)
- Bot spricht OpenAI-kompatible API: `POST /v1/chat/completions`
- Ollama-Cloud gibt für dieses Modell **403 Forbidden** zurück — "subscription
  required: https://ollama.com/upgrade"
- Irreführend: `ollama run kimi-k2.5:cloud "ping"` (CLI, via `/api/generate`)
  funktioniert problemlos. Die beiden Endpoints haben **unterschiedliche
  Zugangsregeln** für Cloud-Modelle.

**Warum das zum Archive führte:**
Die OpenAI-SDK-Integration ist tief im Bot verankert (Tool-Loop,
Function-Calling, Message-Format). Auf `/api/generate` umzubauen wäre
ein größerer Refactor. Gleichzeitig wollte Julius nicht für Ollama zahlen
bzw. sich an einen Vendor binden — also besser: frisch aufsetzen, idealerweise
mit einem Modell, das via lokale Ollama-Instanz oder anderer OpenAI-kompat.
Provider erreichbar ist.

## Wo die guten Teile hingegangen sind

Alle 18 LLM-Tools wurden als **eigenständige Tool-Bibliothek** extrahiert:

```
3_Unternehmen/KI-OS/KI Tools/
├── README.md              — Tool-Katalog
├── INTEGRATION.md         — Wire-up mit OpenAI-SDK (copy-paste-ready)
├── _lib/
│   ├── types.ts           — ToolSchema, ToolHandler
│   ├── config.ts          — ENV-driven (inkl. LLM-Provider / OpenRouter)
│   ├── vault.ts           — Shared Primitives (safePath, walkMd, …)
│   ├── llm.ts             — LLM-Client-Factory (OpenRouter/Ollama/OpenAI)
│   ├── format.ts          — Return-Format-Helpers
│   ├── note-content.ts    — Note-Content-Resolver
│   └── daily.ts           — Daily-Note-Helpers
├── notiz_speichern/
├── notiz_lesen/
├── notiz_bearbeiten/
├── notiz_loeschen/
├── frontmatter_setzen/
├── daily_notes/             ← kombiniert lesen + auflisten (modus-Parameter)
├── daily_note_eintrag/
├── aufgabe_erfassen/
├── aufgaben_offen/
├── termin_erfassen/
├── termine_auflisten/
├── projekte_auflisten/
├── projekt_inhalt/
├── vault_suchen/
├── vault_navigation/
├── memory_speichern/
├── export_pdf/
└── export_docx/
```

Jedes Tool = `schema.ts` + `handler.ts` + `README.md`, in sich geschlossen,
refaktorierbar unabhängig. Genau das Ziel: **nicht das ganze Bot-Projekt
rebuilden, sondern die bewährten Bausteine im nächsten Projekt
wiederverwenden.**

## Wenn du das hier nochmal anfasst (6 Monate später)

### Reihenfolge der Dateien zum Wiedereinlesen
1. **`ARCHIVE.md`** (du bist hier)
2. `src/bot.ts` — Telegram-Bot-Einstiegspunkt, Command-Registrierungen
3. `src/llm/runtime.ts` — Tool-Loop-Kernstück (processMessage)
4. `src/llm/tools.ts` + `src/llm/executor.ts` — Tool-Registry + Dispatch
5. `scripts/entrypoint.sh` — Container-Boot (Ollama serve + App-Start)
6. `docker-compose.yml` — Volumes, Ports, ENV

### Was der Plan-Doc sagte (relevanter Kontext)
In `~/.claude/plans/partitioned-meandering-pearl.md` liegt ein Reset-Plan,
der **nicht ausgeführt wurde**. Er wollte JSON-Stores entfernen, Template-
System rausschmeißen, SYSTEM.md radikal kürzen, auf pure Markdown umstellen.
Die Richtung ist immer noch richtig, falls jemand das Projekt doch nochmal
aufgreift.

### Ideen für einen Neuaufbau
Wenn du das Konzept neu angehst:
- **Nicht** wieder OpenAI-SDK + Ollama-Cloud-Cloud-Modell — Zugangs-Risiko
- Besser: lokales Ollama mit `qwen2.5-coder:7b` oder Ähnliches, oder
  Anthropic Claude API (stabil, Function-Calling solid)
- Tools aus `KI Tools/` zusammenstellen → nur die, die der Anwendungsfall
  braucht
- Die 3 guten Architektur-Prinzipien (oben) übertragen
- Tasks/Termine direkt als Markdown (kein JSON-Store!) — wir wissen jetzt,
  dass das reicht
- Klein anfangen, nicht sofort Bot+Setup+Voice+Files+Compaction+…

### Was hier NICHT mehr im Vault-Sync liegen darf
- `node_modules/` (lokal gebaut, 100+ MB)
- `dist/` (build output)
- `/data/` (bot state — falls du es kopierst, auslassen)

Falls du das Projekt wirklich "hervorholst", `git clone` einer frischen
Kopie + `npm install` statt den OneDrive-Stand zu verwenden.

## Offene technische Punkte (wenn jemand reanimiert)

- `antworten`-Race in `src/llm/runtime.ts` — Promise.all auf Side-Effect-Tools
  abwarten, *dann* Antwort-Text returnen. Aktuell kommt Antwort ggf. bevor
  Write-Bestätigung da ist.
- `src/llm/compaction.ts` — Fire-and-Forget-Error-Handling durch sauberes
  try/catch ersetzen.
- `MAX_SPAWN_DEPTH` + `registerProcessAgent` sind toter Code.
- 16 Admin-Commands in `src/commands/system.ts`, davon werden realistisch 5
  benutzt (`/hilfe`, `/status`, `/kontext`, `/kompakt`, `/neu`).

## Letzte Notiz an das zukünftige Ich

Das war kein gescheitertes Projekt. Wir haben gelernt:
- Wie man einen Tool-Loop robust baut (mandatory-antworten-Pattern)
- Wie man Docker + Ollama + Whisper in einen Container bekommt
- Dass Obsidian-Vaults am besten **nur als Markdown** behandelt werden
- Dass "der Bot entscheidet autonom was wohin kommt" tatsächlich angenehm ist
- Dass Cloud-LLM-APIs immer die Zugangs-Frage sind, nicht die Technik

Die 18 Tools sind der Payoff. Sie werden wieder laufen, irgendwo anders.
Danke an dieses Projekt. 🧘
