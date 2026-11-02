import type { Deps } from "./deps";
import { getGame, isDrawDay, minutesOf } from "./lotteries";
import { type MatchType, matchingNumbers, pickWinners, winningTerm } from "./prize-rules";
import { fail, ok, type Result } from "./result";
import { bogotaDate, bogotaMinutes } from "./time";
import type {
  DrawResult,
  OnNoWinner,
  Prize,
  PrizeAttempt,
  PrizeWinner,
  PublicPrize,
  Raffle,
  TicketRecord,
} from "./types";
import { cleanText, isValidDate } from "./validation";

const MAX_PLACES = 50;
const MAX_ATTEMPTS_LIMIT = 50;

// ───────────── Alta y edición de premios ─────────────

export interface PrizeInput {
  description: string;
  lotteryId: string;
  matchType: MatchType;
  digits: number;
  drawDate: string;
  onNoWinner: OnNoWinner;
  maxAttempts: number | null;
}

function validateRule(
  raffle: Raffle,
  rule: { lotteryId: string; matchType: unknown; digits: unknown; drawDate: unknown },
): string | null {
  if (!getGame(rule.lotteryId)) return "La lotería no es válida";
  if (rule.matchType !== "first" && rule.matchType !== "last")
    return "Indica si cuentan las primeras o las últimas cifras";
  const d = rule.digits;
  if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > raffle.numberWidth) {
    return `Las cifras deben ser de 1 a ${raffle.numberWidth} (los números de esta rifa tienen ${raffle.numberWidth})`;
  }
  if (!isValidDate(rule.drawDate)) return "La fecha del sorteo no es válida (AAAA-MM-DD)";
  if (!isDrawDay(rule.lotteryId, rule.drawDate)) return "Esa lotería no sortea ese día";
  return null;
}

function validatePolicy(input: { onNoWinner: unknown; maxAttempts: unknown }): string | null {
  if (input.onNoWinner !== "reprogramar" && input.onNoWinner !== "finalizar")
    return "Elige qué hacer si no hay ganador";
  const m = input.maxAttempts;
  if (
    m !== null &&
    !(typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= MAX_ATTEMPTS_LIMIT)
  ) {
    return `Los intentos deben ser un entero de 1 a ${MAX_ATTEMPTS_LIMIT}, o sin límite`;
  }
  return null;
}

export async function createPrize(
  deps: Deps,
  input: PrizeInput & { orgId: string; raffleId: string; place?: number | undefined },
): Promise<Result<Prize>> {
  const raffle = await deps.raffles.findById(input.orgId, input.raffleId);
  if (!raffle) return fail("not_found", "Rifa no encontrada");
  const description = cleanText(input.description, 120);
  if (!description) return fail("invalid_input", "Describe el premio");
  const problem = validateRule(raffle, input) ?? validatePolicy(input);
  if (problem) return fail("invalid_input", problem);

  const existing = await deps.prizes.listByRaffle(input.orgId, input.raffleId);
  const place = input.place ?? Math.max(0, ...existing.map((p) => p.place)) + 1;
  if (!Number.isInteger(place) || place < 1 || place > MAX_PLACES) {
    return fail("invalid_input", `El lugar debe ser un entero de 1 a ${MAX_PLACES}`);
  }
  const prize: Prize = {
    id: deps.ids.uuid(),
    orgId: input.orgId,
    raffleId: input.raffleId,
    place,
    description,
    lotteryId: input.lotteryId,
    matchType: input.matchType,
    digits: input.digits,
    drawDate: input.drawDate,
    onNoWinner: input.onNoWinner,
    maxAttempts: input.maxAttempts,
    status: "pendiente",
    createdAt: deps.clock.now().toISOString(),
  };
  const created = await deps.prizes.create(prize);
  if (!created.ok) return fail("conflict", `Ya hay un premio en el lugar ${place}`);
  return ok(prize);
}

