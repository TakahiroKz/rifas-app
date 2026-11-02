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
    /** `cerrada` = solo lectura: se ven los resultados, ya no se puede apartar. */
    status: z.enum(["activa", "cerrada"]),
  }),
  /** Premios y ganadores (solo números; nunca datos de compradores). */
  prizes: z.array(
    z.object({
      place: z.number().int(),
      description: z.string(),
      lotteryName: z.string(),
      drawDate: z.string(),
      status: z.enum(["pendiente", "anunciado", "finalizado"]),
      resultNumber: z.string().nullable(),
      winningNumbers: z.array(z.number().int().nonnegative()),
    }),
  ),
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
  overdue: z.number().int(),
  soldAmount: z.number().int().nullable(),
  paidAmount: z.number().int().nullable(),
  owedAmount: z.number().int().nullable(),
  overdueAmount: z.number().int().nullable(),
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

// ───────────── Loterías y premios (administración) ─────────────

export const lotterySchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  /** 0 = domingo … 6 = sábado */
  drawWeekdays: z.array(z.number().int()),
});
export const lotteriesResponseSchema = z.object({
  lotteries: z.array(lotterySchema),
  /** Si la consulta automática de resultados está activada. */
  syncEnabled: z.boolean(),
});
export type LotteriesResponse = z.infer<typeof lotteriesResponseSchema>;

export const calendarResponseSchema = z.object({ days: z.array(z.string()) });

export const resultLookupSchema = z.object({
  result: z
    .object({
      number: z.string(),
      series: z.string().nullable(),
      source: z.enum(["gane", "manual"]),
      drawDate: z.string(),
    })
    .nullable(),
});
export type ResultLookup = z.infer<typeof resultLookupSchema>;

export const manualResultRequestSchema = z.object({
  number: z.string(),
  series: z.string().optional(),
});

export const fetchResultResponseSchema = z.object({ found: z.boolean() });

const matchTypeSchema = z.enum(["first", "last"]);
const onNoWinnerSchema = z.enum(["reprogramar", "finalizar"]);

export const adminPrizeSchema = z.object({
  id: z.string(),
  place: z.number().int(),
  description: z.string(),
  lotteryId: z.string(),
  lotteryName: z.string(),
  matchType: matchTypeSchema,
  digits: z.number().int(),
  drawDate: z.string(),
  onNoWinner: onNoWinnerSchema,
  maxAttempts: z.number().int().nullable(),
  status: z.enum(["pendiente", "anunciado", "finalizado"]),
  attempts: z.array(
    z.object({
      attemptNo: z.number().int(),
      drawDate: z.string(),
      resultNumber: z.string(),
      outcome: z.enum(["ganador", "sin_ganador"]),
      createdAt: z.string(),
    }),
  ),
  winners: z.array(
    z.object({
      number: z.number().int(),
      buyerName: z.string().nullable(),
      buyerPhone: z.string().nullable(),
      paymentStatus: z.enum(["pagado", "debe"]),
    }),
  ),
});
export type AdminPrize = z.infer<typeof adminPrizeSchema>;
export const adminPrizesResponseSchema = z.object({ prizes: z.array(adminPrizeSchema) });

export const createPrizeRequestSchema = z.object({
  place: z.number().int().optional(),
  description: z.string(),
  lotteryId: z.string(),
  matchType: matchTypeSchema,
  digits: z.number().int(),
  drawDate: z.string(),
  onNoWinner: onNoWinnerSchema,
  maxAttempts: z.number().int().nullable(),
});
export type CreatePrizeRequest = z.infer<typeof createPrizeRequestSchema>;

export const updatePrizeRequestSchema = z.object({
  description: z.string().optional(),
  lotteryId: z.string().optional(),
  matchType: matchTypeSchema.optional(),
  digits: z.number().int().optional(),
  drawDate: z.string().optional(),
  onNoWinner: onNoWinnerSchema.optional(),
  maxAttempts: z.number().int().nullable().optional(),
});
export type UpdatePrizeRequest = z.infer<typeof updatePrizeRequestSchema>;

export const proposalSchema = z.object({
  prizeId: z.string(),
  outcome: z.enum(["sin_resultado", "ganador", "sin_ganador"]),
  result: resultLookupSchema.shape.result,
  /** Cifras del resultado que cuentan, p. ej. "22". */
  term: z.string().nullable(),
  winners: z.array(
    z.object({
      number: z.number().int(),
      buyerName: z.string().nullable(),
      buyerPhone: z.string().nullable(),
      paymentStatus: z.enum(["pagado", "debe"]),
    }),
  ),
  /** Números que coinciden pero no están vendidos. */
  unsoldMatches: z.number().int(),
  attemptNo: z.number().int(),
  canReprogram: z.boolean(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const resolveRequestSchema = z.object({ nextDrawDate: z.string().optional() });

export const resolveResponseSchema = z.object({
  outcome: z.enum(["ganador", "sin_ganador"]),
  status: z.enum(["pendiente", "anunciado", "finalizado"]),
  winningNumbers: z.array(z.number().int()),
  nextDrawDate: z.string().nullable(),
});
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;

// ───────────── Reporte de la rifa ─────────────

export const raffleReportSchema = z.object({
  raffle: adminRaffleSchema,
  /** Últimos 30 días (hora de Colombia), con ceros donde no hubo movimiento. */
  activity: z.array(
    z.object({ day: z.string(), reserved: z.number().int(), sold: z.number().int() }),
  ),
  debts: z.object({
    overdueCount: z.number().int(),
    overdueAmount: z.number().int().nullable(),
    oldestOverdueDate: z.string().nullable(),
    nextDueDate: z.string().nullable(),
  }),
  soldPercent: z.number(),
});
export type RaffleReport = z.infer<typeof raffleReportSchema>;
