import type { Deps } from "./deps";
import { isValidTotalNumbers, numberWidth } from "./numbers";
import { fail, ok, type Result } from "./result";
import type { Raffle, RaffleStatus } from "./types";
import { cleanText, isValidDate, isValidSlug } from "./validation";

export interface CreateRaffleInput {
  orgId: string;
  slug: string;
  title: string;
  description?: string;
  totalNumbers: number;
  ticketPrice?: number | null;
  drawDate?: string | null;
  status?: RaffleStatus;
}

export async function createRaffle(deps: Deps, input: CreateRaffleInput): Promise<Result<Raffle>> {
  const title = cleanText(input.title, 120);
  if (!title || title.length < 3) return fail("invalid_input", "El título es obligatorio");
  if (!isValidSlug(input.slug))
    return fail("invalid_input", "El identificador (slug) no es válido");
  if (!isValidTotalNumbers(input.totalNumbers)) {
    return fail("invalid_input", "La cantidad de números debe estar entre 10 y 10 000");
  }
  const price = input.ticketPrice ?? null;
  if (price !== null && !(Number.isInteger(price) && price >= 0)) {
    return fail("invalid_input", "El precio debe ser un entero en pesos");
  }
  const drawDate = input.drawDate ?? null;
  if (drawDate !== null && !isValidDate(drawDate)) {
    return fail("invalid_input", "La fecha del sorteo no es válida (AAAA-MM-DD)");
  }

  const raffle: Raffle = {
    id: deps.ids.uuid(),
    orgId: input.orgId,
    slug: input.slug,
    title,
    description: cleanText(input.description, 2000) ?? "",
    totalNumbers: input.totalNumbers,
    numberWidth: numberWidth(input.totalNumbers),
    ticketPrice: price,
    status: input.status ?? "borrador",
    drawDate,
    createdAt: deps.clock.now().toISOString(),
  };
  const created = await deps.raffles.create(raffle);
  if (!created.ok) return fail("slug_taken", "Ya existe una rifa con ese identificador");
  return ok(raffle);
}

export async function setRaffleStatus(
  deps: Deps,
  input: { orgId: string; raffleId: string; status: RaffleStatus },
): Promise<Result<null>> {
  const updated = await deps.raffles.setStatus(input.orgId, input.raffleId, input.status);
  return updated ? ok(null) : fail("not_found", "Rifa no encontrada");
}
