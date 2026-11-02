import { env } from "cloudflare:test";
import {
  adminRaffleSchema,
  adminTicketsResponseSchema,
  errorResponseSchema,
  historyResponseSchema,
  reservationLookupSchema,
  sessionResponseSchema,
} from "@rifas/contracts";
import { SESSION_TTL_MS } from "@rifas/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loginClient, makeDeps, seedRaffle, seedUser, TestClock } from "./helpers";

const PASSWORD = "clave-segura-123";

async function setup() {
  const clock = new TestClock();
  const { deps } = makeDeps(clock);
  const { org, raffle } = await seedRaffle(deps);
  await seedUser({ orgId: org.id, email: "leo@example.com", password: PASSWORD, name: "Leo" });
  const app = createApp({ overrides: { clock } });
  return { clock, deps, org, raffle, app };
}

const login = (app: ReturnType<typeof createApp>, email: string, password: string) =>
  app.request(
    "/api/v1/admin/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    env,
  );

describe("sesión", () => {
  it("login correcto: cookie HttpOnly + SameSite=Strict, y el token no se guarda en claro", async () => {
    const { app } = await setup();
    const res = await login(app, "Leo@Example.com", PASSWORD);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/rifas_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const body = sessionResponseSchema.parse(await res.json());
    expect(body.user).toEqual({ name: "Leo", email: "leo@example.com" });
    expect(body.organization.slug).toBe("finaura");

    const token = cookie.split(";")[0]?.split("=")[1] ?? "";
    const { results } = await env.DB.prepare("SELECT id FROM sessions").all<{ id: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.id).not.toBe(token);
    expect(results[0]?.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("credenciales inválidas → 401 igual para correo inexistente y clave mala", async () => {
    const { app } = await setup();
    const a = await login(app, "leo@example.com", "mala");
    const b = await login(app, "nadie@example.com", "mala");
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    expect(a.headers.get("set-cookie")).toBeNull();
    expect((await login(app, "", "")).status).toBe(400);
  });

  it("bloquea con 429 tras 5 intentos fallidos aunque luego la clave sea correcta", async () => {
    const { app } = await setup();
    for (let i = 0; i < 5; i++) await login(app, "leo@example.com", "mala");
    const res = await login(app, "leo@example.com", PASSWORD);
    expect(res.status).toBe(429);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("too_many_attempts");
  });

  it("sin cookie → 401; /session con cookie → 200; logout invalida la sesión", async () => {
    const { app } = await setup();
    expect((await app.request("/api/v1/admin/session", {}, env)).status).toBe(401);
    expect((await app.request("/api/v1/admin/raffles", {}, env)).status).toBe(401);
    const client = await loginClient(app, "leo@example.com", PASSWORD);
    expect((await client.call("GET", "/session")).status).toBe(200);
    const out = await client.call("POST", "/logout");
    expect(out.status).toBe(204);
    expect((await client.call("GET", "/session")).status).toBe(401);
  });

  it("la sesión caduca a los 7 días", async () => {
    const { app, clock } = await setup();
    const client = await loginClient(app, "leo@example.com", PASSWORD);
    clock.advance(SESSION_TTL_MS - 1000);
    expect((await client.call("GET", "/session")).status).toBe(200);
    clock.advance(2000);
    expect((await client.call("GET", "/session")).status).toBe(401);
  });
});

describe("CSRF y origen", () => {
  it("las peticiones que modifican datos exigen X-CSRF-Token", async () => {
    const { app, raffle } = await setup();
    const client = await loginClient(app, "leo@example.com", PASSWORD);
    const url = `/api/v1/admin/raffles/${raffle.id}`;
    const patch = (headers: Record<string, string>) =>
      app.request(
        url,
        {
          method: "PATCH",
          headers: { cookie: client.cookie, "content-type": "application/json", ...headers },
          body: JSON.stringify({ title: "Nuevo título" }),
        },
        env,
      );
    expect((await patch({})).status).toBe(403);
    expect((await patch({ "x-csrf-token": "otro" })).status).toBe(403);
    expect(
      (await patch({ "x-csrf-token": client.csrf, origin: "https://malo.example" })).status,
    ).toBe(403);
    expect((await patch({ "x-csrf-token": client.csrf, origin: "http://localhost" })).status).toBe(
      200,
    );
  });

  it("el login rechaza un Origin ajeno", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/v1/admin/login",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://malo.example" },
        body: JSON.stringify({ email: "leo@example.com", password: PASSWORD }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe("flujo de administración", () => {
  it("crear rifa → apartar (público) → vender por código con deuda → cobrar → liberar → historial", async () => {
    const { app } = await setup();
    const c = await loginClient(app, "leo@example.com", PASSWORD);

    const created = await c.call("POST", "/raffles", {
      slug: "pascua",
      title: "Rifa de Pascua",
      totalNumbers: 100,
      ticketPrice: 10000,
      status: "activa",
    });
    expect(created.status).toBe(201);
    const raffle = adminRaffleSchema.parse(await created.json());
    expect(raffle.numberWidth).toBe(2);
    const id = raffle.id;

    const list = await (await c.call("GET", "/raffles")).json();
    expect((list as { raffles: unknown[] }).raffles).toHaveLength(2);

    // El cliente aparta por la zona pública
    const reserve = await app.request(
      "/api/v1/public/finaura/pascua/reservations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ numbers: [7, 23] }),
      },
      env,
    );
    const { code } = (await reserve.json()) as { code: string };

    const lookup = reservationLookupSchema.parse(
      await (await c.call("GET", `/raffles/${id}/reservations/${code.toLowerCase()}`)).json(),
    );
    expect(lookup.numbers).toEqual([7, 23]);

    const sale = await c.call("POST", `/raffles/${id}/reservations/${code}/sale`, {
      payment: { status: "debe", dueDate: "2026-12-20" },
      buyer: { name: "Ana", phone: "3001112233" },
    });
    expect(sale.status).toBe(200);

    const debts = adminTicketsResponseSchema.parse(
      await (await c.call("GET", `/raffles/${id}/debts`)).json(),
    );
    expect(debts.tickets.map((t) => [t.number, t.dueDate, t.buyerName])).toEqual([
      [7, "2026-12-20", "Ana"],
      [23, "2026-12-20", "Ana"],
    ]);
    const stats = adminRaffleSchema.parse(
      await (await c.call("GET", `/raffles/${id}`)).json(),
    ).stats;
    expect(stats).toMatchObject({ sold: 2, owed: 2, owedAmount: 20000, paid: 0 });

    expect(
      (await c.call("PATCH", `/raffles/${id}/tickets/7/payment`, { payment: { status: "pagado" } }))
        .status,
    ).toBe(204);
    expect(
      (await c.call("PUT", `/raffles/${id}/tickets/50/sale`, { payment: { status: "pagado" } }))
        .status,
    ).toBe(204);
    expect((await c.call("DELETE", `/raffles/${id}/tickets/23`)).status).toBe(204);
    expect((await c.call("DELETE", `/raffles/${id}/tickets/23`)).status).toBe(409);

    const tickets = adminTicketsResponseSchema.parse(
      await (await c.call("GET", `/raffles/${id}/tickets?status=vendido`)).json(),
    );
    expect(tickets.tickets.map((t) => [t.number, t.paymentStatus])).toEqual([
      [7, "pagado"],
      [50, "pagado"],
    ]);

    const hist = historyResponseSchema.parse(
      await (await c.call("GET", `/raffles/${id}/history?number=23`)).json(),
    );
    expect(hist.events.map((e) => e.action)).toEqual(["release", "sell", "reserve"]);
  });

  it("editar la rifa y el teléfono de WhatsApp se refleja en la zona pública", async () => {
    const { app, raffle } = await setup();
    const c = await loginClient(app, "leo@example.com", PASSWORD);
    const patched = await c.call("PATCH", `/raffles/${raffle.id}`, {
      title: "Rifa Navideña",
      ticketPrice: 12000,
      drawDate: "2026-12-24",
      status: "cerrada",
    });
    expect(adminRaffleSchema.parse(await patched.json())).toMatchObject({
      title: "Rifa Navideña",
      status: "cerrada",
    });
    expect((await c.call("PATCH", "/organization", { whatsappPhone: "573001112233" })).status).toBe(
      200,
    );
    // cerrada: sigue visible en solo lectura (para ver ganadores), pero ya no se puede apartar
    const closed = (await (
      await app.request("/api/v1/public/finaura/navidad", {}, env)
    ).json()) as {
      raffle: { status: string };
    };
    expect(closed.raffle.status).toBe("cerrada");
    const blocked = await app.request(
      "/api/v1/public/finaura/navidad/reservations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ numbers: [1] }),
      },
      env,
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: "raffle_closed" } });
    await c.call("PATCH", `/raffles/${raffle.id}`, { status: "activa" });
    const pub2 = (await (await app.request("/api/v1/public/finaura/navidad", {}, env)).json()) as {
      organization: { whatsappPhone: string };
      raffle: { title: string };
    };
    expect(pub2.organization.whatsappPhone).toBe("573001112233");
    expect(pub2.raffle.title).toBe("Rifa Navideña");
  });

  it("valida entradas: 400 y 409", async () => {
    const { app, raffle } = await setup();
    const c = await loginClient(app, "leo@example.com", PASSWORD);
    expect(
      (await c.call("POST", "/raffles", { slug: "x", title: "Rifa", totalNumbers: 100 })).status,
    ).toBe(400);
    expect(
      (await c.call("POST", "/raffles", { slug: "otra-rifa", title: "Rifa", totalNumbers: 5 }))
        .status,
    ).toBe(400);
    expect(
      (await c.call("POST", "/raffles", { slug: "navidad", title: "Repetida", totalNumbers: 100 }))
        .status,
    ).toBe(409);
    expect((await c.call("POST", "/raffles", "no es objeto")).status).toBe(400);
    const id = raffle.id;
    expect(
      (await c.call("PUT", `/raffles/${id}/tickets/abc/sale`, { payment: { status: "pagado" } }))
        .status,
    ).toBe(400);
    expect(
      (await c.call("PUT", `/raffles/${id}/tickets/5/sale`, { payment: { status: "debe" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await c.call("PUT", `/raffles/${id}/tickets/5/sale`, {
          payment: { status: "debe", dueDate: "2026-02-30" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await c.call("PUT", `/raffles/${id}/tickets/100/sale`, { payment: { status: "pagado" } }))
        .status,
    ).toBe(400);
    expect((await c.call("GET", `/raffles/${id}/tickets?status=otro`)).status).toBe(400);
    expect((await c.call("GET", `/raffles/${id}/history?limit=x`)).status).toBe(400);
    expect((await c.call("PATCH", "/organization", { whatsappPhone: "+57300" })).status).toBe(400);
  });
});

describe("aislamiento entre organizaciones (HTTP)", () => {
  it("el administrador de B no ve ni modifica nada de A", async () => {
    const { deps, app, raffle: raffleA } = await setup();
    const b = await seedRaffle(deps, { orgSlug: "org-b", raffleSlug: "rifa-b" });
    await seedUser({ orgId: b.org.id, email: "b@example.com", password: PASSWORD });
    const clientB = await loginClient(app, "b@example.com", PASSWORD);
    const idA = raffleA.id;

    // Datos reales en A
    const clientA = await loginClient(app, "leo@example.com", PASSWORD);
    await clientA.call("PUT", `/raffles/${idA}/tickets/1/sale`, {
      payment: { status: "debe", dueDate: "2026-12-01" },
      buyer: { name: "Secreto" },
    });

    const list = (await (await clientB.call("GET", "/raffles")).json()) as {
      raffles: { id: string }[];
    };
    expect(list.raffles.map((r) => r.id)).toEqual([b.raffle.id]);

    const attempts: [string, string, unknown?][] = [
      ["GET", `/raffles/${idA}`],
      ["PATCH", `/raffles/${idA}`, { title: "Hackeada" }],
      ["GET", `/raffles/${idA}/tickets`],
      ["GET", `/raffles/${idA}/debts`],
      ["GET", `/raffles/${idA}/history`],
      ["PUT", `/raffles/${idA}/tickets/2/sale`, { payment: { status: "pagado" } }],
      ["PATCH", `/raffles/${idA}/tickets/1/payment`, { payment: { status: "pagado" } }],
      ["DELETE", `/raffles/${idA}/tickets/1`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await clientB.call(method, path, body);
      expect([method, path, res.status]).toEqual([method, path, 404]);
      expect(await res.text()).not.toMatch(/Secreto/);
    }

    // y A sigue intacto
    const a = adminRaffleSchema.parse(await (await clientA.call("GET", `/raffles/${idA}`)).json());
    expect(a.title).toBe("Rifa de Navidad");
    expect(a.stats.sold).toBe(1);
    expect(a.stats.paid).toBe(0);
  });
});
