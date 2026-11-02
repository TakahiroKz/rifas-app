import { bogotaDate } from "@rifas/core";

/** Cron diario del respaldo: 03:00 en Colombia (08:00 UTC). Debe coincidir con `triggers.crons` en wrangler.jsonc. */
export const BACKUP_CRON = "0 8 * * *";
export const BACKUP_RETENTION_DAYS = 30;
const PAGE = 1000;

/**
 * Tablas respaldadas y su orden estable (algunas son WITHOUT ROWID, por eso no se usa rowid).
 * Se excluyen `sessions` y `login_attempts`: son temporales y no hay por qué conservarlas.
 */
export const BACKUP_TABLES: { name: string; order: string }[] = [
  { name: "users", order: "id" },
  { name: "organizations", order: "id" },
  { name: "memberships", order: "user_id, org_id" },
  { name: "raffles", order: "id" },
  { name: "tickets", order: "raffle_id, number" },
  { name: "ticket_events", order: "id" },
  { name: "draw_results", order: "id" },
  { name: "raffle_prizes", order: "id" },
  { name: "prize_draw_attempts", order: "id" },
  { name: "prize_winners", order: "prize_id, number" },
  { name: "d1_migrations", order: "id" },
];

export interface BackupSummary {
  skipped: boolean;
  prefix: string | null;
  rows: Record<string, number>;
  deletedOld: number;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function dumpTable(
  db: D1Database,
  name: string,
  order: string,
): Promise<{ ndjson: string; rows: number }> {
  const lines: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { results } = await db
      .prepare(`SELECT * FROM ${name} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(PAGE, offset)
      .all<Record<string, unknown>>();
    for (const row of results) lines.push(JSON.stringify(row));
    if (results.length < PAGE) break;
  }
  return { ndjson: lines.length ? `${lines.join("\n")}\n` : "", rows: lines.length };
}

/** Borra las copias de más de BACKUP_RETENTION_DAYS días. */
async function pruneOld(bucket: R2Bucket, today: string): Promise<number> {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - BACKUP_RETENTION_DAYS);
  const limit = cutoff.toISOString().slice(0, 10);
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "backups/", ...(cursor ? { cursor } : {}) });
    const old = page.objects
      .filter((o) => (o.key.split("/")[1] ?? "9999") < limit)
      .map((o) => o.key);
    if (old.length) {
      await bucket.delete(old);
      deleted += old.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

/**
 * Exporta las tablas a R2 como NDJSON (una fila JSON por línea) en `backups/AAAA-MM-DD/`.
 * El `manifest.json` se escribe al final: una copia sin manifiesto está incompleta.
 * Sin el enlace R2 (aún no habilitado) no hace nada.
 */
export async function runBackup(
  db: D1Database,
  bucket: R2Bucket | undefined,
  now: Date,
): Promise<BackupSummary> {
  if (!bucket) return { skipped: true, prefix: null, rows: {}, deletedOld: 0 };

  const today = bogotaDate(now);
  const prefix = `backups/${today}/`;
  const rows: Record<string, number> = {};
  const tables: Record<string, { rows: number; bytes: number; sha256: string }> = {};

  for (const { name, order } of BACKUP_TABLES) {
    const { ndjson, rows: count } = await dumpTable(db, name, order);
    await bucket.put(`${prefix}${name}.ndjson`, ndjson, {
      httpMetadata: { contentType: "application/x-ndjson" },
    });
    rows[name] = count;
    tables[name] = {
      rows: count,
      bytes: new TextEncoder().encode(ndjson).length,
      sha256: await sha256Hex(ndjson),
    };
  }

  await bucket.put(
    `${prefix}manifest.json`,
    JSON.stringify({ createdAt: now.toISOString(), day: today, tables }, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );
  return { skipped: false, prefix, rows, deletedOld: await pruneOld(bucket, today) };
}
