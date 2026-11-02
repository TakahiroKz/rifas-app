import {
  HISTORY_PAGE_SIZE,
  MAX_ACTIVE_RESERVED_PER_CLIENT,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_NUMBERS_PER_RESERVATION,
  RESERVATION_TTL_MS,
} from "./constants";
import type { Deps } from "./deps";
import { isNumberInRange } from "./numbers";
import { fail, ok, type Result } from "./result";
import { hashToken } from "./session-token";
import type {
  Buyer,
  Organization,
  Payment,
  PaymentStatus,
  PublicTicket,
  Raffle,
  TicketEvent,
  TicketRecord,
} from "./types";
import { cleanText, isValidDate } from "./validation";

// ───────────── Zona pública ─────────────

export interface ReservationResult {
  code: string;
  numbers: number[];
  reservedAt: string;
  reservedUntil: string;
}

/** Rifas visibles al público: activas y cerradas (estas últimas en solo lectura, para ver los ganadores). */
async function findPublicRaffle(
  deps: Deps,
  orgSlug: string,
  raffleSlug: string,
): Promise<Result<{ organization: Organization; raffle: Raffle }>> {
  const found = await deps.raffles.findPublic(orgSlug, raffleSlug);
  if (!found || found.raffle.status === "borrador") return fail("not_found", "Rifa no encontrada");
  return ok(found);
}

export async function getPublicRaffle(
  deps: Deps,
  input: { orgSlug: string; raffleSlug: string },
): Promise<Result<{ organization: Organization; raffle: Raffle }>> {
  return findPublicRaffle(deps, input.orgSlug, input.raffleSlug);
}

export async function listPublicTickets(
  deps: Deps,
  input: { orgSlug: string; raffleSlug: string },
): Promise<Result<PublicTicket[]>> {
  const found = await findPublicRaffle(deps, input.orgSlug, input.raffleSlug);
  if (!found.ok) return found;
  const now = deps.clock.now().toISOString();
  return ok(await deps.tickets.listPublic(found.value.raffle.id, now));
}

export function parseNumbers(input: unknown, totalNumbers: number): Result<number[]> {
  if (!Array.isArray(input) || input.length === 0) {
    return fail("invalid_input", "Elige al menos un número");
  }
  if (input.length > MAX_NUMBERS_PER_RESERVATION) {
    return fail("invalid_input", `Máximo ${MAX_NUMBERS_PER_RESERVATION} números por solicitud`);
  }
  if (!input.every((n) => isNumberInRange(n, totalNumbers))) {
    return fail("invalid_input", "Algún número está fuera del rango de la rifa");
  }
  const numbers = [...new Set(input as number[])];
  if (numbers.length !== input.length) {
    return fail("invalid_input", "Hay números repetidos");
  }
  return ok(numbers.sort((a, b) => a - b));
}

/**
 * Aparta números de forma atómica por 24 horas.
 * `clientId` identifica a quien aparta (p. ej. su IP); solo se guarda su hash, nunca el valor.
 */
export async function reserveTickets(
  deps: Deps,
  input: { orgSlug: string; raffleSlug: string; numbers: unknown; clientId: string },
): Promise<Result<ReservationResult>> {
  const found = await findPublicRaffle(deps, input.orgSlug, input.raffleSlug);
  if (!found.ok) return found;
  const { raffle } = found.value;
  if (raffle.status !== "activa") return fail("raffle_closed", "Esta rifa ya está cerrada");

  const parsed = parseNumbers(input.numbers, raffle.totalNumbers);
  if (!parsed.ok) return parsed;

  const now = deps.clock.now();
  const reservedAt = now.toISOString();
  const reservedUntil = new Date(now.getTime() + RESERVATION_TTL_MS).toISOString();
  const code = deps.codes.reservationCode();

  const result = await deps.tickets.reserve({
    orgId: raffle.orgId,
    raffleId: raffle.id,
    numbers: parsed.value,
    code,
    now: reservedAt,
    until: reservedUntil,
    clientKey: await hashToken(`${raffle.id}:${input.clientId}`),
    maxActivePerClient: MAX_ACTIVE_RESERVED_PER_CLIENT,
  });
  if (!result.ok) {
    if (result.reason === "limit") {
      return fail(
        "too_many_reservations",
        `Ya tienes muchos números apartados (máximo ${MAX_ACTIVE_RESERVED_PER_CLIENT}). Completa esos apartados o espera a que venzan`,
        { max: MAX_ACTIVE_RESERVED_PER_CLIENT },
      );
    }
    return fail("numbers_unavailable", "Algunos números ya no están disponibles", {
      unavailable: result.unavailable,
    });
  }
  return ok({ code, numbers: parsed.value, reservedAt, reservedUntil });
}

// ───────────── Zona de administración (requiere sesión; se expone en la Fase 2) ─────────────

async function loadRaffle(deps: Deps, orgId: string, raffleId: string): Promise<Result<Raffle>> {
  const raffle = await deps.raffles.findById(orgId, raffleId);
  return raffle ? ok(raffle) : fail("not_found", "Rifa no encontrada");
}

