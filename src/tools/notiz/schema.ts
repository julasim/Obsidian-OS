import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "notiz",
    description:
      "Verwaltet Notizen im Vault. Modus 'speichern': erstellt neue Markdown-Datei (Notiz, Idee, Konzept). Modus 'bearbeiten': aendert bestehende Notiz (Append oder Suchen/Ersetzen). Modus 'loeschen': entfernt Notiz (Soft-Delete oder permanent). Modus 'frontmatter': setzt/aktualisiert/loescht YAML-Frontmatter-Felder. Modus 'eintrag': fuegt kurzen Eintrag in Daily Note ein. Nutze bei: 'schreib eine Notiz', 'speicher das', 'aendere X in der Notiz', 'ersetze Y durch Z', 'loesch die Notiz', 'setz den Status auf X', 'aender die Tags', 'notier kurz', 'log das', 'schreib ins Tagebuch'. NICHT fuer Vault-Struktur/Navigation (→ vault). NICHT fuer Aufgaben (→ aufgaben).",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          description:
            "Betriebsmodus: 'speichern' (neue Notiz), 'bearbeiten' (bestehende Notiz aendern), 'loeschen' (Notiz entfernen), 'frontmatter' (YAML-Felder setzen), 'eintrag' (Daily-Note-Eintrag)",
          enum: ["speichern", "bearbeiten", "loeschen", "frontmatter", "eintrag"],
        },
        text: {
          type: "string",
          description:
            "Bei modus=speichern: Inhalt der Notiz (Markdown). Bei modus=bearbeiten: Text zum Anhaengen. Bei modus=eintrag: Inhalt des Daily-Eintrags.",
        },
        titel: {
          type: "string",
          description:
            "Kurzer, aussagekraeftiger Titel (2-5 Woerter, IMMER angeben). Nur bei modus=speichern.",
        },
        ordner: {
          type: "string",
          description:
            "Expliziter Zielordner relativ zum Vault (z.B. 'wiki', 'raw'). Nur bei modus=speichern.",
        },
        projekt: {
          type: "string",
          description:
            "Projektname — Shortcut fuer Projekte/{name}/Notizen/. Nur bei modus=speichern.",
        },
        tags: {
          type: "string",
          description:
            "Komma-separierte Tags (IMMER mindestens 1). Nur bei modus=speichern.",
        },
        quelle: {
          type: "string",
          description:
            "Herkunft/Kontext der Notiz (Default: 'extern'). Nur bei modus=speichern.",
        },
        name: {
          type: "string",
          description:
            "Dateiname, Wikilink oder relativer Pfad der Notiz. Bei modus=bearbeiten und modus=loeschen (Pflicht).",
        },
        suchen: {
          type: "string",
          description:
            "Suchtext oder Regex-Pattern das ersetzt werden soll. Nur bei modus=bearbeiten (Suchen/Ersetzen-Modus).",
        },
        ersetzen: {
          type: "string",
          description:
            "Ersetzungstext (Default: leer = loeschen). Nur bei modus=bearbeiten mit 'suchen'.",
        },
        regex: {
          type: "string",
          description:
            "Auf 'true' setzen wenn 'suchen' ein Regex-Pattern ist. Nur bei modus=bearbeiten (Default: false).",
        },
        alle: {
          type: "string",
          description:
            "Auf 'true' setzen um ALLE Vorkommen zu ersetzen. Nur bei modus=bearbeiten (Default: false).",
        },
        permanent: {
          type: "string",
          description:
            "Auf 'true' setzen fuer endgueltiges Loeschen. Nur bei modus=loeschen (Default: false, Soft-Delete in .trash/).",
        },
        pfad: {
          type: "string",
          description:
            "Vault-relativer Pfad zur Datei. Nur bei modus=frontmatter (Pflicht).",
        },
        schluessel: {
          type: "string",
          description:
            "Frontmatter-Key (z.B. 'status', 'tags'). Nur bei modus=frontmatter (Pflicht).",
        },
        wert: {
          type: "string",
          description:
            "Frontmatter-Wert. Leer lassen um Feld zu loeschen. Nur bei modus=frontmatter.",
        },
        als_array: {
          type: "string",
          description:
            "Auf 'true' setzen um Komma-Werte als Array zu speichern. Nur bei modus=frontmatter (Default: nur bei tags/aliases).",
        },
        datum: {
          type: "string",
          description:
            "Datum YYYY-MM-DD fuer Ziel-Daily-Note. Nur bei modus=eintrag (Default: heute).",
        },
        abschnitt: {
          type: "string",
          description:
            "Abschnitt im Daily Note. Nur bei modus=eintrag (Default: 'Log').",
        },
      },
      required: ["modus"],
    },
  },
};