export interface UpdatePrizeInput {
  orgId: string;
  raffleId: string;
  prizeId: string;
  description?: string | undefined;
  lotteryId?: string | undefined;
  matchType?: MatchType | undefined;
  digits?: number | undefined;
  drawDate?: string | undefined;
  onNoWinner?: OnNoWinner | undefined;
  maxAttempts?: number | null | undefined;
}

async function loadPrize(
  deps: Deps,
  orgId: string,
  raffleId: string,
  prizeId: string,
): Promise<Result<Prize>> {
  const prize = await deps.prizes.findById(orgId, prizeId);
  return prize && prize.raffleId === raffleId
    ? ok(prize)
    : fail("not_found", "Premio no encontrado");
}

/** Solo premios pendientes. Las reglas (lotería, tipo, cifras) no cambian una vez hubo un intento. */
export async function updatePrize(deps: Deps, input: UpdatePrizeInput): Promise<Result<null>> {
  const loaded = await loadPrize(deps, input.orgId, input.raffleId, input.prizeId);
  if (!loaded.ok) return loaded;
  const prize = loaded.value;
  if (prize.status !== "pendiente") return fail("invalid_state", "El premio ya no está pendiente");
  const raffle = await deps.raffles.findById(input.orgId, input.raffleId);
  if (!raffle) return fail("not_found", "Rifa no encontrada");

  const attempts = await deps.prizes.listAttempts(input.orgId, input.prizeId);
  const ruleChange =
    input.lotteryId !== undefined || input.matchType !== undefined || input.digits !== undefined;
  if (ruleChange && attempts.length > 0) {
    return fail("invalid_state", "La regla no se puede cambiar después de un intento");
  }

  const merged = {
    lotteryId: input.lotteryId ?? prize.lotteryId,
    matchType: input.matchType ?? prize.matchType,
    digits: input.digits ?? prize.digits,
    drawDate: input.drawDate ?? prize.drawDate,
  };
  const policy = {
    onNoWinner: input.onNoWinner ?? prize.onNoWinner,
    maxAttempts: input.maxAttempts === undefined ? prize.maxAttempts : input.maxAttempts,
  };
  const problem = validateRule(raffle, merged) ?? validatePolicy(policy);
  if (problem) return fail("invalid_input", problem);

  const patch: Parameters<Deps["prizes"]["update"]>[2] = {};
  if (input.description !== undefined) {
    const d = cleanText(input.description, 120);
    if (!d) return fail("invalid_input", "Describe el premio");
    patch.description = d;
  }
  if (input.lotteryId !== undefined) patch.lotteryId = input.lotteryId;
  if (input.matchType !== undefined) patch.matchType = input.matchType;
  if (input.digits !== undefined) patch.digits = input.digits;
  if (input.drawDate !== undefined) patch.drawDate = input.drawDate;
  if (input.onNoWinner !== undefined) patch.onNoWinner = input.onNoWinner;
  if (input.maxAttempts !== undefined) patch.maxAttempts = input.maxAttempts;
  if (Object.keys(patch).length === 0) return fail("invalid_input", "No hay cambios para guardar");

  return (await deps.prizes.update(input.orgId, input.prizeId, patch))
    ? ok(null)
    : fail("not_found", "Premio no encontrado");
}

export async function deletePrize(
  deps: Deps,
  input: { orgId: string; raffleId: string; prizeId: string },
): Promise<Result<null>> {
  const loaded = await loadPrize(deps, input.orgId, input.raffleId, input.prizeId);
  if (!loaded.ok) return loaded;
  const attempts = await deps.prizes.listAttempts(input.orgId, input.prizeId);
  if (loaded.value.status !== "pendiente" || attempts.length > 0) {
    return fail("invalid_state", "Solo se pueden borrar premios sin intentos");
  }
  return (await deps.prizes.delete(input.orgId, input.prizeId))
    ? ok(null)
    : fail("not_found", "Premio no encontrado");
}

