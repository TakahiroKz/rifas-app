import { describe, expect, it } from "vitest";
import { drawDaysBetween, getGame, isDrawDay } from "./lotteries";
import { createOrganization } from "./organizations";
import { matchingNumbers, ticketMatches, winningTerm } from "./prize-rules";
import {
  createPrize,
  deletePrize,
  enterManualResult,
  fetchResultNow,
  getProposal,
  listPrizes,
  listPublicPrizes,
  type PrizeInput,
  resolvePrize,
  syncOfficialResults,
  updatePrize,
} from "./prizes";
import { createRaffle } from "./raffles";
import { createTestDeps } from "./test-support";
import { markSold, reserveTickets } from "./tickets";

describe("calendario de loterías", () => {
  it("Chontico y Dorado sortean todos los días; el Valle solo los miércoles", () => {
    expect(isDrawDay("chontico-noche", "2026-11-01")).toBe(true); // domingo
    expect(isDrawDay("dorado-noche", "2026-11-02")).toBe(true); // lunes festivo
    expect(isDrawDay("loteria-del-valle", "2026-11-04")).toBe(true); // miércoles
    for (const d of [
      "2026-11-02",
      "2026-11-03",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]) {
      expect(isDrawDay("loteria-del-valle", d)).toBe(false);
    }
    expect(isDrawDay("no-existe", "2026-11-04")).toBe(false);
  });
  it("lista los días de sorteo de un rango", () => {
    expect(drawDaysBetween("loteria-del-valle", "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-04",
      "2026-11-11",
      "2026-11-18",
      "2026-11-25",
    ]);
    expect(drawDaysBetween("chontico-noche", "2026-11-01", "2026-11-03")).toHaveLength(3);
    expect(getGame("loteria-del-valle")?.name).toBe("Lotería del Valle");
  });
});

describe("regla por terminación", () => {
  it("primeras y últimas cifras del resultado", () => {
    expect(winningTerm("7422", "last", 2)).toBe("22");
    expect(winningTerm("7422", "first", 2)).toBe("74");
    expect(winningTerm("0712", "last", 4)).toBe("0712");
    expect(winningTerm("0712", "first", 1)).toBe("0");
  });
  it("ejemplo del negocio: 1.er lugar últimas 2 cifras, 2.º lugar primeras 2 cifras (rifa 00–99)", () => {
    expect(ticketMatches(22, 2, "7422", "last", 2)).toBe(true);
    expect(ticketMatches(74, 2, "7422", "last", 2)).toBe(false);
    expect(ticketMatches(74, 2, "7422", "first", 2)).toBe(true);
    expect(ticketMatches(7, 2, "0712", "first", 2)).toBe(true);
  });
  it("con menos cifras que el ancho coinciden varios números", () => {
    const m = matchingNumbers(100, 2, "7422", "last", 1);
    expect(m).toEqual([2, 12, 22, 32, 42, 52, 62, 72, 82, 92]);
    expect(matchingNumbers(10_000, 4, "0712", "last", 2)).toHaveLength(100);
    expect(matchingNumbers(10_000, 4, "0712", "last", 4)).toEqual([712]);
  });
  it("rifa de 1000 números (3 cifras) con resultado de 4", () => {
    expect(matchingNumbers(1000, 3, "7422", "last", 3)).toEqual([422]);
    expect(matchingNumbers(1000, 3, "7422", "first", 3)).toEqual([742]);
  });
});

