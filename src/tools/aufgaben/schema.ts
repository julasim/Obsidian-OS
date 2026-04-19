import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "aufgaben",
    description:
      "Maechtiges Task-Management (Obsidian-Tasks-kompatibel). Modi: 'erfassen' (neue Aufgabe, Natural-Language-Input moeglich), 'auflisten' (offene Tasks mit vielen Filtern/Ansichten), 'erledigen' (abhaken, recurring erzeugt naechste Instanz), 'verschieben' (zwischen Sections), 'warte_auf' (Warte-Aufgabe), 'bearbeiten' (Felder aendern), 'details' (Detail-Zeilen), 'bulk' (mehrere auf einmal). Unterstuetzt: Priority, Start/Due/Scheduled, Tags, Kontext, Wiederholung, Zeitschaetzung, Subtasks, Plan-Refs. Nutze bei: 'neue Aufgabe', 'morgen Max anrufen #work', 'was steht heute an', 'Dashboard', 'erledigt', 'ueberfaellige Tasks'. NICHT fuer Kalendertermine (→ termine).",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          description: "Betriebsmodus",
          enum: [
            "erfassen",
            "auflisten",
            "erledigen",
            "verschieben",
            "warte_auf",
            "bearbeiten",
            "details",
            "bulk",
          ],
        },
        text: {
          type: "string",
          description:
            "Aufgabentext. Natural-Language wird immer geparst: 'morgen', 'naechsten Montag', 'jeden Montag', '#tag', '@kontext', '!!!', 'in 3 Tagen'. Bei modus=erledigen/verschieben/bearbeiten/details: Suchtext zum Finden.",
        },
        datum: {
          type: "string",
          description: "Faelligkeitsdatum YYYY-MM-DD (📅 due). Ueberschreibt NLP.",
        },
        start: {
          type: "string",
          description: "Start-Datum YYYY-MM-DD (🛫). Aufgabe erscheint erst ab diesem Datum in Listen.",
        },
        scheduled: {
          type: "string",
          description: "Scheduled-Datum YYYY-MM-DD (⏳). Wann die Aufgabe eingeplant ist.",
        },
        prioritaet: {
          type: "string",
          description: "Prioritaet (Obsidian-Tasks): hoch (🔴) / mittel-hoch (🟠) / mittel (🟡) / niedrig-mittel (🟢) / niedrig (🔵). Auch als Filter bei modus=auflisten.",
          enum: ["hoch", "mittel-hoch", "mittel", "niedrig-mittel", "niedrig"],
        },
        wiederholung: {
          type: "string",
          description: "Wiederholungs-Pattern (🔁). Z.B. 'jeden Montag', 'every week', 'alle 3 Tage', 'jaehrlich'. Bei Erledigung wird naechste Instanz erzeugt.",
        },
        schaetzung: {
          type: "string",
          description: "Zeitschaetzung (⏱️). Z.B. '30m', '2h', '1d'.",
        },
        tags: {
          type: "string",
          description: "Komma-separierte Tags ohne #. Z.B. 'work,review,client'. Bei auflisten: siehe 'tag'-Filter.",
        },
        kontext: {
          type: "string",
          description: "Komma-separierter Kontext ohne @. Z.B. 'laptop,buero,telefon' — wo/womit erledigbar.",
        },
        plan_ref: {
          type: "string",
          description: "Plan-Referenz (🔗). Z.B. 'plan-id#2' — verknuepft Task mit einem Plan-Schritt.",
        },
        details: {
          type: "string",
          description: "Mehrzeilige Detail-Notizen (mit \\n getrennt). Bei modus=details: der hinzuzufuegende Text.",
        },
        parent_text: {
          type: "string",
          description: "Nur bei modus=erfassen: Suchtext einer existierenden Parent-Task, unter der die neue als Subtask eingeruckt wird.",
        },
        projekt: {
          type: "string",
          description: "Projektname — Shortcut fuer Projekte/<name>/Aufgaben.md (nur bei modus=erfassen/warte_auf).",
        },
        datei: {
          type: "string",
          description: "Explizite Zieldatei vault-relativ. Default: Aufgaben.md (oder Projekte/<name>/Aufgaben.md bei projekt).",
        },
        ordner: {
          type: "string",
          description: "Nur Aufgaben aus diesem Ordner (bei modus=auflisten/bulk).",
        },
        ansicht: {
          type: "string",
          description:
            "Ansicht (nur bei modus=auflisten): 'default' (flache Liste), 'dashboard' (kompakt nach Dringlichkeit), 'telegram' (MarkdownV2, nach Projekt gruppiert — fuer Bot-Ausgabe mit parse_mode=MarkdownV2), 'heute', 'woche', 'ueberfaellig', 'projekt' (gruppiert), 'tag', 'kontext', 'nach_prio'.",
          enum: ["default", "dashboard", "telegram", "heute", "woche", "ueberfaellig", "projekt", "tag", "kontext", "nach_prio"],
        },
        faellig: {
          type: "string",
          description: "Faelligkeits-Filter (nur bei auflisten): 'heute', 'ueberfaellig', 'woche', 'alle' (Default)",
          enum: ["heute", "ueberfaellig", "woche", "alle"],
        },
        sortierung: {
          type: "string",
          description: "Sortierung bei auflisten: 'default' (Datum+Prio), 'nach_prio', 'nach_datum'",
          enum: ["default", "nach_prio", "nach_datum"],
        },
        tag: {
          type: "string",
          description: "Filter nur Tasks mit diesem Tag (nur bei auflisten). Mit oder ohne #.",
        },
        kontext_filter: {
          type: "string",
          description: "Filter nur Tasks mit diesem Kontext (nur bei auflisten). Mit oder ohne @.",
        },
        person: {
          type: "string",
          description: "Bei modus=auflisten: Filter Tasks die eine Person betreffen (im Text, Tags, Kontext). Bei modus=warte_auf: auf wen gewartet wird (Pflicht).",
        },
        start_respektieren: {
          type: "string",
          description: "Default 'true': Tasks mit start > heute werden ausgeblendet. Auf 'false' setzen um sie trotzdem zu zeigen.",
        },
        limit: {
          type: "number",
          description: "Max. Anzahl (bei auflisten, Default: 50)",
        },
        nach: {
          type: "string",
          description: "Ziel-Section bei modus=verschieben",
          enum: ["aktiv", "warte_auf", "irgendwann", "erledigt"],
        },
        neuer_text: {
          type: "string",
          description: "Nur bei modus=bearbeiten: neuer Task-Text (ersetzt alten).",
        },
        tag_action: {
          type: "string",
          description: "Bei modus=bearbeiten mit tags/kontext: 'add', 'remove' oder 'set' (Default: set)",
          enum: ["add", "remove", "set"],
        },
        aktion: {
          type: "string",
          description: "Bei modus=details: 'hinzufuegen' (Default) oder 'zeigen'",
          enum: ["hinzufuegen", "zeigen"],
        },
        bulk_aktion: {
          type: "string",
          description: "Nur bei modus=bulk: 'erledigen' oder 'verschieben'",
          enum: ["erledigen", "verschieben"],
        },
        bestaetigung: {
          type: "string",
          description: "Nur bei modus=bulk mit >20 Tasks: auf 'true' setzen zum Bestaetigen",
        },
      },
      required: ["modus"],
    },
  },
};
