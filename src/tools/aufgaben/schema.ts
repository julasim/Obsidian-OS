import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "aufgaben",
    description:
      "Verwaltet Aufgaben im Vault. Modi: 'erfassen' (neue Aufgabe), 'auflisten' (offene Tasks), 'erledigen' (Aufgabe abhaken), 'verschieben' (zwischen Sections), 'warte_auf' (Warte-Aufgabe). Nutze bei: 'neue Aufgabe', 'todo anlegen', 'was steht an', 'offene Tasks', 'ueberfaellige Aufgaben', 'Aufgabe erledigt', 'Task verschieben', 'warte auf Person'. NICHT fuer Kalendertermine (→ termine).",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          description: "Betriebsmodus: 'erfassen', 'auflisten', 'erledigen', 'verschieben', 'warte_auf'",
          enum: ["erfassen", "auflisten", "erledigen", "verschieben", "warte_auf"],
        },
        text: {
          type: "string",
          description: "Aufgabentext (Pflicht bei modus=erfassen/warte_auf). Bei modus=erledigen/verschieben: Suchtext um die Aufgabe zu finden.",
        },
        datum: {
          type: "string",
          description: "Faelligkeitsdatum YYYY-MM-DD (nur bei modus=erfassen)",
        },
        prioritaet: {
          type: "string",
          description: "Prioritaet (beide Modi). Bei erfassen: wird als Emoji gesetzt. Bei auflisten: filtert.",
          enum: ["hoch", "mittel", "niedrig"],
        },
        projekt: {
          type: "string",
          description: "Projektname — Shortcut fuer Projekte/<name>/Aufgaben.md (nur bei modus=erfassen)",
        },
        datei: {
          type: "string",
          description: "Explizite Zieldatei vault-relativ (nur bei modus=erfassen, Default: Aufgaben.md)",
        },
        ordner: {
          type: "string",
          description: "Nur Aufgaben aus diesem Ordner (nur bei modus=auflisten)",
        },
        faellig: {
          type: "string",
          description: "Faelligkeits-Filter (nur bei modus=auflisten): 'heute', 'ueberfaellig', 'woche', 'alle' (Default)",
          enum: ["heute", "ueberfaellig", "woche", "alle"],
        },
        limit: {
          type: "number",
          description: "Max. Anzahl (nur bei modus=auflisten, Default: 50)",
        },
        nach: {
          type: "string",
          description: "Ziel-Section beim Verschieben (nur bei modus=verschieben)",
          enum: ["aktiv", "warte_auf", "irgendwann"],
        },
        person: {
          type: "string",
          description: "Auf wen gewartet wird (nur bei modus=warte_auf, Pflicht)",
        },
      },
      required: ["modus"],
    },
  },
};