export interface PrizeDetail {
  prize: Prize;
  attempts: PrizeAttempt[];
  winners: PrizeWinner[];
}

export async function listPrizes(
  deps: Deps,
  input: { orgId: string; raffleId: string },
): Promise<Result<PrizeDetail[]>> {
  const raffle = await deps.raffles.findById(input.orgId, input.raffleId);
  if (!raffle) return fail("not_found", "Rifa no encontrada");
  const prizes = await deps.prizes.listByRaffle(input.orgId, input.raffleId);
  const details = await Promise.all(
    prizes.map(async (prize) => ({
      prize,
      attempts: await deps.prizes.listAttempts(input.orgId, prize.id),
      winners: await deps.prizes.listWinners(input.orgId, prize.id),
    })),
  );
  return ok(details.sort((a, b) => a.prize.place - b.prize.place));
}

// ───────────── Evaluación y resolución ─────────────

export interface Proposal {
  prize: Prize;
  /** null si todavía no hay resultado (o la fecha no llegó). */
  result: DrawResult | null;
  /** Cifras del resultado que cuentan, p. ej. "42". */
  term: string | null;
  /** Vendidos que coinciden (ganadores). */
  winners: TicketRecord[];
  /** Números que coinciden pero no están vendidos. */
  unsoldMatches: number;
  outcome: "sin_resultado" | "ganador" | "sin_ganador";
  attemptNo: number;
  /** Si no hay ganador, ¿la política permite reprogramar? */
  canReprogram: boolean;
}

async function findResult(deps: Deps, orgId: string, prize: Prize): Promise<DrawResult | null> {
  return (
    (await deps.results.findOfficial(prize.lotteryId, prize.drawDate)) ??
    (await deps.results.findManual(orgId, prize.lotteryId, prize.drawDate))
  );
}

async function buildProposal(
  deps: Deps,
  input: { orgId: string; raffleId: string; prizeId: string },
): Promise<Result<Proposal>> {
  const raffle = await deps.raffles.findById(input.orgId, input.raffleId);
  if (!raffle) return fail("not_found", "Rifa no encontrada");
  const loaded = await loadPrize(deps, input.orgId, input.raffleId, input.prizeId);
  if (!loaded.ok) return loaded;
  const prize = loaded.value;
  if (prize.status !== "pendiente") return fail("invalid_state", "El premio ya no está pendiente");

  const attempts = await deps.prizes.listAttempts(input.orgId, prize.id);
  const attemptNo = attempts.length + 1;
  const canReprogram =
    prize.onNoWinner === "reprogramar" &&
    (prize.maxAttempts === null || attemptNo < prize.maxAttempts);

  const today = bogotaDate(deps.clock.now());
  const result = prize.drawDate > today ? null : await findResult(deps, input.orgId, prize);
  if (!result) {
    return ok({
      prize,
      result: null,
      term: null,
      winners: [],
      unsoldMatches: 0,
      outcome: "sin_resultado",
      attemptNo,
      canReprogram,
    });
  }

  const matches = matchingNumbers(
    raffle.totalNumbers,
    raffle.numberWidth,
    result.number,
    prize.matchType,
    prize.digits,
  );
  const sold = await deps.tickets.listAdmin(input.orgId, input.raffleId, { status: "vendido" });
  const winners = pickWinners(matches, sold);
  return ok({
    prize,
    result,
    term: winningTerm(result.number, prize.matchType, prize.digits),
    winners,
    unsoldMatches: matches.length - winners.length,
    outcome: winners.length > 0 ? "ganador" : "sin_ganador",
    attemptNo,
    canReprogram,
  });
}

/** Calcula, sin guardar nada, qué pasaría con el premio según el resultado. */
export async function getProposal(
  deps: Deps,
  input: { orgId: string; raffleId: string; prizeId: string },
): Promise<Result<Proposal>> {
  return buildProposal(deps, input);
}

