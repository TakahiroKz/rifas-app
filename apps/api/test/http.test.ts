import { env } from "cloudflare:test";
import {
  errorResponseSchema,
  publicRaffleResponseSchema,
  publicTicketsResponseSchema,
  reserveResponseSchema,
} from "@rifas/contracts";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { makeDeps, seedRaffle } from "./helpers";

const base = "/api/v1/public/finaura/navidad";
const post = (path: string, body: unknown, raw = false) =>
  createApp().request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    },
    env,
  );

describe("API pública", () => {
  it("GET rifa devuelve datos públicos y cumple el contrato", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps);
    const res = await createApp().request(base, {}, env);
    expect(res.status).toBe(200);
    const body = publicRaffleResponseSchema.parse(await res.json());
    expect(body.raffle).toMatchObject({
      slug: "navidad",
      totalNumbers: 100,
      numberWidth: 2,
      ticketPrice: 10000,
    });
    expect(body.organization.whatsappPhone).toBe("573045235606");
  });

  it("reservar → 201, luego aparece como apartado y no se puede repetir (409)", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps);
    const res = await post(`${base}/reservations`, { numbers: [7, 23] });
    expect(res.status).toBe(201);
    const reserved = reserveResponseSchema.parse(await res.json());
    expect(reserved.code).toMatch(/^RF-[A-Z2-9]{6}$/);

    const tickets = await createApp().request(`${base}/tickets`, {}, env);
    expect(tickets.headers.get("cache-control")).toBe("no-store");
    expect(publicTicketsResponseSchema.parse(await tickets.json()).tickets).toEqual([
      { number: 7, status: "apartado" },
      { number: 23, status: "apartado" },
    ]);

    const again = await post(`${base}/reservations`, { numbers: [8, 7] });
    expect(again.status).toBe(409);
    const err = errorResponseSchema.parse(await again.json());
    expect(err.error).toMatchObject({ code: "numbers_unavailable", details: { unavailable: [7] } });
  });

  it("no expone datos del comprador", async () => {
    const { deps } = makeDeps();
    const { org, raffle } = await seedRaffle(deps);
    const { markSold } = await import("@rifas/core");
    await markSold(deps, {
      orgId: org.id,
      raffleId: raffle.id,
      number: 5,
      payment: { status: "debe", dueDate: "2026-12-01" },
      buyer: { name: "Ana", phone: "3001112233" },
    });
    const text = await (await createApp().request(`${base}/tickets`, {}, env)).text();
    expect(JSON.parse(text)).toEqual({ tickets: [{ number: 5, status: "vendido" }] });
    expect(text).not.toMatch(/Ana|3001112233|debe|2026-12-01/);
  });

  it.each([
    ["sin cuerpo JSON", "no es json", true],
    ["lista vacía", { numbers: [] }, false],
    ["fuera de rango", { numbers: [100] }, false],
    ["texto", { numbers: ["7"] }, false],
    ["demasiados", { numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, false],
  ])("400 ante entrada inválida: %s", async (_n, body, raw) => {
    const { deps } = makeDeps();
    await seedRaffle(deps);
    const res = await post(`${base}/reservations`, body, raw as boolean);
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("invalid_input");
  });

  it("rifas inactivas o inexistentes responden 404 sin revelar su existencia", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps, { status: "borrador" });
    for (const url of [
      base,
      `${base}/tickets`,
      "/api/v1/public/finaura/otra",
      "/api/v1/public/nadie/navidad",
    ]) {
      const res = await createApp().request(url, {}, env);
      expect(res.status).toBe(404);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("not_found");
    }
    expect((await post(`${base}/reservations`, { numbers: [1] })).status).toBe(404);
  });

  it("la misma reserva concurrente por HTTP: una sola respuesta 201", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps);
    const responses = await Promise.all(
      Array.from({ length: 15 }, () => post(`${base}/reservations`, { numbers: [1, 2, 3] })),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(14);
  });
});
