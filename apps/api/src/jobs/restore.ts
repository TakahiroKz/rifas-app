import { BACKUP_TABLES } from "./backup";

export interface BackupFiles {
  /** Contenido de manifest.json */
  manifest: string;
  /** Contenido de cada `<tabla>.ndjson`, por nombre de tabla. */
  tables: Record<string, string>;
}

interface Manifest {
  day: string;
  tables: Record<string, { rows: number; bytes: number; sha256: string }>;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** Literal SQL de un valor leído de un respaldo (solo texto, número o null). */
export function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return quote(value);
  throw new Error(`Valor no soportado en el respaldo: ${typeof value}`);
}

/**
 * Convierte una copia de seguridad en sentencias INSERT, en orden seguro para las claves foráneas.
 * Antes de generar nada verifica que cada archivo coincide con el manifiesto (tamaño, hash y filas),
 * así una copia dañada o incompleta se rechaza en lugar de restaurarse a medias.
 * `d1_migrations` no se restaura: la base destino ya trae sus migraciones aplicadas.
 */
export async function buildRestoreStatements(files: BackupFiles): Promise<string[]> {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(files.manifest) as Manifest;
  } catch {
    throw new Error("El manifiesto del respaldo no es JSON válido");
  }
  if (!manifest?.tables) throw new Error("El manifiesto del respaldo no tiene tablas");

  const statements: string[] = [];
  for (const { name } of BACKUP_TABLES) {
    if (name === "d1_migrations") continue;
    const expected = manifest.tables[name];
    const body = files.tables[name];
    if (!expected || body === undefined) throw new Error(`Falta la tabla ${name} en el respaldo`);
    if (
      new TextEncoder().encode(body).length !== expected.bytes ||
      (await sha256Hex(body)) !== expected.sha256
    ) {
      throw new Error(`El archivo de ${name} no coincide con el manifiesto (dañado o incompleto)`);
    }
    const lines = body.split("\n").filter((l) => l.length > 0);
    if (lines.length !== expected.rows)
      throw new Error(
        `La tabla ${name} tiene ${lines.length} filas y el manifiesto dice ${expected.rows}`,
      );
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>;
      const cols = Object.keys(row);
      statements.push(
        `INSERT INTO ${name} (${cols.join(", ")}) VALUES (${cols.map((c) => sqlValue(row[c])).join(", ")})`,
      );
    }
  }
  return statements;
}

/** Mismo contenido como script SQL para `wrangler d1 execute --file`. */
export async function buildRestoreSql(files: BackupFiles): Promise<string> {
  const statements = await buildRestoreStatements(files);
  const day = (JSON.parse(files.manifest) as Manifest).day;
  return `-- Restauración del respaldo del ${day}\n${statements.map((s) => `${s};`).join("\n")}\n`;
}
