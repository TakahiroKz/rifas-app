import { env } from "cloudflare:test";
import {
  adminPrizesResponseSchema,
  calendarResponseSchema,
  lotteriesResponseSchema,
  proposalSchema,
  publicRaffleResponseSchema,
  resolveResponseSchema,
  resultLookupSchema,
} from "@rifas/contracts";
import {
  createPrize,
  type LotterySource,
  markSold,
  resolvePrize,
  type SourceDraw,
  syncOfficialResults,
} from "@rifas/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createDeps } from "../src/infra/deps";
import { loginClient, makeDeps, seedRaffle, seedUser, TestClock } from "./helpers";

const PASSWORD = "clave-segura-123";

class StubSource implements LotterySource {
  enabled = true;
  data = new Map<string, SourceDraw[]>();
  calls: string[] = [];
  fail = false;
  async fetchDraws(date: string) {
    this.calls.push(date);
    if (this.fail) throw new Error("fuente caída");
    return this.data.get(date) ?? [];
  }
  publish(lotteryId: string, drawDate: string, number: string) {
    this.data.set(drawDate, [
      ...(this.data.get(drawDate) ?? []),
      { lotteryId, drawDate, number, series: "--1", sourceRef: "99", raw: { n: number } },
    ]);
  }
}

async function setup() {
  const clock = new TestClock(); // 2026-11-02 10:00 en Colombia
  const source = new StubSource();
  const { deps } = makeDeps(clock);
  deps.source = source;
  const { org, raffle } = await seedRaffle(deps);
  await seedUser({ orgId: org.id, email: "leo@example.com", password: PASSWORD });
  const app = createApp({ overrides: { clock, source } });
  const c = await loginClient(app, "leo@example.com", PASSWORD);
  const ids = { orgId: org.id, raffleId: raffle.id };
  const official = (lotteryId: string, drawDate: string, number: string) =>
    deps.results.saveOfficial({
      id: crypto.randomUUID(),
      lotteryId,
      drawDate,
      number,
      series: "--1",
      source: "gane",
      sourceRef: "1",
      orgId: null,
      fetchedAt: "x",
      raw: {},
    });
  return { clock, source, deps, app, c, org, raffle, ids, official };
}

const prizeBody = (over: Record<string, unknown> = {}) => ({
  description: "Moto 0 km",
  lotteryId: "chontico-noche",
  matchType: "last",
  digits: 2,
  drawDate: "2026-11-02",
  onNoWinner: "finalizar",
  maxAttempts: null,
  ...over,
});

