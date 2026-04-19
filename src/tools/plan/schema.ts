import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "plan",
    description:
      "Verwaltet mehrstufige Aufgaben-Plaene damit der rote Faden bei grossen Tasks nicht verloren geht. Modi: 'erstellen' (neuer Plan mit Schritten), 'zeigen' (aktuellen Plan lesen), 'schritt_start' (Schritt auf in-progress), 'schritt_fertig' (Schritt abhaken), 'schritt_blockiert' (Schritt markieren + Grund), 'notiz' (Notiz zu Schritt), 'archivieren' (Plan abschliessen). Nutze bei: 'erstell einen Plan', 'arbeite das in Schritten ab', 'was war der naechste Schritt', 'Schritt X ist fertig'. NICHT fuer einzelne Aufgaben (→ aufgaben).",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          description: "Betriebsmodus",
          enum: [
            "erstellen",
            "zeigen",
            "schritt_start",
            "schritt_fertig",
            "schritt_blockiert",
            "notiz",
            "archivieren",
            "auflisten",
          ],
        },
        titel: {
          type: "string",
          description: "Plan-Titel (Pflicht bei modus=erstellen). Kurz und aussagekraeftig (3-8 Woerter).",
        },
        schritte: {
          type: "string",
          description:
            "Schritte als Semikolon-separierte Liste (Pflicht bei modus=erstellen). Z.B. 'Audit;Plan;Implementation;Tests;Docs'",
        },
        beschreibung: {
          type: "string",
          description: "Optionale Gesamtbeschreibung des Plans (nur bei modus=erstellen)",
        },
        plan_id: {
          type: "string",
          description:
            "Plan-ID (Slug oder Dateiname, ohne .md). Default: der zuletzt erstellte/aktive Plan. Nuetzlich bei mehreren parallelen Plaenen.",
        },
        schritt: {
          type: "number",
          description: "Schritt-Nummer (Pflicht bei schritt_start/schritt_fertig/schritt_blockiert/notiz). 1-basiert.",
        },
        notiz: {
          type: "string",
          description: "Notiz-Text. Bei schritt_fertig/schritt_blockiert: Abschluss-Kommentar. Bei modus=notiz: eigener Eintrag zum Schritt.",
        },
        grund: {
          type: "string",
          description: "Grund/Blocker-Beschreibung (Pflicht bei modus=schritt_blockiert)",
        },
      },
      required: ["modus"],
    },
  },
};
