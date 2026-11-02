import {
  type PublicRaffleResponse,
  type PublicTicketsResponse,
  type ReserveResponse,
  reserveRequestSchema,
} from "@rifas/contracts";
import {
  getGame,
  getPublicRaffle,
  listPublicPrizes,
  listPublicTickets,
  reserveTickets,
} from "@rifas/core";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { verifyTurnstile } from "../infra/turnstile";
import { toHttpError } from "./errors";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/:orgSlug/:raffleSlug", async (c) => {
  const { orgSlug, raffleSlug } = c.req.param();
  const result = await getPublicRaffle(c.get("deps"), { orgSlug, raffleSlug });
  if (!result.ok) {
    const { status, body } = toHttpError(result.error);
    return c.json(body, status);
  }
  const { organization, raffle } = result.value;
  const prizes = await listPublicPrizes(c.get("deps"), raffle.id);
  const body: PublicRaffleResponse = {
    organization: {
      name: organization.name,
      slug: organization.slug,
      whatsappPhone: organization.whatsappPhone,
    },
    raffle: {
      slug: raffle.slug,
      title: raffle.title,
      description: raffle.description,
      totalNumbers: raffle.totalNumbers,
      numberWidth: raffle.numberWidth,
      ticketPrice: raffle.ticketPrice,
      drawDate: raffle.drawDate,
      status: raffle.status === "cerrada" ? "cerrada" : "activa",
    },
    prizes: prizes.map((p) => ({
      place: p.place,
      description: p.description,
      lotteryName: getGame(p.lotteryId)?.name ?? p.lotteryId,
      drawDate: p.drawDate,
      status: p.status,
      resultNumber: p.resultNumber,
      winningNumbers: p.winningNumbers,
    })),
    turnstileSiteKey:
      c.env.REQUIRE_TURNSTILE === "true" && c.env.TURNSTILE_SITE_KEY
        ? c.env.TURNSTILE_SITE_KEY
        : null,
  };
  return c.json(body);
});

publicRoutes.get("/:orgSlug/:raffleSlug/tickets", async (c) => {
  const { orgSlug, raffleSlug } = c.req.param();
  const result = await listPublicTickets(c.get("deps"), { orgSlug, raffleSlug });
  if (!result.ok) {
    const { status, body } = toHttpError(result.error);
    return c.json(body, status);
  }
  c.header("Cache-Control", "no-store");
  const body: PublicTicketsResponse = { tickets: result.value };
  return c.json(body);
});

const clientIp = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header("CF-Connecting-IP") ?? "unknown";

publicRoutes.post("/:orgSlug/:raffleSlug/reservations", async (c) => {
  const { orgSlug, raffleSlug } = c.req.param();
  const ip = clientIp(c);
  c.header("Cache-Control", "no-store");

  // 1) Límite de tasa por IP (barato, antes de cualquier otra cosa).
  if (c.env.RESERVE_LIMITER) {
    const { success } = await c.env.RESERVE_LIMITER.limit({ key: ip });
    if (!success) {
      c.header("Retry-After", "60");
      return c.json(
        { error: { code: "rate_limited", message: "Demasiadas solicitudes. Espera un momento" } },
        429,
      );
    }
  }

  const payload = await c.req.json().catch(() => null);
  const parsed = reserveRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      { error: { code: "invalid_input", message: "Elige al menos un número válido" } },
      400,
    );
  }

  // 2) Turnstile. Falla cerrado: si está exigido y no hay secreto configurado, no se aparta nada.
  if (c.env.REQUIRE_TURNSTILE === "true") {
    if (!c.env.TURNSTILE_SECRET) {
      console.error(
        JSON.stringify({ level: "error", message: "Turnstile exigido sin TURNSTILE_SECRET" }),
      );
      return c.json(
        {
          error: {
            code: "captcha_unavailable",
            message: "Verificación no disponible. Inténtalo más tarde",
          },
        },
        503,
      );
    }
    if (!parsed.data.turnstileToken) {
      return c.json(
        {
          error: {
            code: "captcha_required",
            message: "Confirma que no eres un robot e inténtalo de nuevo",
          },
        },
        400,
      );
    }
    let human = false;
    try {
      human = await verifyTurnstile({
        secret: c.env.TURNSTILE_SECRET,
        token: parsed.data.turnstileToken,
        ip: ip === "unknown" ? undefined : ip,
        ...(c.get("turnstileFetch") ? { fetchFn: c.get("turnstileFetch") as typeof fetch } : {}),
      });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: (error as Error).message }));
      return c.json(
        {
          error: {
            code: "captcha_unavailable",
            message: "Verificación no disponible. Inténtalo más tarde",
          },
        },
        503,
      );
    }
    if (!human) {
      return c.json(
        {
          error: {
            code: "captcha_failed",
            message: "No pudimos verificar que eres una persona. Inténtalo de nuevo",
          },
        },
        403,
      );
    }
  }

  // 3) Reserva atómica.
  const result = await reserveTickets(c.get("deps"), {
    orgSlug,
    raffleSlug,
    clientId: ip,
    numbers: parsed.data.numbers,
  });
  if (!result.ok) {
    const { status, body } = toHttpError(result.error);
    return c.json(body, status);
  }
  const body: ReserveResponse = result.value;
  return c.json(body, 201);
});
