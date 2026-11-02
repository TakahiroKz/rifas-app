import {
  type PublicRaffleResponse,
  type PublicTicketsResponse,
  type ReserveResponse,
  reserveRequestSchema,
} from "@rifas/contracts";
import { getPublicRaffle, listPublicTickets, reserveTickets } from "@rifas/core";
import { Hono } from "hono";
import type { AppEnv } from "../app";
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
    },
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

publicRoutes.post("/:orgSlug/:raffleSlug/reservations", async (c) => {
  const { orgSlug, raffleSlug } = c.req.param();
  const payload = await c.req.json().catch(() => null);
  const parsed = reserveRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      { error: { code: "invalid_input", message: "Elige al menos un número válido" } },
      400,
    );
  }
  const result = await reserveTickets(c.get("deps"), {
    orgSlug,
    raffleSlug,
    numbers: parsed.data.numbers,
  });
  if (!result.ok) {
    const { status, body } = toHttpError(result.error);
    return c.json(body, status);
  }
  c.header("Cache-Control", "no-store");
  const body: ReserveResponse = result.value;
  return c.json(body, 201);
});
