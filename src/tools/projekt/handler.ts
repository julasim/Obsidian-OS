import fs from "fs";
import path from "path";
import { projectPath, ensureDir, vaultPath, safePath } from "../_lib/vault.js";
import { PROJECT_NOTES_SUBDIR } from "../_lib/config.js";
import { ok, err, relPath } from "../_lib/format.js";
import type { ToolHandler, ToolArgs } from "../_lib/types.js";

// ============================================================
// Validation
// ============================================================

/** Blockiert Pfad-Separator + Slashes + unzulaessige Filesystem-Chars im Projektnamen. */
function validateProjectName(name: string): string | null {
  if (!name.trim()) return "Name darf nicht leer sein";
  if (/[\\/:*?"<>|]/.test(name)) return "Name enthaelt unzulaessige Zeichen (\\ / : * ? \" < > |)";
  if (name === "." || name === "..") return "Name darf nicht . oder .. sein";
  if (name.length > 120) return "Name zu lang (max 120 Zeichen)";
  return null;
}

// ============================================================
// Modus: erstellen
// ============================================================

async function handleErstellen(args: ToolArgs): Promise<string> {
  const name = String(args.name ?? "").trim();
  const nameErr = validateProjectName(name);
  if (nameErr) return err(nameErr);

  const dir = projectPath(name);

  // safePath-Check: verhindert Traversal falls projectPath jemals unsauber wird
  const safe = safePath(path.relative(vaultPath, dir));
  if (!safe) return err("Ziel-Pfad liegt ausserhalb des Vaults");

  if (fs.existsSync(dir)) {
    return err(`Projekt ${name} existiert bereits unter ${relPath(dir, vaultPath)}`);
  }

  try {
    ensureDir(dir);
  } catch (e) {
    return err(`Konnte Projekt-Ordner nicht anlegen: ${String(e)}`);
  }

  // Default: Notizen/-Unterordner anlegen, ausser explizit deaktiviert
  const mitNotizen = String(args.mit_notizen_ordner ?? "true").toLowerCase() !== "false";
  let subInfo = "";
  if (mitNotizen) {
    try {
      ensureDir(path.join(dir, PROJECT_NOTES_SUBDIR));
      subInfo = ` + ${PROJECT_NOTES_SUBDIR}/`;
    } catch {
      // nicht kritisch — Hauptordner steht
    }
  }

  return ok("project", "Projekt angelegt", relPath(dir, vaultPath), `Struktur: ${name}/${subInfo}`);
}

// ============================================================
// Modus: umbenennen
// ============================================================

async function handleUmbenennen(args: ToolArgs): Promise<string> {
  const alt = String(args.name ?? "").trim();
  const neu = String(args.neuer_name ?? "").trim();

  const altErr = validateProjectName(alt);
  if (altErr) return err(`altes Name: ${altErr}`);
  const neuErr = validateProjectName(neu);
  if (neuErr) return err(`neuer Name: ${neuErr}`);
  if (alt === neu) return err("alter und neuer Name sind identisch");

  const altDir = projectPath(alt);
  const neuDir = projectPath(neu);

  // Beide Pfade durch safePath pruefen (Symlink-Schutz + Traversal-Schutz)
  const altRel = path.relative(vaultPath, altDir);
  const neuRel = path.relative(vaultPath, neuDir);
  if (!safePath(altRel)) return err("alter Pfad liegt ausserhalb des Vaults");
  if (!safePath(neuRel)) return err("neuer Pfad liegt ausserhalb des Vaults");

  if (!fs.existsSync(altDir)) {
    return err(`Projekt ${alt} existiert nicht unter ${relPath(altDir, vaultPath)}`);
  }
  if (!fs.statSync(altDir).isDirectory()) {
    return err(`${relPath(altDir, vaultPath)} ist kein Ordner`);
  }
  if (fs.existsSync(neuDir)) {
    return err(`Zielordner ${relPath(neuDir, vaultPath)} existiert bereits — kann nicht umbenennen`);
  }

  try {
    fs.renameSync(altDir, neuDir);
  } catch (e) {
    return err(`Umbenennen fehlgeschlagen: ${String(e)}`);
  }

  return ok(
    "project",
    "Projekt umbenannt",
    `${relPath(altDir, vaultPath)} -> ${relPath(neuDir, vaultPath)}`,
    "Wikilinks in anderen Notizen bleiben ggf. gebrochen — manuell pruefen",
  );
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = async (args: ToolArgs): Promise<string> => {
  const modus = String(args.modus ?? "").trim();
  if (!modus) return err("modus fehlt");

  switch (modus) {
    case "erstellen":
      return handleErstellen(args);
    case "umbenennen":
      return handleUmbenennen(args);
    default:
      return err(`Unbekannter modus: ${modus} (erwartet: erstellen | umbenennen)`);
  }
};
