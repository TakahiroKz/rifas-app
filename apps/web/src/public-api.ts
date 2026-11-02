import {
  errorResponseSchema,
  type PublicRaffleResponse,
  type PublicTicketsResponse,
  publicRaffleResponseSchema,
  publicTicketsResponseSchema,
  type ReserveResponse,
  reserveResponseSchema,
} from "@rifas/contracts";
import type { z } from "zod";
import { ApiError } from "./api";

async function call<S extends z.ZodType>(
  method: "GET" | "POST",
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> {
  const res = await fetch(`/api/v1/public${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    const error = parsed.success ? parsed.data.error : null;
    throw new ApiError(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? "Ocurrió un error inesperado",
      error?.details,
    );
  }
  return schema.parse(data);
}

const enc = encodeURIComponent;

export const publicApi = {
  getRaffle: (org: string, raffle: string): Promise<PublicRaffleResponse> =>
    call("GET", `/${enc(org)}/${enc(raffle)}`, publicRaffleResponseSchema),
  getTickets: async (org: string, raffle: string): Promise<PublicTicketsResponse["tickets"]> =>
    (await call("GET", `/${enc(org)}/${enc(raffle)}/tickets`, publicTicketsResponseSchema)).tickets,
  reserve: (
    org: string,
    raffle: string,
    numbers: number[],
    turnstileToken?: string,
  ): Promise<ReserveResponse> =>
    call("POST", `/${enc(org)}/${enc(raffle)}/reservations`, reserveResponseSchema, {
      numbers,
      ...(turnstileToken ? { turnstileToken } : {}),
    }),
};
