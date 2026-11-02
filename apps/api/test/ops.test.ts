import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { adminRaffleListSchema, raffleReportSchema } from "@rifas/contracts";
import { createPrize, markSold, reserveTickets } from "@rifas/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { csvCell, toCsv } from "../src/http/csv";
import { shareTags } from "../src/http/share";
import worker from "../src/index";
import { BACKUP_CRON, BACKUP_RETENTION_DAYS, BACKUP_TABLES, runBackup } from "../src/jobs/backup";
import { loginClient, makeDeps, seedRaffle, seedUser, TestClock } from "./helpers";

const PASSWORD = "clave-segura-123";

async function setup() {
  const clock = new TestClock(); // 2026-11-02 10:00 en Colombia
  const { deps } = makeDeps(clock);
  const { org, raffle } = await seedRaffle(deps, { total: 200 });
  await seedUser({ orgId: org.id, email: "leo@example.com", password: PASSWORD });
  const app = createApp({ overrides: { clock } });
  const c = await loginClient(app, "leo@example.com", PASSWORD);
  return { clock, deps, org, raffle, app, c, ids: { orgId: org.id, raffleId: raffle.id } };
}

// ───────────────────────── CSV ─────────────────────────

describe("CSV: celdas seguras", () => {
  it("neutraliza fórmulas (= + - @ tab retorno) y no toca los números", () => {
    for (const evil of [
      '=HYPERLINK("http://x","y")',
      "+573001112233",
      "-1+1",
      "@SUM(A1)",
      "\tcmd",
      "\rcmd",
    ]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell(-5)).toBe("-5"); // un número real no es texto
    expect(csvCell("Ana")).toBe("Ana");
  });
  it("entrecomilla y duplica comillas; vacío para null/undefined", () => {
    expect(csvCell('Dijo "hola", y se fue')).toBe('"Dijo ""hola"", y se fue"');
    expect(csvCell("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(csvCell("  con espacios  ")).toBe('"  con espacios  "');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("BOM UTF-8 y saltos CRLF", () => {
    const csv = toCsv(["A", "B"], [["ñandú", 1]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿A,B\r\nñandú,1\r\n");
  });
});

describe("exportación CSV (HTTP)", () => {
  it("descarga con nombre de archivo, tildes y comprador; las fórmulas quedan neutralizadas", async () => {
    const { c, deps, ids, clock } = await setup();
    await markSold(deps, {
      ...ids,
      number: 7,
      payment: { status: "debe", dueDate: "2026-12-01" },
      buyer: {
        name: '=HYPERLINK("http://evil","x")',
        phone: "+573001112233",
        note: 'Dijo "pagar", luego',
      },
    });
    await markSold(deps, {
      ...ids,
      number: 8,
      payment: { status: "pagado" },
      buyer: { name: "Ñandú Pérez" },
    });
    await reserveTickets(deps, {
      orgSlug: "finaura",
      raffleSlug: "navidad",
      clientId: "c",
      numbers: [20],
    });

    const res = await c.call("GET", `/raffles/${ids.raffleId}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="rifa-navidad-2026-11-02.csv"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text.startsWith("﻿Número,Estado,Pago,")).toBe(true);
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(4); // encabezado + 007, 008 y el apartado 020
    expect(lines[1]).toContain("007,vendido,debe,2026-12-01,");
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`); // fórmula neutralizada
    expect(lines[1]).toContain("'+573001112233");
    expect(lines[1]).toContain('"Dijo ""pagar"", luego"');
    expect(lines[2]).toContain("Ñandú Pérez");
    expect(lines[3]).toMatch(/^020,apartado,,,,,,RF-[A-Z2-9]{6},2026-11-03 10:00,,/);

    // un apartado vencido ya es un número libre: no sale
    clock.advance(25 * 3600 * 1000);
    const later = (await (await c.call("GET", `/raffles/${ids.raffleId}/export.csv`)).text())
      .trim()
      .split("\r\n");
    expect(later).toHaveLength(3);
  });

  it("incluye los premios ganados de cada número", async () => {
    const { c, deps, ids } = await setup();
    await markSold(deps, {
      ...ids,
      number: 22,
      payment: { status: "pagado" },
      buyer: { name: "Ana" },
    });
    const prize = await createPrize(deps, {
      ...ids,
      description: "Moto",
      lotteryId: "chontico-noche",
      matchType: "last",
      digits: 2,
      drawDate: "2026-11-02",
      onNoWinner: "finalizar",
      maxAttempts: null,
    });
    if (!prize.ok) throw new Error(prize.error.message);
    await deps.results.saveOfficial({
      id: "r1",
      lotteryId: "chontico-noche",
      drawDate: "2026-11-02",
      number: "7422",
      series: null,
      source: "gane",
      sourceRef: null,
      orgId: null,
      fetchedAt: "x",
      raw: {},
    });
    await c.call("POST", `/raffles/${ids.raffleId}/prizes/${prize.value.id}/resolve`, {});
    const lines = (await (await c.call("GET", `/raffles/${ids.raffleId}/export.csv`)).text())
      .trim()
      .split("\r\n");
    expect(lines[1]?.endsWith(",Premio 1")).toBe(true);
  });

  it("exige sesión y no cruza organizaciones", async () => {
    const { app, deps, ids } = await setup();
    expect(
      (await app.request(`/api/v1/admin/raffles/${ids.raffleId}/export.csv`, {}, env)).status,
    ).toBe(401);
    const b = await seedRaffle(deps, { orgSlug: "org-b", raffleSlug: "rifa-b" });
    await seedUser({ orgId: b.org.id, email: "b@example.com", password: PASSWORD });
    const cb = await loginClient(app, "b@example.com", PASSWORD);
    expect((await cb.call("GET", `/raffles/${ids.raffleId}/export.csv`)).status).toBe(404);
    expect((await cb.call("GET", `/raffles/${ids.raffleId}/report`)).status).toBe(404);
  });
});

// ───────────────────────── Reporte y deudas vencidas ─────────────────────────

describe("reporte y deudas vencidas (HTTP)", () => {
  it("avance, actividad por día y deudas vencidas", async () => {
    const { c, deps, ids, clock } = await setup();
    await reserveTickets(deps, {
      orgSlug: "finaura",
      raffleSlug: "navidad",
      clientId: "c",
      numbers: [1, 2],
    });
    await markSold(deps, {
      ...ids,
      number: 10,
      payment: { status: "debe", dueDate: "2026-10-25" },
    });
    await markSold(deps, {
      ...ids,
      number: 11,
      payment: { status: "debe", dueDate: "2026-11-02" },
    }); // vence hoy
    clock.advance(24 * 3600 * 1000);
    await markSold(deps, { ...ids, number: 12, payment: { status: "pagado" } });

    const res = raffleReportSchema.parse(
      await (await c.call("GET", `/raffles/${ids.raffleId}/report`)).json(),
    );
    expect(res.raffle.stats).toMatchObject({
      sold: 3,
      paid: 1,
      owed: 2,
      overdue: 2,
      overdueAmount: 20000,
    }); // el 11 venció ayer
    expect(res.debts).toEqual({
      overdueCount: 2,
      overdueAmount: 20000,
      oldestOverdueDate: "2026-10-25",
      nextDueDate: null,
    });
    expect(res.soldPercent).toBe(1.5);
    expect(res.activity).toHaveLength(30);
    const byDay = Object.fromEntries(res.activity.map((d) => [d.day, [d.reserved, d.sold]]));
    expect(byDay["2026-11-02"]).toEqual([2, 2]);
    expect(byDay["2026-11-03"]).toEqual([0, 1]);
    expect(byDay["2026-10-15"]).toEqual([0, 0]);
  });

  it("la lista de rifas trae las deudas vencidas de cada una", async () => {
    const { c, deps, ids } = await setup();
    await markSold(deps, {
      ...ids,
      number: 10,
      payment: { status: "debe", dueDate: "2026-10-25" },
    });
    const list = adminRaffleListSchema.parse(await (await c.call("GET", "/raffles")).json());
    expect(list.raffles[0]?.stats).toMatchObject({ owed: 1, overdue: 1, overdueAmount: 10000 });
  });
});

// ───────────────────────── Respaldo a R2 ─────────────────────────

async function emptyBucket() {
  const bucket = env.BACKUPS as R2Bucket;
  let cursor: string | undefined;
  do {
    const page = await bucket.list(cursor ? { cursor } : {});
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
const bucketKeys = async () =>
  (await (env.BACKUPS as R2Bucket).list({ prefix: "backups/" })).objects.map((o) => o.key).sort();
const readText = async (key: string) => (await (env.BACKUPS as R2Bucket).get(key))?.text() ?? "";
const NOW = new Date("2026-11-03T08:00:00Z"); // 03:00 en Colombia

describe("respaldo diario a R2", () => {
  beforeEach(emptyBucket);

  it("exporta cada tabla en NDJSON con su manifiesto (hash y conteo) en backups/AAAA-MM-DD/", async () => {
    const { deps, ids } = await setup();
    await markSold(deps, {
      ...ids,
      number: 7,
      payment: { status: "pagado" },
      buyer: { name: "Ana" },
    });
    await reserveTickets(deps, {
      orgSlug: "finaura",
      raffleSlug: "navidad",
      clientId: "c",
      numbers: [1, 2],
    });

    const summary = await runBackup(env.DB, env.BACKUPS, NOW);
    expect(summary).toMatchObject({ skipped: false, prefix: "backups/2026-11-03/", deletedOld: 0 });
    expect(summary.rows).toMatchObject({ organizations: 1, raffles: 1, tickets: 3, users: 1 });

    const keys = await bucketKeys();
    expect(keys).toContain("backups/2026-11-03/manifest.json");
    for (const t of BACKUP_TABLES) expect(keys).toContain(`backups/2026-11-03/${t.name}.ndjson`);
    // lo temporal no se respalda
    expect(keys.some((k) => k.includes("sessions") || k.includes("login_attempts"))).toBe(false);

    const tickets = (await readText("backups/2026-11-03/tickets.ndjson"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(tickets.map((t) => t.number)).toEqual([1, 2, 7]);
    expect(tickets.find((t) => t.number === 7)).toMatchObject({
      status: "vendido",
      buyer_name: "Ana",
      payment_status: "pagado",
    });

    const manifest = JSON.parse(await readText("backups/2026-11-03/manifest.json"));
    expect(manifest.day).toBe("2026-11-03");
    expect(manifest.tables.tickets.rows).toBe(3);
    // integridad: el hash del manifiesto coincide con el contenido guardado
    const body = await readText("backups/2026-11-03/tickets.ndjson");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    expect(manifest.tables.tickets.sha256).toBe(
      [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
    expect(manifest.tables.tickets.bytes).toBe(new TextEncoder().encode(body).length);
  });

  it("pagina tablas grandes (más de 1000 filas) sin perder ni repetir filas", async () => {
    const { ids } = await setup();
    await env.DB.prepare(
      `INSERT INTO tickets (raffle_id, number, org_id, status, payment_status, buyer_name, sold_at, updated_at)
       WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 2499)
       SELECT ?, i, ?, 'vendido', 'pagado', 'Comprador ' || i, 'x', 'x' FROM n`,
    )
      .bind(ids.raffleId, ids.orgId)
      .run();
    // el modelo permite números hasta total_numbers; esta prueba solo valida el volumen del respaldo
    const summary = await runBackup(env.DB, env.BACKUPS, NOW);
    expect(summary.rows.tickets).toBe(2500);
    const lines = (await readText("backups/2026-11-03/tickets.ndjson")).trim().split("\n");
    expect(lines).toHaveLength(2500);
    expect(new Set(lines.map((l) => JSON.parse(l).number)).size).toBe(2500);
  });

  it("repetir el mismo día sobrescribe; borra solo las copias de más de 30 días", async () => {
    await setup();
    const bucket = env.BACKUPS as R2Bucket;
    await bucket.put("backups/2026-09-01/manifest.json", "{}"); // 63 días: se borra
    await bucket.put("backups/2026-10-03/tickets.ndjson", ""); // 31 días: se borra
    await bucket.put("backups/2026-10-04/tickets.ndjson", ""); // 30 días: se conserva
    await bucket.put("backups/2026-10-30/manifest.json", "{}"); // reciente
    await bucket.put("otro/archivo.txt", "x"); // fuera de backups/: no se toca

    const first = await runBackup(env.DB, env.BACKUPS, NOW);
    expect(first.deletedOld).toBe(2);
    const keys = await bucketKeys();
    expect(
      keys.some((k) => k.startsWith("backups/2026-09-01") || k.startsWith("backups/2026-10-03")),
    ).toBe(false);
    expect(keys).toContain("backups/2026-10-04/tickets.ndjson");
    expect(keys).toContain("backups/2026-10-30/manifest.json");
    expect(await bucket.get("otro/archivo.txt")).not.toBeNull();

    const before = keys.length;
    const second = await runBackup(env.DB, env.BACKUPS, NOW);
    expect(second.deletedOld).toBe(0);
    expect((await bucketKeys()).length).toBe(before);
    expect(BACKUP_RETENTION_DAYS).toBe(30);
  });

  it("sin bucket (R2 aún no habilitado) se omite sin error", async () => {
    expect(await runBackup(env.DB, undefined, NOW)).toEqual({
      skipped: true,
      prefix: null,
      rows: {},
      deletedOld: 0,
    });
  });

  it("el Cron diario respalda; el de cada 10 min no", async () => {
    const { deps, ids } = await setup();
    await markSold(deps, { ...ids, number: 7, payment: { status: "pagado" } });

    const ctx1 = createExecutionContext();
    await worker.scheduled(
      {
        cron: "*/10 * * * *",
        scheduledTime: Date.now(),
        noRetry() {},
      } as unknown as ScheduledController,
      env,
      ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(await bucketKeys()).toEqual([]);

    const ctx2 = createExecutionContext();
    await worker.scheduled(
      {
        cron: BACKUP_CRON,
        scheduledTime: Date.now(),
        noRetry() {},
      } as unknown as ScheduledController,
      env,
      ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect((await bucketKeys()).some((k) => k.endsWith("/manifest.json"))).toBe(true);
  });
});

// ───────────────────────── Vista previa del enlace ─────────────────────────

const INDEX_HTML =
  '<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Tu Rifa</title></head><body><div id="app"></div></body></html>';
function withAssets(seen: string[] = []) {
  const ASSETS = {
    fetch: async (req: Request) => {
      seen.push(new URL(req.url).pathname);
      return new Response(INDEX_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", etag: '"abc"' },
      });
    },
  };
  return { ...env, ASSETS } as unknown as typeof env;
}

describe("vista previa del enlace (WhatsApp)", () => {
  it("pone el título y la descripción de la rifa en el HTML", async () => {
    const clock = new TestClock();
    const { deps } = makeDeps(clock);
    await seedRaffle(deps, { total: 100 });
    const seen: string[] = [];
    const res = await createApp().request("/r/finaura/navidad", {}, withAssets(seen));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(seen).toEqual(["/index.html"]);
    expect(html).toContain("<title>Rifa de Navidad · Capital Finaura</title>");
    expect(html).toContain(
      '<meta property="og:title" content="Rifa de Navidad · Capital Finaura">',
    );
    expect(html).toContain("Elige y aparta tus números por WhatsApp");
    expect(html).toMatch(/\$10\.000 por número/);
    expect(html).toContain('<link rel="canonical" href="http://localhost/r/finaura/navidad">');
    expect(html).toContain('<div id="app">'); // el resto del HTML queda intacto
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("escapa el contenido: un título malicioso no inyecta HTML", async () => {
    const { deps } = makeDeps();
    const { org } = await seedRaffle(deps, { raffleSlug: "base" });
    await env.DB.prepare("UPDATE raffles SET title = ?, description = ? WHERE org_id = ?")
      .bind("<script>alert(1)</script> \"x\" & 'y'", '"><img src=x onerror=alert(2)>', org.id)
      .run();
    const html = await (await createApp().request("/r/finaura/base", {}, withAssets())).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &amp; &#39;y&#39;");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(2)&gt;");
  });

  it("la política de privacidad también lleva la vista previa; rifas inexistentes o en borrador, el HTML normal", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps, { raffleSlug: "navidad" });
    await seedRaffle(deps, { orgSlug: "otra-org", raffleSlug: "borrador", status: "borrador" });
    const app = createApp();
    expect(
      await (await app.request("/r/finaura/navidad/privacidad", {}, withAssets())).text(),
    ).toContain("og:title");
    for (const path of ["/r/finaura/no-existe", "/r/nadie/navidad", "/r/otra-org/borrador"]) {
      const res = await app.request(path, {}, withAssets());
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toBe(INDEX_HTML); // sin datos que filtrar: no se revela que existe un borrador
    }
  });

  it("shareTags escapa todos sus campos", () => {
    const tags = shareTags({ title: 'a"b', description: "<c>", url: "http://x/?a=1&b=2" });
    expect(tags).toContain('content="a&quot;b"');
    expect(tags).toContain('content="&lt;c&gt;"');
    expect(tags).toContain("a=1&amp;b=2");
  });
});