describe("loterías y calendario (HTTP)", () => {
  it("lista los juegos y si la consulta automática está activa", async () => {
    const { c } = await setup();
    const res = lotteriesResponseSchema.parse(await (await c.call("GET", "/lotteries")).json());
    expect(res.lotteries.map((l) => l.id)).toEqual([
      "chontico-noche",
      "dorado-noche",
      "loteria-del-valle",
    ]);
    expect(res.syncEnabled).toBe(true); // la fuente de prueba está activa
  });

  it("el calendario del Valle solo trae miércoles; el de Chontico, todos los días", async () => {
    const { c } = await setup();
    const valle = calendarResponseSchema.parse(
      await (
        await c.call("GET", "/lotteries/loteria-del-valle/calendar?from=2026-11-01&to=2026-11-30")
      ).json(),
    );
    expect(valle.days).toEqual(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    const chontico = calendarResponseSchema.parse(
      await (
        await c.call("GET", "/lotteries/chontico-noche/calendar?from=2026-11-01&to=2026-11-07")
      ).json(),
    );
    expect(chontico.days).toHaveLength(7);
    expect((await c.call("GET", "/lotteries/otra/calendar")).status).toBe(404);
    expect(
      (await c.call("GET", "/lotteries/chontico-noche/calendar?from=2026-11-10&to=2026-11-01"))
        .status,
    ).toBe(400);
  });
});

describe("premios: flujo completo por HTTP", () => {
  it("crear → vender → resultado → propuesta → confirmar → público ve solo números", async () => {
    const { c, app, raffle, official } = await setup();
    const id = raffle.id;
    const p1 = await c.call("POST", `/raffles/${id}/prizes`, prizeBody());
    expect(p1.status).toBe(201);
    const first = (await p1.json()) as { id: string; place: number; lotteryName: string };
    expect(first).toMatchObject({ place: 1, lotteryName: "Chontico Noche" });
    const p2 = await c.call(
      "POST",
      `/raffles/${id}/prizes`,
      prizeBody({ description: "Televisor", matchType: "first" }),
    );
    const second = (await p2.json()) as { id: string };

    await c.call("PUT", `/raffles/${id}/tickets/22/sale`, {
      payment: { status: "debe", dueDate: "2026-12-01" },
      buyer: { name: "Ana Pérez", phone: "3001112233" },
    });
    await c.call("PUT", `/raffles/${id}/tickets/74/sale`, {
      payment: { status: "pagado" },
      buyer: { name: "Luis Gómez" },
    });

    // sin resultado todavía
    const before = proposalSchema.parse(
      await (await c.call("GET", `/raffles/${id}/prizes/${first.id}/proposal`)).json(),
    );
    expect(before.outcome).toBe("sin_resultado");
    expect((await c.call("POST", `/raffles/${id}/prizes/${first.id}/resolve`, {})).status).toBe(
      409,
    );

    await official("chontico-noche", "2026-11-02", "7422");
    const prop = proposalSchema.parse(
      await (await c.call("GET", `/raffles/${id}/prizes/${first.id}/proposal`)).json(),
    );
    expect(prop).toMatchObject({
      outcome: "ganador",
      term: "22",
      unsoldMatches: 0,
      result: { number: "7422", source: "gane" },
    });
    expect(prop.winners).toEqual([
      { number: 22, buyerName: "Ana Pérez", buyerPhone: "3001112233", paymentStatus: "debe" },
    ]);

    const r1 = resolveResponseSchema.parse(
      await (await c.call("POST", `/raffles/${id}/prizes/${first.id}/resolve`, {})).json(),
    );
    expect(r1).toMatchObject({ outcome: "ganador", status: "anunciado", winningNumbers: [22] });
    const r2 = resolveResponseSchema.parse(
      await (await c.call("POST", `/raffles/${id}/prizes/${second.id}/resolve`, {})).json(),
    );
    expect(r2.winningNumbers).toEqual([74]); // 2.º lugar: primeras 2 cifras

    // el administrador ve a los compradores ganadores
    const admin = adminPrizesResponseSchema.parse(
      await (await c.call("GET", `/raffles/${id}/prizes`)).json(),
    );
    expect(admin.prizes.map((p) => [p.place, p.status, p.winners.map((w) => w.buyerName)])).toEqual(
      [
        [1, "anunciado", ["Ana Pérez"]],
        [2, "anunciado", ["Luis Gómez"]],
      ],
    );

    // el público ve solo los números y el resultado, nunca nombres ni teléfonos
    const text = await (await app.request("/api/v1/public/finaura/navidad", {}, env)).text();
    const pub = publicRaffleResponseSchema.parse(JSON.parse(text));
    expect(pub.prizes).toEqual([
      {
        place: 1,
        description: "Moto 0 km",
        lotteryName: "Chontico Noche",
        drawDate: "2026-11-02",
        status: "anunciado",
        resultNumber: "7422",
        winningNumbers: [22],
      },
      {
        place: 2,
        description: "Televisor",
        lotteryName: "Chontico Noche",
        drawDate: "2026-11-02",
        status: "anunciado",
        resultNumber: "7422",
        winningNumbers: [74],
      },
    ]);
    expect(text).not.toMatch(/Ana|Luis|3001112233/);

    // ya resuelto: no se puede volver a confirmar, editar ni borrar
    expect((await c.call("POST", `/raffles/${id}/prizes/${first.id}/resolve`, {})).status).toBe(
      409,
    );
    expect(
      (await c.call("PATCH", `/raffles/${id}/prizes/${first.id}`, { description: "x" })).status,
    ).toBe(409);
    expect((await c.call("DELETE", `/raffles/${id}/prizes/${first.id}`)).status).toBe(409);
  });

  it("sin ganador y reprogramar: fecha solo de días con sorteo; queda el historial", async () => {
    const { c, raffle, official } = await setup();
    const id = raffle.id;
    const created = (await (
      await c.call(
        "POST",
        `/raffles/${id}/prizes`,
        prizeBody({
          lotteryId: "loteria-del-valle",
          drawDate: "2026-10-28",
          onNoWinner: "reprogramar",
          maxAttempts: 2,
        }),
      )
    ).json()) as { id: string };
    await official("loteria-del-valle", "2026-10-28", "7544");
    const resolve = (body: unknown) =>
      c.call("POST", `/raffles/${id}/prizes/${created.id}/resolve`, body);

    expect((await resolve({})).status).toBe(400); // falta la fecha
    expect((await resolve({ nextDrawDate: "2026-11-03" })).status).toBe(400); // martes
    expect((await resolve({ nextDrawDate: "2026-10-21" })).status).toBe(400); // anterior
    const ok = resolveResponseSchema.parse(
      await (await resolve({ nextDrawDate: "2026-11-04" })).json(),
    );
    expect(ok).toMatchObject({
      outcome: "sin_ganador",
      status: "pendiente",
      nextDrawDate: "2026-11-04",
    });

    const prizes = adminPrizesResponseSchema.parse(
      await (await c.call("GET", `/raffles/${id}/prizes`)).json(),
    );
    expect(prizes.prizes[0]).toMatchObject({ drawDate: "2026-11-04", status: "pendiente" });
    expect(prizes.prizes[0]?.attempts).toMatchObject([
      { attemptNo: 1, drawDate: "2026-10-28", resultNumber: "7544", outcome: "sin_ganador" },
    ]);
  });

  it("validaciones: 400 y 409", async () => {
    const { c, raffle } = await setup();
    const id = raffle.id;
    const post = (over: Record<string, unknown>) =>
      c.call("POST", `/raffles/${id}/prizes`, prizeBody(over));
    expect((await post({ digits: 3 })).status).toBe(400); // la rifa es de 2 cifras
    expect((await post({ lotteryId: "loteria-del-valle" })).status).toBe(400); // lunes
    expect((await post({ lotteryId: "otra" })).status).toBe(400);
    expect((await post({ drawDate: "2026-02-30" })).status).toBe(400);
    expect((await post({ onNoWinner: "otra" })).status).toBe(400); // rechazado por el contrato
    expect((await post({ place: 1 })).status).toBe(201);
    expect((await post({ place: 1 })).status).toBe(409);
    expect((await c.call("POST", `/raffles/${id}/prizes`, "no json")).status).toBe(400);
  });
});

describe("resolución atómica", () => {
  it("dos confirmaciones simultáneas: solo una se registra", async () => {
    const { deps, ids, official } = await setup();
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
    await markSold(deps, {
      ...ids,
      number: 22,
      payment: { status: "pagado" },
      buyer: { name: "Ana" },
    });
    await official("chontico-noche", "2026-11-02", "7422");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => resolvePrize(deps, { ...ids, prizeId: prize.value.id })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const { results: attempts } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM prize_draw_attempts",
    ).all<{ n: number }>();
    const { results: winners } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM prize_winners",
    ).all<{ n: number }>();
    expect(attempts[0]?.n).toBe(1);
    expect(winners[0]?.n).toBe(1);
  });
});

