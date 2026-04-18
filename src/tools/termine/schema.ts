import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "termine",
    description:
      "Verwaltet Kalendertermine im Vault. Modus 'erfassen': erstellt einen neuen Termin mit Datum, optionaler Uhrzeit und Ort. Modus 'auflisten': listet Termine mit Datumsfilter. Nutze bei: 'trag einen Termin ein', 'am Montag um 10 Uhr', 'Meeting eintragen', 'Arzttermin anlegen', 'was habe ich vor', 'naechste Termine', 'Kalender diese Woche'. NICHT fuer Aufgaben/Todos (→ aufgaben).",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          description: "Betriebsmodus: 'erfassen' oder 'auflisten'",
          enum: ["erfassen", "auflisten"],
        },
        datum: {
          type: "string",
          description: "Datum YYYY-MM-DD (Pflicht bei modus=erfassen)",
        },
        text: {
          type: "string",
          description: "Terminbeschreibung (nur bei modus=erfassen, Pflicht)",
        },
        zeit: {
          type: "string",
          description: "Startzeit HH:MM (nur bei modus=erfassen)",
        },
        endZeit: {
          type: "string",
          description: "Endzeit HH:MM, nur mit zeit (nur bei modus=erfassen)",
        },
        ort: {
          type: "string",
          description: "Ort/Raum (nur bei modus=erfassen)",
        },
        datei: {
          type: "string",
          description: "Zieldatei vault-relativ (nur bei modus=erfassen, Default: Termine.md)",
        },
        von: {
          type: "string",
          description: "Startdatum YYYY-MM-DD inklusiv (nur bei modus=auflisten, Default: heute)",
        },
        bis: {
          type: "string",
          description: "Enddatum YYYY-MM-DD inklusiv (nur bei modus=auflisten)",
        },
        alle: {
          type: "string",
          description: "Auf 'true' setzen um ALLE Termine zu zeigen inkl. vergangene (nur bei modus=auflisten)",
        },
        alle_dateien: {
          type: "string",
          description: "Auf 'true' setzen um den gesamten Vault zu scannen (Default: nur Termin-Dateien). Nur bei modus=auflisten.",
        },
        limit: {
          type: "number",
          description: "Max. Anzahl (nur bei modus=auflisten, Default: 50)",
        },
      },
      required: ["modus"],
    },
  },
};
