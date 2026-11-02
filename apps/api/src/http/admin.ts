import {
  type AdminRaffle,
  createRaffleRequestSchema,
  loginRequestSchema,
  paymentRequestSchema,
  type SessionResponse,
  saleRequestSchema,
  updateOrganizationRequestSchema,
  updateRaffleRequestSchema,
} from "@rifas/contracts";
import {
  createRaffle,
  findReservation,
  getRaffleWithStats,
  listAdminTickets,
  listDebts,
  listHistory,
  listRafflesWithStats,
  login,
  logout,
  markSold,
  type Organization,
  type RaffleWithStats,
  type Result,
  releaseTicket,
  sellReservation,
  updateOrganization,
  updatePayment,
  updateRaffle,
} from "@rifas/core";
import { Hono } from "hono";
import type { z } from "zod";
import { type AdminEnv, forbiddenOrigin, requireAuth, sameOrigin } from "./admin-auth";
import { prizeRoutes } from "./admin-prizes";
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from "./cookies";
import { type HttpStatus, toHttpError } from "./errors";

export const adminRoutes = new Hono<AdminEnv>();

const invalidInput = (message: string) => ({ error: { code: "invalid_input", message } });

function sessionBody(
  user: { name: string; email: string },
  org: Organization,
  csrfToken: string,
): SessionResponse {
  return {
    user: { name: user.name, email: user.email },
    organization: { name: org.name, slug: org.slug, whatsappPhone: org.whatsappPhone },
    csrfToken,
  };
}

const toRaffleDto = (r: RaffleWithStats): AdminRaffle => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  description: r.description,
  totalNumbers: r.totalNumbers,
  numberWidth: r.numberWidth,
  ticketPrice: r.ticketPrice,
  status: r.status,
  drawDate: r.drawDate,
  createdAt: r.createdAt,
  stats: r.stats,
});

/** Parsea el cuerpo JSON; devuelve null si es inválido. */
async function body<S extends z.ZodType>(
  c: { req: { json: () => Promise<unknown> } },
  schema: S,
): Promise<z.infer<S> | null> {
  const payload = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

const parseNumber = (text: string | undefined): number | null =>
  text !== undefined && /^\d{1,5}$/.test(text) ? Number(text) : null;

const parseOptionalInt = (text: string | undefined): number | null | undefined => {
  if (text === undefined || text === "") return undefined;
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
};

// ───────────── Sesión (sin requireAuth) ─────────────

adminRoutes.post("/login", async (c) => {
  c.header("Cache-Control", "no-store");
  if (!sameOrigin(c.req.url, c.req.header("Origin"))) return c.json(forbiddenOrigin, 403);
  const data = await body(c, loginRequestSchema);
  if (!data) return c.json(invalidInput("Correo y contraseña son obligatorios"), 400);

  const result = await login(c.get("deps"), {
    email: data.email,
    password: data.password,
    ip: c.req.header("CF-Connecting-IP") ?? "unknown",
  });
  if (!result.ok) {
    const { status, body: err } = toHttpError(result.error);
    return c.json(err, status);
  }
  writeSessionCookie(c, result.value.token, result.value.expiresAt);
  return c.json(sessionBody(result.value.user, result.value.organization, result.value.csrfToken));
});

adminRoutes.post("/logout", async (c) => {
  c.header("Cache-Control", "no-store");
  if (!sameOrigin(c.req.url, c.req.header("Origin"))) return c.json(forbiddenOrigin, 403);
  await logout(c.get("deps"), readSessionCookie(c));
  clearSessionCookie(c);
  return c.body(null, 204);
});

// ───────────── Todo lo demás exige sesión ─────────────

adminRoutes.use("/*", requireAuth);
adminRoutes.route("/", prizeRoutes);

adminRoutes.get("/session", (c) => {
  const { user, organization, csrfToken } = c.get("auth");
  return c.json(sessionBody(user, organization, csrfToken));
});

adminRoutes.patch("/organization", async (c) => {
  const data = await body(c, updateOrganizationRequestSchema);
  if (!data) return c.json(invalidInput("Datos no válidos"), 400);
  const { organization, user, csrfToken } = c.get("auth");
  const input: { orgId: string; name?: string; whatsappPhone?: string } = {
    orgId: organization.id,
  };
  if (data.name !== undefined) input.name = data.name;
  if (data.whatsappPhone !== undefined) input.whatsappPhone = data.whatsappPhone;
  const result = await updateOrganization(c.get("deps"), input);
  if (!result.ok) return fail(c, result);
  return c.json(sessionBody(user, result.value, csrfToken));
});

function fail(
  c: { json: (b: unknown, s: HttpStatus) => Response },
  result: Extract<Result<unknown>, { ok: false }>,
) {
  const { status, body: err } = toHttpError(result.error);
  return c.json(err, status);
}

// ───────────── Rifas ─────────────

adminRoutes.get("/raffles", async (c) => {
  const raffles = await listRafflesWithStats(c.get("deps"), {
    orgId: c.get("auth").organization.id,
  });
  return c.json({ raffles: raffles.map(toRaffleDto) });
});

adminRoutes.post("/raffles", async (c) => {
  const data = await body(c, createRaffleRequestSchema);
  if (!data) return c.json(invalidInput("Datos de la rifa no válidos"), 400);
  const deps = c.get("deps");
  const orgId = c.get("auth").organization.id;
  const created = await createRaffle(deps, {
    orgId,
    slug: data.slug,
    title: data.title,
    totalNumbers: data.totalNumbers,
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.ticketPrice !== undefined ? { ticketPrice: data.ticketPrice } : {}),
    ...(data.drawDate !== undefined ? { drawDate: data.drawDate } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  });
  if (!created.ok) return fail(c, created);
  const detail = await getRaffleWithStats(deps, { orgId, raffleId: created.value.id });
  if (!detail.ok) return fail(c, detail);
  return c.json(toRaffleDto(detail.value), 201);
});

adminRoutes.get("/raffles/:id", async (c) => {
  const result = await getRaffleWithStats(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
  });
  return result.ok ? c.json(toRaffleDto(result.value)) : fail(c, result);
});

