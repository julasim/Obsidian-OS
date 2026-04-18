import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "vault",
    description:
      "Universelles Vault-Tool mit 7 Modi. " +
      "modus=lesen: Liest eine bekannte Datei (Name, Pfad, [[Wikilink]]). Trigger: 'zeig mir Notiz X', 'lies Datei Y'. " +
      "modus=suchen: Volltextsuche, Glob-Dateisuche oder Ordnerinhalt (via such_modus). Trigger: 'such nach X', 'finde Dateien mit Y'. " +
      "modus=navigation: Vault-Uebersicht (index.md + Top-Level-Ordner). Trigger: 'was gibt es im Vault', 'Struktur'. " +
      "modus=projekte: Listet alle Projekte. Trigger: 'welche Projekte gibt es', 'Projektliste'. " +
      "modus=projekt_inhalt: Dateien eines Projekts. Trigger: 'zeig mir Projekt X'. " +
      "modus=daily: Daily Notes lesen oder auflisten. Trigger: 'was hab ich heute gemacht', 'zeig Daily'. " +
      "modus=dekodieren: Ersetzt Abkuerzungen/Shorthand im Text durch Bedeutungen aus dem Knowledge-System. Trigger: 'dekodiere Text', 'was bedeutet das'.",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          enum: ["lesen", "suchen", "navigation", "projekte", "projekt_inhalt", "daily", "dekodieren"],
          description: "Betriebsmodus (Pflicht)",
        },

        // --- modus=lesen ---
        name: {
          type: "string",
          description: "Dateiname, Pfad oder Wikilink (nur bei modus=lesen, Pflicht)",
        },
        nur_frontmatter: {
          type: "string",
          description: "Auf 'true' setzen um nur YAML-Frontmatter zurueckzugeben (nur bei modus=lesen)",
        },

        // --- modus=suchen ---
        abfrage: {
          type: "string",
          description: "Suchbegriff, Regex, Glob-Pattern oder Ordnerpfad (nur bei modus=suchen, Pflicht)",
        },
        such_modus: {
          type: "string",
          enum: ["text", "dateien", "ordner"],
          description: "Sub-Modus der Suche: 'text' (Default), 'dateien' oder 'ordner' (nur bei modus=suchen)",
        },
        ordner: {
          type: "string",
          description: "Suche auf Unterordner begrenzen, vault-relativ (nur bei modus=suchen)",
        },
        regex: {
          type: "string",
          description: "Auf 'true' setzen um abfrage als Regex zu interpretieren (nur bei modus=suchen, such_modus=text)",
        },
        max_treffer: {
          type: "number",
          description: "Max. Treffer pro Datei 1-10, Default 3 (nur bei modus=suchen, such_modus=text)",
        },
        kontext: {
          type: "number",
          description: "Kontext-Zeilen um Treffer 0-5, Default 1 (nur bei modus=suchen, such_modus=text)",
        },
        sortierung: {
          type: "string",
          enum: ["relevanz", "datum"],
          description: "Sortierung: 'relevanz' (Default) oder 'datum' (nur bei modus=suchen, such_modus=text)",
        },
        aenderung_von: {
          type: "string",
          description: "Nur Dateien geaendert ab YYYY-MM-DD inklusiv (nur bei modus=suchen, such_modus=text)",
        },
        aenderung_bis: {
          type: "string",
          description: "Nur Dateien geaendert bis YYYY-MM-DD inklusiv (nur bei modus=suchen, such_modus=text)",
        },

        // --- modus=projekt_inhalt ---
        projekt: {
          type: "string",
          description: "Name des Projekt-Ordners (nur bei modus=projekt_inhalt, Pflicht)",
        },

        // --- modus=daily ---
        daily_modus: {
          type: "string",
          enum: ["lesen", "auflisten"],
          description: "Daily-Sub-Modus: 'lesen' (Default) oder 'auflisten' (nur bei modus=daily)",
        },
        datum: {
          type: "string",
          description: "Datum YYYY-MM-DD (nur bei modus=daily, daily_modus=lesen, Default: heute)",
        },
        abschnitt: {
          type: "string",
          description: "Nur diesen H2-Abschnitt zurueckgeben (nur bei modus=daily, daily_modus=lesen)",
        },

        // --- modus=dekodieren ---
        text: {
          type: "string",
          description: "Freitext zum Dekodieren, nur bei modus=dekodieren",
        },

        // --- shared ---
        limit: {
          type: "number",
          description: "Maximale Anzahl / erste N Zeilen (bei modus=lesen, projekt_inhalt, daily)",
        },
      },
      required: ["modus"],
    },
  },
};
