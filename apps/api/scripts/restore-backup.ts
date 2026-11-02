/**
 * Genera y aplica el SQL de restauración de una copia de seguridad descargada de R2.
 *
 *   pnpm --filter @rifas/api exec tsx scripts/restore-backup.ts --dir ./respaldo/2026-11-03 [--remote --yes]
 *
 * Úsalo SIEMPRE sobre una base nueva y vacía (con las migraciones ya aplicadas), nunca sobre la de producción
 * en uso. Ver docs/OPERACION.md. Sin --remote actúa sobre la base local.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRestoreSql } from "../src/jobs/restore";
import { arg, fail, flag, runD1 } from "./lib";

const dir = arg("dir");
const remote = flag("remote");
if (!dir) fail("falta --dir (carpeta con manifest.json y los .ndjson descargados)");
if (remote && !flag("yes"))
  fail("para restaurar en la base remota agrega --yes (confirma que es una base nueva y vacía)");

let files: Record<string, string>;
try {
  files = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
} catch {
  fail(`no se pudo leer la carpeta ${dir}`);
}
if (!files["manifest.json"]) fail("la carpeta no tiene manifest.json");

const tables = Object.fromEntries(
  Object.entries(files)
    .filter(([f]) => f.endsWith(".ndjson"))
    .map(([f, body]) => [f.replace(/\.ndjson$/, ""), body]),
);

let sql: string;
try {
  sql = await buildRestoreSql({ manifest: files["manifest.json"] as string, tables });
} catch (e) {
  fail((e as Error).message);
}
const count = sql.split("\n").filter((l) => l.startsWith("INSERT")).length;
console.log(
  `Respaldo verificado: ${count} filas para restaurar en la base ${remote ? "REMOTA" : "local"}.`,
);

const done = runD1(sql, remote);
if (!done.ok)
  fail("no se pudo restaurar (¿la base destino está vacía y con las migraciones aplicadas?)");
console.log("Restauración completa.");