export interface ResolveOutcome {
  outcome: "ganador" | "sin_ganador";
  status: Prize["status"];
  winningNumbers: number[];
  nextDrawDate: string | null;
}

/**
 * El administrador confirma el resultado. Siempre se vuelve a evaluar en el servidor.
 * - Con ganadores: se anuncian (un premio por cada número vendido que coincide).
 * - Sin ganadores: según la política del premio se finaliza o se reprograma al `nextDrawDate`
 *   que elija el administrador (solo días en que la lotería sortea).
 */
export async function resolvePrize(
  deps: Deps,
  input: { orgId: string; raffleId: string; prizeId: string; nextDrawDate?: unknown },
): Promise<Result<ResolveOutcome>> {
  const built = await buildProposal(deps, input);
  if (!built.ok) return built;
  const p = built.value;
  if (!p.result) return fail("invalid_state", "Aún no hay resultado para la fecha de este sorteo");

  let newStatus: Prize["status"];
  let nextDrawDate: string | null = null;
  if (p.outcome === "ganador") {
    newStatus = "anunciado";
  } else if (!p.canReprogram) {
    newStatus = "finalizado";
  } else {
    const next = input.nextDrawDate;
    if (!isValidDate(next)) return fail("invalid_input", "Elige la fecha del próximo sorteo");
    if (!isDrawDay(p.prize.lotteryId, next))
      return fail("invalid_input", "Esa lotería no sortea ese día");
    if (next <= p.prize.drawDate)
      return fail("invalid_input", "La nueva fecha debe ser posterior al sorteo anterior");
    newStatus = "pendiente";
    nextDrawDate = next;
  }

  const saved = await deps.prizes.resolve({
    orgId: input.orgId,
    prizeId: p.prize.id,
    expectedDrawDate: p.prize.drawDate,
    attemptNo: p.attemptNo,
    resultNumber: p.result.number,
    outcome: p.outcome === "ganador" ? "ganador" : "sin_ganador",
    winners: p.winners.map((t) => ({
      number: t.number,
      buyerName: t.buyerName,
      buyerPhone: t.buyerPhone,
      paymentStatus: t.paymentStatus ?? "pagado",
    })),
    newStatus,
    nextDrawDate,
    now: deps.clock.now().toISOString(),
  });
  if (!saved) return fail("invalid_state", "Este premio ya fue resuelto");
  return ok({
    outcome: p.outcome === "ganador" ? "ganador" : "sin_ganador",
    status: newStatus,
    winningNumbers: p.winners.map((t) => t.number).sort((a, b) => a - b),
    nextDrawDate,
  });
}

// ───────────── Resultados ─────────────

/** Resultado ingresado a mano por la organización (respaldo si la fuente falla). */
export async function enterManualResult(
  deps: Deps,
  input: { orgId: string; lotteryId: string; date: string; number: unknown; series?: string },
): Promise<Result<DrawResult>> {
  if (!getGame(input.lotteryId)) return fail("invalid_input", "La lotería no es válida");
  if (!isValidDate(input.date)) return fail("invalid_input", "La fecha no es válida (AAAA-MM-DD)");
  if (!isDrawDay(input.lotteryId, input.date))
    return fail("invalid_input", "Esa lotería no sortea ese día");
  const now = deps.clock.now();
  if (input.date > bogotaDate(now))
    return fail("invalid_input", "No se puede ingresar el resultado de un sorteo futuro");
  if (typeof input.number !== "string" || !/^\d{4}$/.test(input.number)) {
    return fail("invalid_input", "El número debe tener 4 cifras (con ceros a la izquierda)");
  }
  if (await deps.results.findOfficial(input.lotteryId, input.date)) {
    return fail("invalid_state", "Ya hay un resultado oficial para ese sorteo");
  }
  const result: DrawResult = {
    id: deps.ids.uuid(),
    lotteryId: input.lotteryId,
    drawDate: input.date,
    number: input.number,
    series: cleanText(input.series, 10) ?? null,
    source: "manual",
    sourceRef: null,
    orgId: input.orgId,
    fetchedAt: now.toISOString(),
  };
  await deps.results.saveManual(result);
  return ok(result);
}

