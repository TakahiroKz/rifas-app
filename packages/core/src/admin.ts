import type { Deps } from "./deps";
import { fail, ok, type Result } from "./result";
import { markSold } from "./tickets";
import type { Buyer, Organization, RaffleStats, RaffleStatus, RaffleWithStats } from "./types";
import { cleanText, isValidDate, isValidPhone } from "./validation";

const RAFFLE_STATUSES: RaffleStatus[] = ["borrador", "activa", "cerrada"];

function buildStats(
  price: number | null,
  c: { reserved: number; sold: number; paid: number; owed: number } | undefined,
): RaffleStats {
  const counts = c ?? { reserved: 0, sold: 0, paid: 0, owed: 0 };
  const amount = (n: number) => (price === null ? null : n * price);
  return {
    ...counts,
    soldAmount: amount(counts.sold),
    paidAmount: amount(counts.paid),
    owedAmount: amount(counts.owed),
  };
}

export async function listRafflesWithStats(
  deps: Deps,
  input: { orgId: string },
): Promise<RaffleWithStats[]> {
  const now = deps.clock.now().toISOString();
  const [raffles, counts] = await Promise.all([
    deps.raffles.listByOrg(input.orgId),
    deps.tickets.countByRaffle(input.orgId, now),
  ]);
  return raffles.map((r) => ({ ...r, stats: buildStats(r.ticketPrice, counts.get(r.id)) }));
}

export async function getRaffleWithStats(
  deps: Deps,
  input: { orgId: string; raffleId: string },
): Promise<Result<RaffleWithStats>> {
  const raffle = await deps.raffles.findById(input.orgId, input.raffleId);
  if (!raffle) return fail("not_found", "Rifa no encontrada");
  const counts = await deps.tickets.countByRaffle(input.orgId, deps.clock.now().toISOString());
  return ok({ ...raffle, stats: buildStats(raffle.ticketPrice, counts.get(raffle.id)) });
}

export interface UpdateRaffleInput {
  orgId: string;
  raffleId: string;
  title?: string;
  description?: string;
  ticketPrice?: number | null;
  drawDate?: string | null;
  status?: RaffleStatus;
}

/** El identificador (slug) y la cantidad de números no cambian una vez creada la rifa. */
export async function updateRaffle(deps: Deps, input: UpdateRaffleInput): Promise<Result<null>> {
  const patch: Parameters<Deps["raffles"]["update"]>[2] = {};
  if (input.title !== undefined) {
    const title = cleanText(input.title, 120);
    if (!title || title.length < 3) return fail("invalid_input", "El título es obligatorio");
    patch.title = title;
  }
  if (input.description !== undefined) patch.description = cleanText(input.description, 2000) ?? "";
  if (input.ticketPrice !== undefined) {
    const p = input.ticketPrice;
    if (p !== null && !(Number.isInteger(p) && p >= 0)) {
      return fail("invalid_input", "El precio debe ser un entero en pesos");
    }
    patch.ticketPrice = p;
  }
  if (input.drawDate !== undefined) {
    if (input.drawDate !== null && !isValidDate(input.drawDate)) {
      return fail("invalid_input", "La fecha del sorteo no es válida (AAAA-MM-DD)");
    }
    patch.drawDate = input.drawDate;
  }
  if (input.status !== undefined) {
    if (!RAFFLE_STATUSES.includes(input.status)) return fail("invalid_input", "Estado no válido");
    patch.status = input.status;
  }
  if (Object.keys(patch).length === 0) return fail("invalid_input", "No hay cambios para guardar");

  const updated = await deps.raffles.update(input.orgId, input.raffleId, patch);
  return updated ? ok(null) : fail("not_found", "Rifa no encontrada");
}

export async function updateOrganization(
  deps: Deps,
  input: { orgId: string; name?: string; whatsappPhone?: string },
): Promise<Result<Organization>> {
  const patch: { name?: string; whatsappPhone?: string } = {};
  if (input.name !== undefined) {
    const name = cleanText(input.name, 80);
    if (!name || name.length < 2) return fail("invalid_input", "El nombre es obligatorio");
    patch.name = name;
  }
  if (input.whatsappPhone !== undefined) {
    if (!isValidPhone(input.whatsappPhone)) {
      return fail("invalid_input", "El teléfono debe tener 10 a 15 dígitos, sin '+'");
    }
    patch.whatsappPhone = input.whatsappPhone;
  }
  if (Object.keys(patch).length === 0) return fail("invalid_input", "No hay cambios para guardar");
  if (!(await deps.orgs.update(input.orgId, patch)))
    return fail("not_found", "Organización no encontrada");
  const org = await deps.orgs.findById(input.orgId);
  return org ? ok(org) : fail("not_found", "Organización no encontrada");
}

export async function findReservation(
  deps: Deps,
  input: { orgId: string; raffleId: string; code: string },
): Promise<Result<{ numbers: number[]; reservedUntil: string | null }>> {
  const raffle = await deps.raffles.findById(input.orgId, input.raffleId);
  if (!raffle) return fail("not_found", "Rifa no encontrada");
  const code = input.code.trim().toUpperCase();
  const rows = await deps.tickets.findReservation(
    input.orgId,
    input.raffleId,
    code,
    deps.clock.now().toISOString(),
  );
  if (rows.length === 0) return fail("not_found", "No hay un apartado vigente con ese código");
  return ok({
    numbers: rows.map((r) => r.number).sort((a, b) => a - b),
    reservedUntil: rows[0]?.reservedUntil ?? null,
  });
}

/** Vende de una vez todos los números de un apartado (flujo típico tras el mensaje de WhatsApp). */
export async function sellReservation(
  deps: Deps,
  input: { orgId: string; raffleId: string; code: string; payment: unknown; buyer?: Buyer },
): Promise<Result<{ numbers: number[] }>> {
  const found = await findReservation(deps, input);
  if (!found.ok) return found;
  for (const number of found.value.numbers) {
    const sold = await markSold(deps, {
      orgId: input.orgId,
      raffleId: input.raffleId,
      number,
      payment: input.payment,
      ...(input.buyer ? { buyer: input.buyer } : {}),
    });
    if (!sold.ok) return sold;
  }
  return ok({ numbers: found.value.numbers });
}