export function parsePayment(input: unknown): Result<Payment> {
  const p = input as { status?: unknown; dueDate?: unknown } | null;
  if (p?.status === "pagado") return ok({ status: "pagado" });
  if (p?.status === "debe") {
    if (!isValidDate(p.dueDate)) {
      return fail("invalid_input", "Un número que se debe requiere fecha de pago (AAAA-MM-DD)");
    }
    return ok({ status: "debe", dueDate: p.dueDate });
  }
  return fail("invalid_input", "El estado de pago debe ser 'pagado' o 'debe'");
}

function cleanBuyer(input: Buyer | undefined): Buyer {
  return {
    name: cleanText(input?.name, MAX_NAME_LENGTH),
    phone: cleanText(input?.phone, 20),
    note: cleanText(input?.note, MAX_NOTE_LENGTH),
  };
}

/** El admin bloquea un número como vendido (pagado o debe + fecha). */
export async function markSold(
  deps: Deps,
  input: { orgId: string; raffleId: string; number: number; payment: unknown; buyer?: Buyer },
): Promise<Result<null>> {
  const raffle = await loadRaffle(deps, input.orgId, input.raffleId);
  if (!raffle.ok) return raffle;
  if (!isNumberInRange(input.number, raffle.value.totalNumbers)) {
    return fail("invalid_input", "El número está fuera del rango de la rifa");
  }
  const payment = parsePayment(input.payment);
  if (!payment.ok) return payment;

  await deps.tickets.markSold({
    orgId: input.orgId,
    raffleId: input.raffleId,
    number: input.number,
    payment: payment.value,
    buyer: cleanBuyer(input.buyer),
    now: deps.clock.now().toISOString(),
  });
  return ok(null);
}

/** Cambia un número vendido entre `debe` y `pagado`. */
export async function updatePayment(
  deps: Deps,
  input: { orgId: string; raffleId: string; number: number; payment: unknown },
): Promise<Result<null>> {
  const raffle = await loadRaffle(deps, input.orgId, input.raffleId);
  if (!raffle.ok) return raffle;
  if (!isNumberInRange(input.number, raffle.value.totalNumbers)) {
    return fail("invalid_input", "El número está fuera del rango de la rifa");
  }
  const payment = parsePayment(input.payment);
  if (!payment.ok) return payment;

  const updated = await deps.tickets.updatePayment({
    orgId: input.orgId,
    raffleId: input.raffleId,
    number: input.number,
    payment: payment.value,
    now: deps.clock.now().toISOString(),
  });
  return updated ? ok(null) : fail("invalid_state", "El número no está vendido");
}

/** El admin devuelve un número a `activo`. */
export async function releaseTicket(
  deps: Deps,
  input: { orgId: string; raffleId: string; number: number },
): Promise<Result<null>> {
  const raffle = await loadRaffle(deps, input.orgId, input.raffleId);
  if (!raffle.ok) return raffle;
  if (!isNumberInRange(input.number, raffle.value.totalNumbers)) {
    return fail("invalid_input", "El número está fuera del rango de la rifa");
  }
  const released = await deps.tickets.release({
    orgId: input.orgId,
    raffleId: input.raffleId,
    number: input.number,
    now: deps.clock.now().toISOString(),
  });
  return released ? ok(null) : fail("invalid_state", "El número ya está activo");
}

export async function listAdminTickets(
  deps: Deps,
  input: {
    orgId: string;
    raffleId: string;
    status?: "apartado" | "vendido";
    paymentStatus?: PaymentStatus;
  },
): Promise<Result<TicketRecord[]>> {
  const raffle = await loadRaffle(deps, input.orgId, input.raffleId);
  if (!raffle.ok) return raffle;
  const filter: { status?: "apartado" | "vendido"; paymentStatus?: PaymentStatus } = {};
  if (input.status) filter.status = input.status;
  if (input.paymentStatus) filter.paymentStatus = input.paymentStatus;
  return ok(await deps.tickets.listAdmin(input.orgId, input.raffleId, filter));
}

/** Listado de deudas: vendidos con saldo pendiente, ordenados por fecha de pago. */
export async function listDebts(
  deps: Deps,
  input: { orgId: string; raffleId: string },
): Promise<Result<TicketRecord[]>> {
  return listAdminTickets(deps, { ...input, status: "vendido", paymentStatus: "debe" });
}

export async function listHistory(
  deps: Deps,
  input: { orgId: string; raffleId: string; number?: number; beforeId?: number; limit?: number },
): Promise<Result<TicketEvent[]>> {
  const raffle = await loadRaffle(deps, input.orgId, input.raffleId);
  if (!raffle.ok) return raffle;
  const options: { number?: number; limit: number; beforeId?: number } = {
    limit: Math.min(input.limit ?? HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZE),
  };
  if (input.number !== undefined) options.number = input.number;
  if (input.beforeId !== undefined) options.beforeId = input.beforeId;
  return ok(await deps.tickets.listEvents(input.orgId, input.raffleId, options));
}

// ───────────── Sistema (Cron) ─────────────

/** Persiste en el historial los apartados vencidos y los devuelve a `activo`. */
export async function expireReservations(deps: Deps): Promise<number> {
  return deps.tickets.expireDue(deps.clock.now().toISOString());
}
