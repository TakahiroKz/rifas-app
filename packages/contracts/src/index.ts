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
  /** Clave pública de Turnstile; null si la verificación no está activa. */
  turnstileSiteKey: z.string().nullable(),
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
  /** Token de Turnstile (obligatorio cuando la verificación está activa). */
  turnstileToken: z.string().max(2048).optional(),
});
export type ReserveRequest = z.infer<typeof reserveRequestSchema>;

export const reserveResponseSchema = z.object({
  code: z.string(),
  numbers: z.array(z.number().int().nonnegative()),
  reservedAt: z.string(),
  reservedUntil: z.string(),
});
export type ReserveResponse = z.infer<typeof reserveResponseSchema>;

// ───────────── Administración ─────────────

export const loginRequestSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionResponseSchema = z.object({
  user: z.object({ name: z.string(), email: z.string() }),
  organization: z.object({
    name: z.string(),
    slug: z.string(),
    whatsappPhone: z.string(),
  }),
  /** Se envía en el encabezado X-CSRF-Token en toda petición que modifica datos. */
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const raffleStatusSchema = z.enum(["borrador", "activa", "cerrada"]);

export const raffleStatsSchema = z.object({
  reserved: z.number().int(),
  sold: z.number().int(),
  paid: z.number().int(),
  owed: z.number().int(),
  soldAmount: z.number().int().nullable(),
  paidAmount: z.number().int().nullable(),
  owedAmount: z.number().int().nullable(),
});

export const adminRaffleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  totalNumbers: z.number().int(),
  numberWidth: z.number().int(),
  ticketPrice: z.number().int().nullable(),
  status: raffleStatusSchema,
  drawDate: z.string().nullable(),
  createdAt: z.string(),
  stats: raffleStatsSchema,
});
export type AdminRaffle = z.infer<typeof adminRaffleSchema>;

export const adminRaffleListSchema = z.object({ raffles: z.array(adminRaffleSchema) });

export const createRaffleRequestSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  totalNumbers: z.number().int(),
  ticketPrice: z.number().int().nullable().optional(),
  drawDate: z.string().nullable().optional(),
  status: raffleStatusSchema.optional(),
});
export type CreateRaffleRequest = z.infer<typeof createRaffleRequestSchema>;

export const updateRaffleRequestSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  ticketPrice: z.number().int().nullable().optional(),
  drawDate: z.string().nullable().optional(),
  status: raffleStatusSchema.optional(),
});
export type UpdateRaffleRequest = z.infer<typeof updateRaffleRequestSchema>;

export const updateOrganizationRequestSchema = z.object({
  name: z.string().optional(),
  whatsappPhone: z.string().optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

export const paymentSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pagado") }),
  z.object({ status: z.literal("debe"), dueDate: z.string() }),
]);
export type PaymentInput = z.infer<typeof paymentSchema>;

export const buyerSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  note: z.string().optional(),
});

export const saleRequestSchema = z.object({
  payment: paymentSchema,
  buyer: buyerSchema.optional(),
});
export type SaleRequest = z.infer<typeof saleRequestSchema>;

export const paymentRequestSchema = z.object({ payment: paymentSchema });

export const adminTicketSchema = z.object({
  number: z.number().int(),
  status: z.enum(["apartado", "vendido"]),
  paymentStatus: z.enum(["pagado", "debe"]).nullable(),
  dueDate: z.string().nullable(),
  buyerName: z.string().nullable(),
  buyerPhone: z.string().nullable(),
  note: z.string().nullable(),
  reservationCode: z.string().nullable(),
  reservedAt: z.string().nullable(),
  reservedUntil: z.string().nullable(),
  soldAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type AdminTicket = z.infer<typeof adminTicketSchema>;

export const adminTicketsResponseSchema = z.object({ tickets: z.array(adminTicketSchema) });

export const ticketEventSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  action: z.enum(["reserve", "expire", "sell", "update_payment", "release"]),
  fromStatus: z.enum(["activo", "apartado", "vendido"]),
  toStatus: z.enum(["activo", "apartado", "vendido"]),
  actor: z.enum(["public", "admin", "system"]),
  reservationCode: z.string().nullable(),
  at: z.string(),
});
export type TicketEventDto = z.infer<typeof ticketEventSchema>;

export const historyResponseSchema = z.object({ events: z.array(ticketEventSchema) });

export const reservationLookupSchema = z.object({
  numbers: z.array(z.number().int()),
  reservedUntil: z.string().nullable(),
});
export type ReservationLookup = z.infer<typeof reservationLookupSchema>;
