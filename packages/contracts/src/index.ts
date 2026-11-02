import { z } from "zod";

/** Respuesta de GET /api/v1/health, compartida entre API y web. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("rifas-api"),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Formato uniforme de error. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ───────────── Zona pública ─────────────

export const publicRaffleResponseSchema = z.object({
  organization: z.object({
    name: z.string(),
    slug: z.string(),
    /** Formato internacional sin '+', p. ej. 57XXXXXXXXXX. */
    whatsappPhone: z.string(),
  }),
  raffle: z.object({
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    totalNumbers: z.number().int(),
    /** Cifras con las que se muestra cada número (ceros a la izquierda). */
    numberWidth: z.number().int(),
    ticketPrice: z.number().int().nullable(),
    drawDate: z.string().nullable(),
  }),
});
export type PublicRaffleResponse = z.infer<typeof publicRaffleResponseSchema>;

/** Solo números NO disponibles; el resto de 0 a totalNumbers - 1 está disponible. */
export const publicTicketsResponseSchema = z.object({
  tickets: z.array(
    z.object({
      number: z.number().int().nonnegative(),
      status: z.enum(["apartado", "vendido"]),
    }),
  ),
});
export type PublicTicketsResponse = z.infer<typeof publicTicketsResponseSchema>;

export const reserveRequestSchema = z.object({
  numbers: z.array(z.number().int().nonnegative()).min(1),
});
export type ReserveRequest = z.infer<typeof reserveRequestSchema>;

export const reserveResponseSchema = z.object({
  code: z.string(),
  numbers: z.array(z.number().int().nonnegative()),
  reservedAt: z.string(),
  reservedUntil: z.string(),
});
export type ReserveResponse = z.infer<typeof reserveResponseSchema>;
