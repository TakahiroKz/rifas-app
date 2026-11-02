import {
  type AdminPrize,
  type AdminRaffle,
  type AdminTicket,
  adminPrizesResponseSchema,
  adminRaffleListSchema,
  adminRaffleSchema,
  adminTicketsResponseSchema,
  type CreatePrizeRequest,
  type CreateRaffleRequest,
  calendarResponseSchema,
  errorResponseSchema,
  fetchResultResponseSchema,
  historyResponseSchema,
  type LotteriesResponse,
  lotteriesResponseSchema,
  type PaymentInput,
  type Proposal,
  proposalSchema,
  type RaffleReport,
  type ReservationLookup,
  type ResolveResponse,
  type ResultLookup,
  raffleReportSchema,
  reservationLookupSchema,
  resolveResponseSchema,
  resultLookupSchema,
  type SessionResponse,
  sessionResponseSchema,
  type TicketEventDto,
  type UpdateOrganizationRequest,
  type UpdatePrizeRequest,
  type UpdateRaffleRequest,
} from "@rifas/contracts";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrfToken = "";
let onUnauthorized: () => void = () => {};

export const setCsrfToken = (token: string) => {
  csrfToken = token;
};
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

async function request<S extends z.ZodType>(
  method: string,
  path: string,
  options: { body?: unknown; schema: S },
): Promise<z.infer<S>>;
async function request(method: string, path: string, options?: { body?: unknown }): Promise<void>;
async function request(
  method: string,
  path: string,
  options: { body?: unknown; schema?: z.ZodType } = {},
): Promise<unknown> {
  const hasBody = options.body !== undefined;
  const res = await fetch(`/api/v1/admin${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });

  if (res.status === 204) return undefined;
  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    const error = parsed.success ? parsed.data.error : null;
    // 401 en cualquier ruta salvo el propio login: la sesión caducó.
    if (res.status === 401 && path !== "/login") onUnauthorized();
    throw new ApiError(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? "Ocurrió un error inesperado",
      error?.details,
    );
  }
  return options.schema ? options.schema.parse(data) : data;
}

const enc = encodeURIComponent;

export const api = {
  login: async (email: string, password: string): Promise<SessionResponse> => {
    const s = await request("POST", "/login", {
      body: { email, password },
      schema: sessionResponseSchema,
    });
    setCsrfToken(s.csrfToken);
    return s;
  },
  logout: () => request("POST", "/logout"),
  session: async (): Promise<SessionResponse> => {
    const s = await request("GET", "/session", { schema: sessionResponseSchema });
    setCsrfToken(s.csrfToken);
    return s;
  },
  updateOrganization: async (patch: UpdateOrganizationRequest): Promise<SessionResponse> => {
    const s = await request("PATCH", "/organization", {
      body: patch,
      schema: sessionResponseSchema,
    });
    setCsrfToken(s.csrfToken);
    return s;
  },

  listRaffles: async (): Promise<AdminRaffle[]> =>
    (await request("GET", "/raffles", { schema: adminRaffleListSchema })).raffles,
  getRaffle: (id: string): Promise<AdminRaffle> =>
    request("GET", `/raffles/${enc(id)}`, { schema: adminRaffleSchema }),
  createRaffle: (input: CreateRaffleRequest): Promise<AdminRaffle> =>
    request("POST", "/raffles", { body: input, schema: adminRaffleSchema }),
  updateRaffle: (id: string, patch: UpdateRaffleRequest): Promise<AdminRaffle> =>
    request("PATCH", `/raffles/${enc(id)}`, { body: patch, schema: adminRaffleSchema }),

  listTickets: async (id: string): Promise<AdminTicket[]> =>
    (await request("GET", `/raffles/${enc(id)}/tickets`, { schema: adminTicketsResponseSchema }))
      .tickets,
  listDebts: async (id: string): Promise<AdminTicket[]> =>
    (await request("GET", `/raffles/${enc(id)}/debts`, { schema: adminTicketsResponseSchema }))
      .tickets,
  listHistory: async (
    id: string,
    options: { number?: number; beforeId?: number; limit?: number } = {},
  ): Promise<TicketEventDto[]> => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(options)) if (v !== undefined) query.set(k, String(v));
    const qs = query.size > 0 ? `?${query}` : "";
    return (
      await request("GET", `/raffles/${enc(id)}/history${qs}`, { schema: historyResponseSchema })
    ).events;
  },

  sellTicket: (id: string, number: number, body: { payment: PaymentInput; buyer?: Buyer }) =>
    request("PUT", `/raffles/${enc(id)}/tickets/${number}/sale`, { body }),
  setPayment: (id: string, number: number, payment: PaymentInput) =>
    request("PATCH", `/raffles/${enc(id)}/tickets/${number}/payment`, { body: { payment } }),
  releaseTicket: (id: string, number: number) =>
    request("DELETE", `/raffles/${enc(id)}/tickets/${number}`),

  findReservation: (id: string, code: string): Promise<ReservationLookup> =>
    request("GET", `/raffles/${enc(id)}/reservations/${enc(code.trim())}`, {
      schema: reservationLookupSchema,
    }),
  getReport: (id: string): Promise<RaffleReport> =>
    request("GET", `/raffles/${enc(id)}/report`, { schema: raffleReportSchema }),
  /** Enlace de descarga del CSV (la cookie de sesión viaja sola). */
  exportCsvUrl: (id: string) => `/api/v1/admin/raffles/${enc(id)}/export.csv`,

  // ───────────── Loterías y premios ─────────────
  listLotteries: (): Promise<LotteriesResponse> =>
    request("GET", "/lotteries", { schema: lotteriesResponseSchema }),
  getCalendar: async (lotteryId: string, from?: string): Promise<string[]> =>
    (
      await request(
        "GET",
        `/lotteries/${enc(lotteryId)}/calendar${from ? `?from=${enc(from)}` : ""}`,
        {
          schema: calendarResponseSchema,
        },
      )
    ).days,
  getResult: async (lotteryId: string, date: string): Promise<ResultLookup["result"]> =>
    (
      await request("GET", `/lotteries/${enc(lotteryId)}/results/${enc(date)}`, {
        schema: resultLookupSchema,
      })
    ).result,
  enterResult: (lotteryId: string, date: string, number: string) =>
    request("PUT", `/lotteries/${enc(lotteryId)}/results/${enc(date)}`, {
      body: { number },
      schema: resultLookupSchema,
    }),
  fetchResult: (lotteryId: string, date: string) =>
    request("POST", `/lotteries/${enc(lotteryId)}/results/${enc(date)}/fetch`, {
      schema: fetchResultResponseSchema,
    }),
  listPrizes: async (raffleId: string): Promise<AdminPrize[]> =>
    (
      await request("GET", `/raffles/${enc(raffleId)}/prizes`, {
        schema: adminPrizesResponseSchema,
      })
    ).prizes,
  createPrize: (raffleId: string, body: CreatePrizeRequest) =>
    request("POST", `/raffles/${enc(raffleId)}/prizes`, { body }),
  updatePrize: (raffleId: string, prizeId: string, body: UpdatePrizeRequest) =>
    request("PATCH", `/raffles/${enc(raffleId)}/prizes/${enc(prizeId)}`, { body }),
  deletePrize: (raffleId: string, prizeId: string) =>
    request("DELETE", `/raffles/${enc(raffleId)}/prizes/${enc(prizeId)}`),
  getProposal: (raffleId: string, prizeId: string): Promise<Proposal> =>
    request("GET", `/raffles/${enc(raffleId)}/prizes/${enc(prizeId)}/proposal`, {
      schema: proposalSchema,
    }),
  resolvePrize: (
    raffleId: string,
    prizeId: string,
    nextDrawDate?: string,
  ): Promise<ResolveResponse> =>
    request("POST", `/raffles/${enc(raffleId)}/prizes/${enc(prizeId)}/resolve`, {
      body: nextDrawDate ? { nextDrawDate } : {},
      schema: resolveResponseSchema,
    }),

  sellReservation: (id: string, code: string, body: { payment: PaymentInput; buyer?: Buyer }) =>
    request("POST", `/raffles/${enc(id)}/reservations/${enc(code.trim())}/sale`, { body }),
};

export interface Buyer {
  name?: string;
  phone?: string;
  note?: string;
}
