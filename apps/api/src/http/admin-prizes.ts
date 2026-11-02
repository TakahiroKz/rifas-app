import {
  type AdminPrize,
  createPrizeRequestSchema,
  manualResultRequestSchema,
  type Proposal,
  type ResultLookup,
  resolveRequestSchema,
  updatePrizeRequestSchema,
} from "@rifas/contracts";
import {
  addDays,
  bogotaDate,
  createPrize,
  type DrawResult,
  deletePrize,
  drawDaysBetween,
  enterManualResult,
  fetchResultNow,
  getGame,
  getProposal,
  isValidDate,
  LOTTERY_GAMES,
  listPrizes,
  type PrizeDetail,
  resolvePrize,
  updatePrize,
} from "@rifas/core";
import { Hono } from "hono";
import type { z } from "zod";
import type { AdminEnv } from "./admin-auth";
import { toHttpError } from "./errors";

/** Rutas de loterías y premios; se montan dentro de la zona /admin (ya con sesión y CSRF). */
export const prizeRoutes = new Hono<AdminEnv>();

const invalid = (message: string) => ({ error: { code: "invalid_input", message } });
const lotteryName = (id: string) => getGame(id)?.name ?? id;

async function body<S extends z.ZodType>(
  c: { req: { json: () => Promise<unknown> } },
  schema: S,
): Promise<z.infer<S> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

const toResultDto = (r: DrawResult | null): ResultLookup["result"] =>
  r ? { number: r.number, series: r.series, source: r.source, drawDate: r.drawDate } : null;

const toPrizeDto = ({ prize, attempts, winners }: PrizeDetail): AdminPrize => ({
  id: prize.id,
  place: prize.place,
  description: prize.description,
  lotteryId: prize.lotteryId,
  lotteryName: lotteryName(prize.lotteryId),
  matchType: prize.matchType,
  digits: prize.digits,
  drawDate: prize.drawDate,
  onNoWinner: prize.onNoWinner,
  maxAttempts: prize.maxAttempts,
  status: prize.status,
  attempts: attempts.map((a) => ({
    attemptNo: a.attemptNo,
    drawDate: a.drawDate,
    resultNumber: a.resultNumber,
    outcome: a.outcome,
    createdAt: a.createdAt,
  })),
  winners: winners.map((w) => ({
    number: w.number,
    buyerName: w.buyerName,
    buyerPhone: w.buyerPhone,
    paymentStatus: w.paymentStatus,
  })),
});

// ───────────── Loterías ─────────────

prizeRoutes.get("/lotteries", (c) =>
  c.json({
    lotteries: LOTTERY_GAMES.map(({ id, name, country, drawWeekdays }) => ({
      id,
      name,
      country,
      drawWeekdays,
    })),
    syncEnabled: c.get("deps").source.enabled,
  }),
);

/** Días en que la lotería sortea. Por defecto, desde hoy y los próximos 120 días. */
prizeRoutes.get("/lotteries/:id/calendar", (c) => {
  const id = c.req.param("id");
  if (!getGame(id))
    return c.json({ error: { code: "not_found", message: "Lotería no encontrada" } }, 404);
  const today = bogotaDate(c.get("deps").clock.now());
  const from = c.req.query("from") ?? today;
  const to = c.req.query("to") ?? addDays(from, 120);
  if (!isValidDate(from) || !isValidDate(to) || to < from)
    return c.json(invalid("Rango de fechas no válido"), 400);
  return c.json({ days: drawDaysBetween(id, from, to) });
});

prizeRoutes.get("/lotteries/:id/results/:date", async (c) => {
  const { id, date } = c.req.param();
  if (!getGame(id))
    return c.json({ error: { code: "not_found", message: "Lotería no encontrada" } }, 404);
  if (!isValidDate(date)) return c.json(invalid("Fecha no válida"), 400);
  const deps = c.get("deps");
  const result =
    (await deps.results.findOfficial(id, date)) ??
    (await deps.results.findManual(c.get("auth").organization.id, id, date));
  return c.json({ result: toResultDto(result) } satisfies ResultLookup);
});

prizeRoutes.put("/lotteries/:id/results/:date", async (c) => {
  const { id, date } = c.req.param();
  const data = await body(c, manualResultRequestSchema);
  if (!data) return c.json(invalid("Datos del resultado no válidos"), 400);
  const result = await enterManualResult(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    lotteryId: id,
    date,
    number: data.number,
    ...(data.series !== undefined ? { series: data.series } : {}),
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  return c.json({ result: toResultDto(result.value) } satisfies ResultLookup);
});

prizeRoutes.post("/lotteries/:id/results/:date/fetch", async (c) => {
  const { id, date } = c.req.param();
  const result = await fetchResultNow(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    lotteryId: id,
    date,
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  return c.json(result.value);
});

// ───────────── Premios de una rifa ─────────────

prizeRoutes.get("/raffles/:id/prizes", async (c) => {
  const result = await listPrizes(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  return c.json({ prizes: result.value.map(toPrizeDto) });
});

prizeRoutes.post("/raffles/:id/prizes", async (c) => {
  const data = await body(c, createPrizeRequestSchema);
  if (!data) return c.json(invalid("Datos del premio no válidos"), 400);
  const deps = c.get("deps");
  const orgId = c.get("auth").organization.id;
  const raffleId = c.req.param("id");
  const created = await createPrize(deps, { orgId, raffleId, ...data });
  if (!created.ok) {
    const { status, body: err } = toHttpError(created.error);
    return c.json(err, status);
  }
  return c.json(toPrizeDto({ prize: created.value, attempts: [], winners: [] }), 201);
});

prizeRoutes.patch("/raffles/:id/prizes/:prizeId", async (c) => {
  const data = await body(c, updatePrizeRequestSchema);
  if (!data) return c.json(invalid("Datos del premio no válidos"), 400);
  const result = await updatePrize(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    prizeId: c.req.param("prizeId"),
    ...data,
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  return c.body(null, 204);
});

prizeRoutes.delete("/raffles/:id/prizes/:prizeId", async (c) => {
  const result = await deletePrize(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    prizeId: c.req.param("prizeId"),
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  return c.body(null, 204);
});

prizeRoutes.get("/raffles/:id/prizes/:prizeId/proposal", async (c) => {
  const result = await getProposal(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    prizeId: c.req.param("prizeId"),
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  const p = result.value;
  return c.json({
    prizeId: p.prize.id,
    outcome: p.outcome,
    result: toResultDto(p.result),
    term: p.term,
    winners: p.winners.map((t) => ({
      number: t.number,
      buyerName: t.buyerName,
      buyerPhone: t.buyerPhone,
      paymentStatus: t.paymentStatus ?? "pagado",
    })),
    unsoldMatches: p.unsoldMatches,
    attemptNo: p.attemptNo,
    canReprogram: p.canReprogram,
  } satisfies Proposal);
});

prizeRoutes.post("/raffles/:id/prizes/:prizeId/resolve", async (c) => {
  const data = await body(c, resolveRequestSchema);
  if (!data) return c.json(invalid("Datos no válidos"), 400);
  const result = await resolvePrize(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    prizeId: c.req.param("prizeId"),
    ...(data.nextDrawDate !== undefined ? { nextDrawDate: data.nextDrawDate } : {}),
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  return c.json(result.value);
});
