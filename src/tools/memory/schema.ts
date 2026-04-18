import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "memory",
    description:
      "Verwaltet dauerhaftes Wissen (KNOWLEDGE.md + Deep Storage). " +
      "6 Modi: 'speichern' — merkt sich Info (mit Kategorie-Routing). " +
      "'lesen' — gibt Hot Cache zurueck. " +
      "'loeschen' — entfernt Eintraege per Suchtext. " +
      "'nachschlagen' — sucht Begriff in allen Wissensquellen. " +
      "'profil' — liest/erstellt Personenprofile. " +
      "'glossar' — verwaltet das Glossar. " +
      "Nutze PROAKTIV: 'merk dir' → speichern, 'was weisst du' → lesen, " +
      "'vergiss' → loeschen, 'was bedeutet X' → nachschlagen, " +
      "'wer ist X' → profil, 'Abkuerzung X' → glossar.",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          description:
            "Betriebsmodus: 'speichern', 'lesen', 'loeschen', 'nachschlagen', 'profil', 'glossar'",
          enum: [
            "speichern",
            "lesen",
            "loeschen",
            "nachschlagen",
            "profil",
            "glossar",
          ],
        },
        eintrag: {
          type: "string",
          description:
            "Text zum Speichern oder Suchtext zum Loeschen (modus=speichern/loeschen)",
        },
        kategorie: {
          type: "string",
          description:
            "Kategorie fuer intelligentes Routing (modus=speichern): " +
            "'person', 'projekt', 'begriff', 'praeferenz', 'kontext'",
          enum: ["person", "projekt", "begriff", "praeferenz", "kontext"],
        },
        begriff: {
          type: "string",
          description: "Term zum Nachschlagen (modus=nachschlagen)",
        },
        name: {
          type: "string",
          description: "Personenname (modus=profil)",
        },
        rolle: {
          type: "string",
          description: "Rolle der Person (modus=profil)",
        },
        team: {
          type: "string",
          description: "Team der Person (modus=profil)",
        },
        alias: {
          type: "string",
          description: "Spitzname oder Alias (modus=profil)",
        },
        glossar_begriff: {
          type: "string",
          description: "Begriff fuer das Glossar (modus=glossar)",
        },
        bedeutung: {
          type: "string",
          description: "Bedeutung des Begriffs (modus=glossar)",
        },
        kontext: {
          type: "string",
          description: "Optionaler Kontext (modus=glossar)",
        },
        section: {
          type: "string",
          description:
            "Glossar-Section (modus=glossar): 'Abkuerzungen', 'Interne Begriffe', 'Spitznamen', 'Projekt-Codenamen'",
          enum: [
            "Abkuerzungen",
            "Interne Begriffe",
            "Spitznamen",
            "Projekt-Codenamen",
          ],
        },
      },
      required: ["modus"],
    },
  },
};