async function setup(total = 100) {
  const t = createTestDeps();
  const org = await createOrganization(t.deps, {
    name: "Capital Finaura",
    slug: "finaura",
    whatsappPhone: "573045235606",
  });
  if (!org.ok) throw new Error("org");
  const raffle = await createRaffle(t.deps, {
    orgId: org.value.id,
    slug: "navidad",
    title: "Rifa de Navidad",
    totalNumbers: total,
    status: "activa",
  });
  if (!raffle.ok) throw new Error("raffle");
  const ids = { orgId: org.value.id, raffleId: raffle.value.id };
  const base: PrizeInput = {
    description: "Moto 0 km",
    lotteryId: "chontico-noche",
    matchType: "last",
    digits: 2,
    drawDate: "2026-11-02",
    onNoWinner: "finalizar",
    maxAttempts: null,
  };
  const sell = (
    number: number,
    payment: unknown = { status: "pagado" },
    buyer = { name: `Comprador ${number}` },
  ) => markSold(t.deps, { ...ids, number, payment, buyer });
  const prize = async (over: Partial<typeof base> & { place?: number } = {}) => {
    const r = await createPrize(t.deps, { ...ids, ...base, ...over });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  return { ...t, org: org.value, raffle: raffle.value, ids, base, sell, prize };
}

describe("premios: alta y validación", () => {
  it("crea con el lugar siguiente y rechaza datos inválidos", async () => {
    const { deps, ids, base } = await setup();
    const first = await createPrize(deps, { ...ids, ...base });
    const second = await createPrize(deps, {
      ...ids,
      ...base,
      description: "Televisor",
      matchType: "first",
    });
    expect(first.ok && first.value.place).toBe(1);
    expect(second.ok && second.value.place).toBe(2);
    const bad: Partial<typeof base>[] = [
      { lotteryId: "otra" },
      { digits: 3 }, // la rifa es de 2 cifras
      { digits: 0 },
      { matchType: "middle" as never },
      { drawDate: "2026-11-02", lotteryId: "loteria-del-valle" }, // lunes: el Valle no sortea
      { drawDate: "2026-02-30" },
      { onNoWinner: "otra" as never },
      { maxAttempts: 0 },
      { description: "  " },
    ];
    for (const over of bad) {
      const r = await createPrize(deps, { ...ids, ...base, ...over });
      expect(r.ok ? null : r.error.code).toBe("invalid_input");
    }
    const dup = await createPrize(deps, { ...ids, ...base, place: 1 });
    expect(dup.ok ? null : dup.error.code).toBe("conflict");
  });

  it("el Valle solo acepta miércoles", async () => {
    const { deps, ids, base } = await setup();
    const ok = await createPrize(deps, {
      ...ids,
      ...base,
      lotteryId: "loteria-del-valle",
      drawDate: "2026-11-04",
    });
    expect(ok.ok).toBe(true);
  });

  it("edita y borra solo lo permitido", async () => {
    const { deps, ids, sell, prize } = await setup();
    const p = await prize();
    await sell(22);
    deps.clock; // sin efecto
    expect(
      (
        await updatePrize(deps, {
          ...ids,
          prizeId: p.id,
          description: "Moto nueva",
          drawDate: "2026-11-03",
        })
      ).ok,
    ).toBe(true);
    const bad = await updatePrize(deps, { ...ids, prizeId: p.id, drawDate: "2026-02-30" });
    expect(bad.ok ? null : bad.error.code).toBe("invalid_input");
    const empty = await updatePrize(deps, { ...ids, prizeId: p.id });
    expect(empty.ok ? null : empty.error.code).toBe("invalid_input");
    expect((await deletePrize(deps, { ...ids, prizeId: p.id })).ok).toBe(true);
    expect((await listPrizes(deps, ids)).ok && (await listPrizes(deps, ids)).ok).toBe(true);
  });
});

describe("premios: resolución", () => {
  it("con ganador: lo propone, lo anuncia y queda público (sin datos del comprador)", async () => {
    const { deps, ids, stores, sell, prize, raffle } = await setup();
    const p = await prize();
    await sell(22, { status: "debe", dueDate: "2026-12-01" });
    await sell(23);
    stores.source.publish("chontico-noche", "2026-11-02", "7422");
    // el resultado oficial llega por sync (hora ya pasada)
    deps.clock.now();
    await deps.results.saveOfficial({
      id: "r1",
      lotteryId: "chontico-noche",
      drawDate: "2026-11-02",
      number: "7422",
      series: "--6",
      source: "gane",
      sourceRef: "1",
      orgId: null,
      fetchedAt: "x",
      raw: {},
    });

    const prop = await getProposal(deps, { ...ids, prizeId: p.id });
    if (!prop.ok) throw new Error(prop.error.message);
    expect(prop.value).toMatchObject({ outcome: "ganador", term: "22", unsoldMatches: 0 });
    expect(prop.value.winners.map((w) => w.number)).toEqual([22]);

    const res = await resolvePrize(deps, { ...ids, prizeId: p.id });
    expect(res.ok && res.value).toMatchObject({
      outcome: "ganador",
      status: "anunciado",
      winningNumbers: [22],
    });
    const detail = await listPrizes(deps, ids);
    if (!detail.ok) throw new Error("list");
    expect(detail.value[0]?.winners[0]).toMatchObject({
      number: 22,
      buyerName: "Comprador 22",
      paymentStatus: "debe",
    });
    expect(detail.value[0]?.attempts).toHaveLength(1);

    const pub = await listPublicPrizes(deps, raffle.id);
    expect(pub).toEqual([
      {
        place: 1,
        description: "Moto 0 km",
        lotteryId: "chontico-noche",
        drawDate: "2026-11-02",
        status: "anunciado",
        resultNumber: "7422",
        winningNumbers: [22],
      },
    ]);
    expect(JSON.stringify(pub)).not.toContain("Comprador");

    const again = await resolvePrize(deps, { ...ids, prizeId: p.id });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
  });

  it("varios ganadores: cada número vendido que coincide es un premio entregado", async () => {
    const { deps, ids, sell, prize } = await setup();
    const p = await prize({ digits: 1 });
    for (const n of [2, 12, 22, 5]) await sell(n);
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
    const res = await resolvePrize(deps, { ...ids, prizeId: p.id });
    expect(res.ok && res.value.winningNumbers).toEqual([2, 12, 22]);
  });

  it("apartado no gana: si el número que coincide no está vendido → sin ganador", async () => {
    const { deps, ids, prize } = await setup();
    const p = await prize();
    await reserveTickets(deps, {
      orgSlug: "finaura",
      raffleSlug: "navidad",
      clientId: "c",
      numbers: [22],
    });
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
    const prop = await getProposal(deps, { ...ids, prizeId: p.id });
    expect(prop.ok && prop.value).toMatchObject({ outcome: "sin_ganador", unsoldMatches: 1 });
  });

  it("sin ganador y política 'finalizar' → el premio finaliza", async () => {
    const { deps, ids, prize } = await setup();
    const p = await prize({ onNoWinner: "finalizar" });
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
    const res = await resolvePrize(deps, { ...ids, prizeId: p.id });
    expect(res.ok && res.value).toMatchObject({
      outcome: "sin_ganador",
      status: "finalizado",
      nextDrawDate: null,
    });
  });

  it("sin ganador y 'reprogramar': exige una fecha válida y solo de días con sorteo", async () => {
    const { deps, ids, stores, prize } = await setup();
    const p = await prize({
      lotteryId: "loteria-del-valle",
      drawDate: "2026-10-28",
      onNoWinner: "reprogramar",
      maxAttempts: 3,
    });
    await deps.results.saveOfficial({
      id: "r1",
      lotteryId: "loteria-del-valle",
      drawDate: "2026-10-28",
      number: "7544",
      series: null,
      source: "gane",
      sourceRef: null,
      orgId: null,
      fetchedAt: "x",
      raw: {},
    });
    const code = async (nextDrawDate?: unknown) => {
      const r = await resolvePrize(deps, {
        ...ids,
        prizeId: p.id,
        ...(nextDrawDate !== undefined ? { nextDrawDate } : {}),
      });
      return r.ok ? "ok" : r.error.code;
    };
    expect(await code()).toBe("invalid_input"); // falta la fecha
    expect(await code("2026-11-03")).toBe("invalid_input"); // martes: el Valle no sortea
    expect(await code("2026-10-21")).toBe("invalid_input"); // anterior al sorteo
    expect(await code("2026-02-30")).toBe("invalid_input");
    expect(stores.prizes.items[0]?.status).toBe("pendiente"); // nada cambió
    const ok = await resolvePrize(deps, { ...ids, prizeId: p.id, nextDrawDate: "2026-11-04" });
    expect(ok.ok && ok.value).toMatchObject({
      outcome: "sin_ganador",
      status: "pendiente",
      nextDrawDate: "2026-11-04",
    });
    expect(stores.prizes.items[0]).toMatchObject({ status: "pendiente", drawDate: "2026-11-04" });
    expect((await listPrizes(deps, ids)).ok).toBe(true);
  });

  it("al llegar al máximo de intentos, finaliza aunque la política sea reprogramar", async () => {
    const { deps, ids, stores, prize } = await setup();
    const p = await prize({ onNoWinner: "reprogramar", maxAttempts: 2 });
    const publish = (date: string, number: string) =>
      deps.results.saveOfficial({
        id: `r-${date}`,
        lotteryId: "chontico-noche",
        drawDate: date,
        number,
        series: null,
        source: "gane",
        sourceRef: null,
        orgId: null,
        fetchedAt: "x",
        raw: {},
      });
    await publish("2026-11-02", "7422");
    const first = await resolvePrize(deps, { ...ids, prizeId: p.id, nextDrawDate: "2026-11-02" });
    expect(first.ok ? null : first.error.code).toBe("invalid_input"); // misma fecha
    expect(
      (await resolvePrize(deps, { ...ids, prizeId: p.id, nextDrawDate: "2026-11-01" })).ok,
    ).toBe(false);
    // la reprogramación debe ser posterior; usamos el día siguiente y adelantamos el reloj
    expect(
      (await resolvePrize(deps, { ...ids, prizeId: p.id, nextDrawDate: "2026-11-03" })).ok,
    ).toBe(true);
    deps.clock.now();
    (deps.clock as unknown as { advance(ms: number): void }).advance(24 * 3600 * 1000);
    await publish("2026-11-03", "1111");
    const second = await resolvePrize(deps, { ...ids, prizeId: p.id });
    expect(second.ok && second.value).toMatchObject({
      outcome: "sin_ganador",
      status: "finalizado",
    });
    expect(stores.prizes.attempts.map((a) => a.attemptNo)).toEqual([1, 2]);
  });

  it("sin límite de intentos (null): siempre se puede reprogramar", async () => {
    const { deps, ids, prize } = await setup();
    const p = await prize({ onNoWinner: "reprogramar", maxAttempts: null });
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
    const r = await getProposal(deps, { ...ids, prizeId: p.id });
    expect(r.ok && r.value.canReprogram).toBe(true);
  });

  it("sin resultado todavía (o sorteo futuro) no se puede resolver", async () => {
    const { deps, ids, prize } = await setup();
    const today = await prize();
    const future = await prize({ drawDate: "2026-11-05" });
    await deps.results.saveOfficial({
      id: "rf",
      lotteryId: "chontico-noche",
      drawDate: "2026-11-05",
      number: "7422",
      series: null,
      source: "gane",
      sourceRef: null,
      orgId: null,
      fetchedAt: "x",
      raw: {},
    });
    for (const id of [today.id, future.id]) {
      const prop = await getProposal(deps, { ...ids, prizeId: id });
      expect(prop.ok && prop.value.outcome).toBe("sin_resultado");
      const res = await resolvePrize(deps, { ...ids, prizeId: id });
      expect(res.ok ? null : res.error.code).toBe("invalid_state");
    }
  });

  it("aislamiento: otra organización no ve ni resuelve el premio", async () => {
    const { deps, ids, prize } = await setup();
    const p = await prize();
    const other = { orgId: "otra", raffleId: ids.raffleId };
    for (const r of [
      await getProposal(deps, { ...other, prizeId: p.id }),
      await resolvePrize(deps, { ...other, prizeId: p.id }),
      await updatePrize(deps, { ...other, prizeId: p.id, description: "x" }),
      await deletePrize(deps, { ...other, prizeId: p.id }),
      await listPrizes(deps, other),
    ]) {
      expect(r.ok ? null : r.error.code).toBe("not_found");
    }
  });
});

describe("resultados manuales", () => {
  it("son de la organización y se usan para resolver; el oficial tiene prioridad y bloquea el manual", async () => {
    const { deps, ids, org, prize, sell } = await setup();
    const p = await prize();
    await sell(22);
    const manual = await enterManualResult(deps, {
      orgId: org.id,
      lotteryId: "chontico-noche",
      date: "2026-11-02",
      number: "7422",
    });
    expect(manual.ok).toBe(true);
    const prop = await getProposal(deps, { ...ids, prizeId: p.id });
    expect(prop.ok && prop.value.result?.source).toBe("manual");
    // otra organización no usa mi resultado manual
    expect(await deps.results.findManual("otra", "chontico-noche", "2026-11-02")).toBeNull();
    // corregir el manual
    expect(
      (
        await enterManualResult(deps, {
          orgId: org.id,
          lotteryId: "chontico-noche",
          date: "2026-11-02",
          number: "1111",
        })
      ).ok,
    ).toBe(true);
    // el oficial pisa al manual
    await deps.results.saveOfficial({
      id: "r1",
      lotteryId: "chontico-noche",
      drawDate: "2026-11-02",
      number: "9999",
      series: null,
      source: "gane",
      sourceRef: null,
      orgId: null,
      fetchedAt: "x",
      raw: {},
    });
    const prop2 = await getProposal(deps, { ...ids, prizeId: p.id });
    expect(prop2.ok && prop2.value.result?.number).toBe("9999");
    const blocked = await enterManualResult(deps, {
      orgId: org.id,
      lotteryId: "chontico-noche",
      date: "2026-11-02",
      number: "2222",
    });
    expect(blocked.ok ? null : blocked.error.code).toBe("invalid_state");
  });

  it("valida juego, día de sorteo, fecha pasada y 4 cifras", async () => {
    const { deps, org } = await setup();
    const base = { orgId: org.id, lotteryId: "chontico-noche", date: "2026-11-01", number: "0712" };
    expect((await enterManualResult(deps, base)).ok).toBe(true);
    for (const over of [
      { lotteryId: "otra" },
      { date: "2026-11-03" }, // futuro
      { date: "2026-02-30" },
      { lotteryId: "loteria-del-valle", date: "2026-11-01" }, // domingo
      { number: "712" },
      { number: 712 as unknown as string },
      { number: "07a2" },
    ]) {
      const r = await enterManualResult(deps, { ...base, ...over });
      expect(r.ok ? null : r.error.code).toBe("invalid_input");
    }
  });
});

describe("sincronización de resultados oficiales", () => {
  it("desactivada: no consulta nada", async () => {
    const { deps, stores, prize } = await setup();
    await prize();
    stores.source.enabled = false;
    const s = await syncOfficialResults(deps);
    expect(s).toMatchObject({ skipped: true, dates: 0 });
    expect(stores.source.calls).toEqual([]);
    const now = await fetchResultNow(deps, {
      orgId: "o",
      lotteryId: "chontico-noche",
      date: "2026-11-01",
    });
    expect(now.ok ? null : now.error.code).toBe("invalid_state");
  });

  it("no consulta antes de la hora de publicación; luego una sola vez por fecha, aunque haya varios premios", async () => {
    const { deps, clock, stores, prize } = await setup();
    await prize();
    await prize({ digits: 1, matchType: "first" });
    await prize({ lotteryId: "dorado-noche", digits: 2 });
    stores.source.publish("chontico-noche", "2026-11-02", "7422");
    stores.source.publish("dorado-noche", "2026-11-02", "0862");

    expect((await syncOfficialResults(deps)).dates).toBe(0); // 10:00 en Colombia: aún temprano
    clock.advance(10 * 3600 * 1000); // 20:00 en Colombia
    const s = await syncOfficialResults(deps);
    expect(s).toMatchObject({ skipped: false, dates: 1, saved: 2, errors: 0 });
    expect(stores.source.calls).toEqual(["2026-11-02"]);
    expect((await deps.results.findOfficial("dorado-noche", "2026-11-02"))?.number).toBe("0862");

    const again = await syncOfficialResults(deps); // ya está guardado: no vuelve a consultar
    expect(again.dates).toBe(0);
    expect(stores.source.calls).toHaveLength(1);
  });

  it("si la fuente falla, cuenta el error y no revienta; si aún no hay resultados, reintenta luego", async () => {
    const { deps, clock, stores, prize } = await setup();
    await prize();
    clock.advance(10 * 3600 * 1000);
    stores.source.failWith = new Error("timeout");
    expect(await syncOfficialResults(deps)).toMatchObject({ dates: 1, saved: 0, errors: 1 });
    stores.source.failWith = null;
    expect(await syncOfficialResults(deps)).toMatchObject({ dates: 1, saved: 0, errors: 0 }); // aún sin resultados
    stores.source.publish("chontico-noche", "2026-11-02", "7422");
    expect(await syncOfficialResults(deps)).toMatchObject({ saved: 1 });
  });

  it("«Consultar ahora»: encuentra, no encuentra o falla la fuente", async () => {
    const { deps, stores, org } = await setup();
    const ask = (date = "2026-11-01") =>
      fetchResultNow(deps, { orgId: org.id, lotteryId: "chontico-noche", date });
    expect((await ask()).ok && (await ask()).ok).toBe(true);
    const none = await ask();
    expect(none.ok && none.value.found).toBe(false);
    stores.source.publish("chontico-noche", "2026-11-01", "7059");
    const found = await ask();
    expect(found.ok && found.value.found).toBe(true);
    stores.source.failWith = new Error("500");
    const failed = await fetchResultNow(deps, {
      orgId: org.id,
      lotteryId: "chontico-noche",
      date: "2026-10-31",
    });
    expect(failed.ok ? null : failed.error.code).toBe("source_unavailable");
    const future = await ask("2026-11-03");
    expect(future.ok ? null : future.error.code).toBe("invalid_input");
  });
});
