import { env } from "cloudflare:test";
import { createPrize, markSold, reserveTickets } from "@rifas/core";
import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, runBackup } from "../src/jobs/backup";
import {
  type BackupFiles,
  buildRestoreSql,
  buildRestoreStatements,
  sqlValue,
} from "../src/jobs/restore";
import { makeDeps, seedRaffle, seedUser } from "./helpers";

const NOW = new Date("2026-11-03T08:00:00Z");

async function wipeBucket() {
  const b = env.BACKUPS as R2Bucket;
  const page = await b.list({});
  if (page.objects.length) await b.delete(page.objects.map((o) => o.key));
}

async function readBackup(): Promise<BackupFiles> {
  const b = env.BACKUPS as R2Bucket;
  const prefix = "backups/2026-11-03/";
  const tables: Record<string, string> = {};
  for (const { name } of BACKUP_TABLES)
    tables[name] = (await (await b.get(`${prefix}${name}.ndjson`))?.text()) ?? "";
  return { manifest: (await (await b.get(`${prefix}manifest.json`))?.text()) ?? "", tables };
}

const RESTORABLE = BACKUP_TABLES.filter((t) => t.name !== "d1_migrations");
async function snapshot() {
  const out: Record<string, unknown[]> = {};
  for (const { name, order } of RESTORABLE) {
    out[name] = (await env.DB.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all()).results;
  }
  return out;
}

describe("sqlValue", () => {
  it("escapa comillas y soporta null, números y texto", () => {
    expect(sqlValue(null)).toBe("NULL");
    expect(sqlValue(42)).toBe("42");
    expect(sqlValue("Dijo 'hola'")).toBe("'Dijo ''hola'''");
    expect(sqlValue("línea 1\nlínea 2 🏆")).toBe("'línea 1\nlínea 2 🏆'");
    expect(() => sqlValue({})).toThrow();
    expect(() => sqlValue(Number.NaN)).toThrow();
  });
});

describe("restaurar un respaldo", () => {
  async function seed() {
    await wipeBucket();
    const { deps } = makeDeps();
    const { org, raffle } = await seedRaffle(deps, { total: 100 });
    await seedUser({ orgId: org.id, email: "leo@example.com", password: "clave-segura-123" });
    const ids = { orgId: org.id, raffleId: raffle.id };
    await markSold(deps, {
      ...ids,
      number: 22,
      payment: { status: "debe", dueDate: "2026-12-01" },
      buyer: { name: 'Ñandú "El Rápido"', phone: "+57 300", note: "línea 1\nlínea 2 'x' 🏆" },
    });
    await reserveTickets(deps, {
      orgSlug: "finaura",
      raffleSlug: "navidad",
      clientId: "c",
      numbers: [1, 2],
    });
    const prize = await createPrize(deps, {
      ...ids,
      description: "Moto",
      lotteryId: "chontico-noche",
      matchType: "last",
      digits: 2,
      drawDate: "2026-11-02",
      onNoWinner: "reprogramar",
      maxAttempts: 3,
    });
    if (!prize.ok) throw new Error(prize.error.message);
    await deps.results.saveOfficial({
      id: "r1",
      lotteryId: "chontico-noche",
      drawDate: "2026-11-02",
      number: "7422",
      series: "--1",
      source: "gane",
      sourceRef: "9",
      orgId: null,
      fetchedAt: "x",
      raw: { a: 1 },
    });
    return ids;
  }

  it("ida y vuelta: respaldar, borrar todo, restaurar y obtener exactamente lo mismo", async () => {
    await seed();
    const before = await snapshot();
    expect((before.tickets as unknown[]).length).toBe(3);
    await runBackup(env.DB, env.BACKUPS, NOW);

    // Se simula una base nueva: se borran las tablas en orden inverso a las claves foráneas.
    await env.DB.batch(
      [...RESTORABLE].reverse().map((t) => env.DB.prepare(`DELETE FROM ${t.name}`)),
    );
    const empty = await snapshot();
    expect(Object.values(empty).every((rows) => rows.length === 0)).toBe(true);

    const statements = await buildRestoreStatements(await readBackup());
    expect(statements.length).toBeGreaterThan(8);
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
    expect(await snapshot()).toEqual(before);
  });

  it("el script SQL trae un INSERT por fila y escapa bien el texto", async () => {
    await seed();
    await runBackup(env.DB, env.BACKUPS, NOW);
    const sql = await buildRestoreSql(await readBackup());
    expect(sql.startsWith("-- Restauración del respaldo del 2026-11-03")).toBe(true);
    expect(sql.split("\n").filter((l) => l.startsWith("INSERT INTO tickets")).length).toBe(3);
    expect(sql).toContain("'línea 1\nlínea 2 ''x'' 🏆'");
    expect(sql).not.toContain("d1_migrations");
    expect(sql).not.toMatch(/password_hash\s*=\s*$/m);
  });

  it("rechaza una copia alterada, incompleta o con manifiesto roto", async () => {
    await seed();
    await runBackup(env.DB, env.BACKUPS, NOW);
    const good = await readBackup();

    const tampered = {
      ...good,
      tables: { ...good.tables, tickets: good.tables.tickets?.replace("vendido", "vendidx") ?? "" },
    };
    await expect(buildRestoreStatements(tampered)).rejects.toThrow(
      /tickets no coincide con el manifiesto/,
    );

    const missing = { ...good, tables: { ...good.tables } };
    delete missing.tables.raffles;
    await expect(buildRestoreStatements(missing)).rejects.toThrow(/Falta la tabla raffles/);

    await expect(buildRestoreStatements({ ...good, manifest: "{no es json" })).rejects.toThrow(
      /no es JSON válido/,
    );
    await expect(buildRestoreStatements({ ...good, manifest: "{}" })).rejects.toThrow(
      /no tiene tablas/,
    );

    // Cambia el contenido y el hash del manifiesto pero no el conteo de filas
    const m = JSON.parse(good.manifest);
    const extra = `${good.tables.organizations}${good.tables.organizations}`;
    const forged = {
      manifest: JSON.stringify({
        ...m,
        tables: {
          ...m.tables,
          organizations: {
            rows: 1,
            bytes: new TextEncoder().encode(extra).length,
            sha256: await (async () => {
              const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(extra));
              return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
            })(),
          },
        },
      }),
      tables: { ...good.tables, organizations: extra },
    };
    await expect(buildRestoreStatements(forged)).rejects.toThrow(
      /tiene 2 filas y el manifiesto dice 1/,
    );
  });
});