describe("resultados manuales y oficiales (HTTP)", () => {
  it("manual por organización, validado; el oficial pisa al manual y lo bloquea", async () => {
    const { c, official } = await setup();
    const put = (date: string, number: unknown) =>
      c.call("PUT", `/lotteries/chontico-noche/results/${date}`, { number });
    expect((await put("2026-11-01", "0712")).status).toBe(200);
    const got = resultLookupSchema.parse(
      await (await c.call("GET", "/lotteries/chontico-noche/results/2026-11-01")).json(),
    );
    expect(got.result).toMatchObject({ number: "0712", source: "manual" });
    expect((await put("2026-11-01", "1111")).status).toBe(200); // corregir
    expect((await put("2026-11-03", "1111")).status).toBe(400); // futuro
    expect((await put("2026-11-01", "12")).status).toBe(400);
    expect(
      (await c.call("PUT", "/lotteries/chontico-noche/results/2026-11-01", { numero: "1" })).status,
    ).toBe(400);

    await official("chontico-noche", "2026-11-01", "7059");
    const official2 = resultLookupSchema.parse(
      await (await c.call("GET", "/lotteries/chontico-noche/results/2026-11-01")).json(),
    );
    expect(official2.result).toMatchObject({ number: "7059", source: "gane" });
    expect((await put("2026-11-01", "2222")).status).toBe(409);
  });

  it("«Consultar ahora»: encuentra, no encuentra, o la fuente falla (502)", async () => {
    const { c, source } = await setup();
    const fetchNow = (date: string) =>
      c.call("POST", `/lotteries/chontico-noche/results/${date}/fetch`);
    expect(await (await fetchNow("2026-11-01")).json()).toEqual({ found: false });
    source.publish("chontico-noche", "2026-11-01", "7059");
    expect(await (await fetchNow("2026-11-01")).json()).toEqual({ found: true });
    source.fail = true;
    const down = await fetchNow("2026-10-31");
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ error: { code: "source_unavailable" } });
    expect((await fetchNow("2026-11-03")).status).toBe(400); // futuro
  });

  it("con la consulta automática desactivada, pide ingresar a mano (409)", async () => {
    const { c, app } = await setup();
    // la configuración real: LOTTERY_SYNC_ENABLED != "true" → fuente desactivada
    const disabledApp = createApp({ overrides: { clock: new TestClock() } });
    const client = await loginClient(disabledApp, "leo@example.com", PASSWORD);
    const res = await client.call("POST", "/lotteries/chontico-noche/results/2026-11-01/fetch");
    expect(res.status).toBe(409);
    const lot = lotteriesResponseSchema.parse(
      await (await client.call("GET", "/lotteries")).json(),
    );
    expect(lot.syncEnabled).toBe(false);
    expect(c).toBeDefined();
    expect(app).toBeDefined();
  });
});