export interface SyncSummary {
  skipped: boolean;
  dates: number;
  saved: number;
  errors: number;
}

async function storeDraws(deps: Deps, date: string): Promise<number> {
  const draws = await deps.source.fetchDraws(date);
  let saved = 0;
  for (const d of draws) {
    const inserted = await deps.results.saveOfficial({
      id: deps.ids.uuid(),
      lotteryId: d.lotteryId,
      drawDate: d.drawDate,
      number: d.number,
      series: d.series,
      source: "gane",
      sourceRef: d.sourceRef,
      orgId: null,
      fetchedAt: deps.clock.now().toISOString(),
      raw: d.raw,
    });
    if (inserted) saved++;
  }
  return saved;
}

/**
 * Cron: trae los resultados oficiales que hacen falta para los premios pendientes cuya fecha ya llegó.
 * Una consulta por fecha (devuelve todos los juegos). Un fallo de la fuente no detiene el resto.
 */
export async function syncOfficialResults(deps: Deps): Promise<SyncSummary> {
  const summary: SyncSummary = { skipped: false, dates: 0, saved: 0, errors: 0 };
  if (!deps.source.enabled) return { ...summary, skipped: true };

  const now = deps.clock.now();
  const today = bogotaDate(now);
  const minutes = bogotaMinutes(now);
  const dates = new Set<string>();
  for (const prize of await deps.prizes.listPendingDue(today)) {
    const game = getGame(prize.lotteryId);
    if (!game) continue;
    if (prize.drawDate === today && minutes < minutesOf(game.resultsAfter)) continue;
    if (await deps.results.findOfficial(prize.lotteryId, prize.drawDate)) continue;
    dates.add(prize.drawDate);
  }

  for (const date of dates) {
    summary.dates++;
    try {
      summary.saved += await storeDraws(deps, date);
    } catch (error) {
      summary.errors++;
      console.error(
        JSON.stringify({
          level: "error",
          message: "sync de resultados falló",
          date,
          error: (error as Error).message,
        }),
      );
    }
  }
  return summary;
}

/** Botón «Consultar ahora» del administrador para un juego y fecha. */
export async function fetchResultNow(
  deps: Deps,
  input: { orgId: string; lotteryId: string; date: string },
): Promise<Result<{ found: boolean }>> {
  if (!getGame(input.lotteryId)) return fail("invalid_input", "La lotería no es válida");
  if (!isValidDate(input.date) || !isDrawDay(input.lotteryId, input.date)) {
    return fail("invalid_input", "Esa lotería no sortea ese día");
  }
  if (input.date > bogotaDate(deps.clock.now()))
    return fail("invalid_input", "Ese sorteo aún no ha ocurrido");
  if (await deps.results.findOfficial(input.lotteryId, input.date)) return ok({ found: true });
  if (!deps.source.enabled) {
    return fail(
      "invalid_state",
      "La consulta automática no está activada; ingresa el resultado a mano",
    );
  }
  try {
    await storeDraws(deps, input.date);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "consulta de resultado falló",
        error: (error as Error).message,
      }),
    );
    return fail(
      "source_unavailable",
      "La fuente de resultados no respondió. Inténtalo de nuevo o ingresa el resultado a mano",
    );
  }
  return ok({ found: (await deps.results.findOfficial(input.lotteryId, input.date)) !== null });
}

export async function listPublicPrizes(deps: Deps, raffleId: string): Promise<PublicPrize[]> {
  return deps.prizes.listPublic(raffleId);
}