adminRoutes.patch("/raffles/:id", async (c) => {
  const data = await body(c, updateRaffleRequestSchema);
  if (!data) return c.json(invalidInput("Datos de la rifa no válidos"), 400);
  const deps = c.get("deps");
  const orgId = c.get("auth").organization.id;
  const raffleId = c.req.param("id");
  const updated = await updateRaffle(deps, {
    orgId,
    raffleId,
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.ticketPrice !== undefined ? { ticketPrice: data.ticketPrice } : {}),
    ...(data.drawDate !== undefined ? { drawDate: data.drawDate } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  });
  if (!updated.ok) return fail(c, updated);
  const detail = await getRaffleWithStats(deps, { orgId, raffleId });
  return detail.ok ? c.json(toRaffleDto(detail.value)) : fail(c, detail);
});

// ───────────── Números ─────────────

adminRoutes.get("/raffles/:id/tickets", async (c) => {
  const status = c.req.query("status");
  const payment = c.req.query("payment");
  if (status !== undefined && status !== "apartado" && status !== "vendido") {
    return c.json(invalidInput("Estado no válido"), 400);
  }
  if (payment !== undefined && payment !== "pagado" && payment !== "debe") {
    return c.json(invalidInput("Estado de pago no válido"), 400);
  }
  const result = await listAdminTickets(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    ...(status ? { status } : {}),
    ...(payment ? { paymentStatus: payment } : {}),
  });
  return result.ok
    ? c.json({ tickets: result.value.map(({ raffleId: _r, ...t }) => t) })
    : fail(c, result);
});

adminRoutes.put("/raffles/:id/tickets/:number/sale", async (c) => {
  const number = parseNumber(c.req.param("number"));
  const data = await body(c, saleRequestSchema);
  if (number === null || !data) return c.json(invalidInput("Datos de la venta no válidos"), 400);
  const result = await markSold(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    number,
    payment: data.payment,
    ...(data.buyer ? { buyer: data.buyer } : {}),
  });
  return result.ok ? c.body(null, 204) : fail(c, result);
});

adminRoutes.patch("/raffles/:id/tickets/:number/payment", async (c) => {
  const number = parseNumber(c.req.param("number"));
  const data = await body(c, paymentRequestSchema);
  if (number === null || !data) return c.json(invalidInput("Datos del pago no válidos"), 400);
  const result = await updatePayment(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    number,
    payment: data.payment,
  });
  return result.ok ? c.body(null, 204) : fail(c, result);
});

adminRoutes.delete("/raffles/:id/tickets/:number", async (c) => {
  const number = parseNumber(c.req.param("number"));
  if (number === null) return c.json(invalidInput("Número no válido"), 400);
  const result = await releaseTicket(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    number,
  });
  return result.ok ? c.body(null, 204) : fail(c, result);
});

// ───────────── Reservas por código (flujo WhatsApp) ─────────────

adminRoutes.get("/raffles/:id/reservations/:code", async (c) => {
  const result = await findReservation(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    code: c.req.param("code"),
  });
  return result.ok ? c.json(result.value) : fail(c, result);
});

adminRoutes.post("/raffles/:id/reservations/:code/sale", async (c) => {
  const data = await body(c, saleRequestSchema);
  if (!data) return c.json(invalidInput("Datos de la venta no válidos"), 400);
  const result = await sellReservation(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    code: c.req.param("code"),
    payment: data.payment,
    ...(data.buyer ? { buyer: data.buyer } : {}),
  });
  return result.ok ? c.json(result.value) : fail(c, result);
});

// ───────────── Deudas e historial ─────────────

adminRoutes.get("/raffles/:id/debts", async (c) => {
  const result = await listDebts(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
  });
  return result.ok
    ? c.json({ tickets: result.value.map(({ raffleId: _r, ...t }) => t) })
    : fail(c, result);
});

adminRoutes.get("/raffles/:id/history", async (c) => {
  const number = parseOptionalInt(c.req.query("number"));
  const beforeId = parseOptionalInt(c.req.query("beforeId"));
  const limit = parseOptionalInt(c.req.query("limit"));
  if (number === null || beforeId === null || limit === null) {
    return c.json(invalidInput("Parámetros no válidos"), 400);
  }
  const result = await listHistory(c.get("deps"), {
    orgId: c.get("auth").organization.id,
    raffleId: c.req.param("id"),
    ...(number !== undefined ? { number } : {}),
    ...(beforeId !== undefined ? { beforeId } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  return result.ok
    ? c.json({ events: result.value.map(({ raffleId: _r, ...e }) => e) })
    : fail(c, result);
});