describe("sincronización oficial con D1", () => {
  it("guarda una vez, no sobrescribe y respeta la hora de publicación", async () => {
    const { clock, source, deps, ids } = await setup();
    await createPrize(deps, {
      ...ids,
      description: "A",
      lotteryId: "chontico-noche",
      matchType: "last",
      digits: 2,
      drawDate: "2026-11-02",
      onNoWinner: "finalizar",
      maxAttempts: null,
    });
    await createPrize(deps, {
      ...ids,
      description: "B",
      lotteryId: "dorado-noche",
      matchType: "first",
      digits: 1,
      drawDate: "2026-11-02",
      onNoWinner: "finalizar",
      maxAttempts: null,
    });
    source.publish("chontico-noche", "2026-11-02", "7422");
    source.publish("dorado-noche", "2026-11-02", "0862");

    expect((await syncOfficialResults(deps)).dates).toBe(0); // 10:00: demasiado temprano
    clock.advance(10 * 3600 * 1000);
    expect(await syncOfficialResults(deps)).toMatchObject({ dates: 1, saved: 2, errors: 0 });
    expect(source.calls).toEqual(["2026-11-02"]);
    expect((await deps.results.findOfficial("dorado-noche", "2026-11-02"))?.number).toBe("0862");
    expect((await syncOfficialResults(deps)).dates).toBe(0);

    // un resultado oficial nunca se sobrescribe
    const again = await deps.results.saveOfficial({
      id: "otro",
      lotteryId: "chontico-noche",
      drawDate: "2026-11-02",
      number: "0000",
      series: null,
      source: "gane",
      sourceRef: null,
      orgId: null,
      fetchedAt: "x",
      raw: {},
    });
    expect(again).toBe(false);
    expect((await deps.results.findOfficial("chontico-noche", "2026-11-02"))?.number).toBe("7422");
  });

  it("si la fuente falla no revienta y se reintenta", async () => {
    const { clock, source, deps, ids } = await setup();
    await createPrize(deps, {
      ...ids,
      description: "A",
      lotteryId: "chontico-noche",
      matchType: "last",
      digits: 2,
      drawDate: "2026-11-02",
      onNoWinner: "finalizar",
      maxAttempts: null,
    });
    clock.advance(10 * 3600 * 1000);
    source.fail = true;
    expect(await syncOfficialResults(deps)).toMatchObject({ errors: 1, saved: 0 });
    source.fail = false;
    source.publish("chontico-noche", "2026-11-02", "7422");
    expect(await syncOfficialResults(deps)).toMatchObject({ errors: 0, saved: 1 });
  });

  it("con Gane desactivado por configuración no consulta nada", async () => {
    const { deps, ids } = await setup();
    await createPrize(deps, {
      ...ids,
      description: "A",
      lotteryId: "chontico-noche",
      matchType: "last",
      digits: 2,
      drawDate: "2026-11-02",
      onNoWinner: "finalizar",
      maxAttempts: null,
    });
    const real = createDeps(
      { DB: env.DB, LOTTERY_SYNC_ENABLED: "false" },
      { clock: new TestClock(new Date("2026-11-03T02:00:00Z")) },
    );
    expect(real.source.enabled).toBe(false);
    expect(await syncOfficialResults(real)).toMatchObject({ skipped: true, dates: 0 });
    expect(createDeps({ DB: env.DB, LOTTERY_SYNC_ENABLED: "true" }).source.enabled).toBe(true);
  });
});

describe("aislamiento entre organizaciones (premios)", () => {
  it("B no ve ni toca los premios ni los resultados manuales de A", async () => {
    const { deps, app, c, raffle } = await setup();
    const created = (await (
      await c.call("POST", `/raffles/${raffle.id}/prizes`, prizeBody())
    ).json()) as { id: string };
    await c.call("PUT", "/lotteries/chontico-noche/results/2026-11-02", { number: "7422" });

    const b = await seedRaffle(deps, { orgSlug: "org-b", raffleSlug: "rifa-b" });
    await seedUser({ orgId: b.org.id, email: "b@example.com", password: PASSWORD });
    const cb = await loginClient(app, "b@example.com", PASSWORD);

    const attempts: [string, string, unknown?][] = [
      ["GET", `/raffles/${raffle.id}/prizes`],
      ["POST", `/raffles/${raffle.id}/prizes`, prizeBody({ place: 5 })],
      ["PATCH", `/raffles/${raffle.id}/prizes/${created.id}`, { description: "Hackeado" }],
      ["DELETE", `/raffles/${raffle.id}/prizes/${created.id}`],
      ["GET", `/raffles/${raffle.id}/prizes/${created.id}/proposal`],
      ["POST", `/raffles/${raffle.id}/prizes/${created.id}/resolve`, {}],
    ];
    for (const [method, path, payload] of attempts) {
      expect([method, path, (await cb.call(method, path, payload)).status]).toEqual([
        method,
        path,
        404,
      ]);
    }
    // el resultado manual de A no existe para B
    const mine = resultLookupSchema.parse(
      await (await cb.call("GET", "/lotteries/chontico-noche/results/2026-11-02")).json(),
    );
    expect(mine.result).toBeNull();
    // y la rifa de B usa su propio premio sin ver el de A
    const own = await cb.call("POST", `/raffles/${b.raffle.id}/prizes`, prizeBody());
    expect(own.status).toBe(201);
    const list = adminPrizesResponseSchema.parse(
      await (await cb.call("GET", `/raffles/${b.raffle.id}/prizes`)).json(),
    );
    expect(list.prizes).toHaveLength(1);
  });
});

describe("restricciones de la base", () => {
  it("rechaza resultados con número inválido, ambigüedad de origen y lugares repetidos", async () => {
    const { ids } = await setup();
    const ins = (number: string, source: string, orgId: string | null) =>
      env.DB.prepare(
        "INSERT INTO draw_results (id, lottery_id, draw_date, number, source, org_id, fetched_at) VALUES (?, 'chontico-noche', '2026-11-02', ?, ?, ?, 'x')",
      )
        .bind(crypto.randomUUID(), number, source, orgId)
        .run();
    await expect(ins("712", "gane", null)).rejects.toThrow(); // 3 cifras
    await expect(ins("07a2", "gane", null)).rejects.toThrow();
    await expect(ins("0712", "manual", null)).rejects.toThrow(); // manual sin organización
    await expect(ins("0712", "gane", ids.orgId)).rejects.toThrow(); // oficial con organización
    await expect(ins("0712", "gane", null)).resolves.toBeDefined();
    await expect(ins("0713", "gane", null)).rejects.toThrow(); // oficial duplicado del mismo juego y día
    const dupPlace = (place: number) =>
      env.DB.prepare(
        "INSERT INTO raffle_prizes (id, org_id, raffle_id, place, description, lottery_id, match_type, digits, draw_date, on_no_winner, status, created_at) VALUES (?, ?, ?, ?, 'x', 'chontico-noche', 'last', 2, '2026-11-02', 'finalizar', 'pendiente', 'x')",
      )
        .bind(crypto.randomUUID(), ids.orgId, ids.raffleId, place)
        .run();
    await expect(dupPlace(1)).resolves.toBeDefined();
    await expect(dupPlace(1)).rejects.toThrow();
  });
});
