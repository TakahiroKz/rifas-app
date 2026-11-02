import { env } from "cloudflare:test";
import { RESERVATION_TTL_MS } from "@rifas/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { makeDeps, seedRaffle, TestClock } from "./helpers";

const base = "/api/v1/public/finaura/navidad";

type TestEnv = typeof env;
const withEnv = (extra: Record<string, unknown>) => ({ ...env, ...extra }) as unknown as TestEnv;

function reserve(
  app: ReturnType<typeof createApp>,
  numbers: number[],
  opts: { ip?: string; token?: string; env?: TestEnv } = {},
) {
  return Promise.resolve(
    app.request(
      `${base}/reservations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.ip ? { "cf-connecting-ip": opts.ip } : {}),
        },
        body: JSON.stringify({ numbers, ...(opts.token ? { turnstileToken: opts.token } : {}) }),
      },
      opts.env ?? env,
    ),
  );
}

const range = (from: number, n = 10) => Array.from({ length: n }, (_, i) => from + i);

describe("límite de apartados por cliente (HTTP)", () => {
  it("el cliente 4 → 429 y no se aparta nada; otra IP no se ve afectada", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps, { total: 200 });
    const app = createApp();
    for (const from of [0, 10, 20])
      expect((await reserve(app, range(from), { ip: "10.0.0.1" })).status).toBe(201);

    const over = await reserve(app, [100], { ip: "10.0.0.1" });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({
      error: { code: "too_many_reservations", details: { max: 30 } },
    });
    const tickets = (await (await app.request(`${base}/tickets`, {}, env)).json()) as {
      tickets: { number: number }[];
    };
    expect(tickets.tickets).toHaveLength(30);

    expect((await reserve(app, [100], { ip: "10.0.0.2" })).status).toBe(201);
  });

  it("al vencer los apartados se libera el cupo", async () => {
    const clock = new TestClock();
    const { deps } = makeDeps(clock);
    await seedRaffle(deps, { total: 200 });
    const app = createApp({ overrides: { clock } });
    for (const from of [0, 10, 20]) await reserve(app, range(from), { ip: "10.0.0.1" });
    expect((await reserve(app, [100], { ip: "10.0.0.1" })).status).toBe(429);
    clock.advance(RESERVATION_TTL_MS);
    expect((await reserve(app, [100], { ip: "10.0.0.1" })).status).toBe(201);
  });

  it("solo se guarda un hash del cliente, nunca su IP", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps);
    await reserve(createApp(), [1], { ip: "203.0.113.7" });
    const { results } = await env.DB.prepare("SELECT reserved_by FROM tickets").all<{
      reserved_by: string;
    }>();
    expect(results[0]?.reserved_by).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(results)).not.toContain("203.0.113.7");
  });
});

describe("Turnstile", () => {
  const required = {
    REQUIRE_TURNSTILE: "true",
    TURNSTILE_SECRET: "secreto",
    TURNSTILE_SITE_KEY: "clave-publica",
  };

  async function setup() {
    const { deps } = makeDeps();
    await seedRaffle(deps);
  }
  const verifyOk = () => vi.fn(async () => Response.json({ success: true }));

  it("exigido y sin token → 400 captcha_required", async () => {
    await setup();
    const fetchFn = verifyOk();
    const app = createApp({ turnstileFetch: fetchFn as unknown as typeof fetch });
    const res = await reserve(app, [1], { env: withEnv(required) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "captcha_required" } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("token válido → 201 y se consulta a Cloudflare con el secreto, el token y la IP", async () => {
    await setup();
    const fetchFn = verifyOk();
    const app = createApp({ turnstileFetch: fetchFn as unknown as typeof fetch });
    const res = await reserve(app, [1], {
      token: "token-bueno",
      ip: "198.51.100.4",
      env: withEnv(required),
    });
    expect(res.status).toBe(201);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { body: FormData }];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.body.get("secret")).toBe("secreto");
    expect(init.body.get("response")).toBe("token-bueno");
    expect(init.body.get("remoteip")).toBe("198.51.100.4");
  });

  it("token inválido → 403 captcha_failed y no se aparta nada", async () => {
    await setup();
    const app = createApp({
      turnstileFetch: (async () => Response.json({ success: false })) as unknown as typeof fetch,
    });
    const res = await reserve(app, [1], { token: "malo", env: withEnv(required) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "captcha_failed" } });
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets").all<{
      n: number;
    }>();
    expect(results[0]?.n).toBe(0);
  });

  it("si Cloudflare no responde → 503 (falla cerrado, no deja pasar)", async () => {
    await setup();
    const down = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    const boom = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    for (const turnstileFetch of [down, boom]) {
      const res = await reserve(createApp({ turnstileFetch }), [1], {
        token: "t",
        env: withEnv(required),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: { code: "captcha_unavailable" } });
    }
  });

  it("exigido pero sin secreto configurado → 503 (no se aparta nada)", async () => {
    await setup();
    const res = await reserve(createApp(), [1], {
      token: "t",
      env: withEnv({ REQUIRE_TURNSTILE: "true", TURNSTILE_SECRET: undefined }),
    });
    expect(res.status).toBe(503);
  });

  it("la clave pública solo se entrega cuando Turnstile está activo", async () => {
    await setup();
    const on = (await (await createApp().request(base, {}, withEnv(required))).json()) as {
      turnstileSiteKey: string | null;
    };
    expect(on.turnstileSiteKey).toBe("clave-publica");
    expect(JSON.stringify(on)).not.toContain("secreto");
    const off = (await (await createApp().request(base, {}, env)).json()) as {
      turnstileSiteKey: string | null;
    };
    expect(off.turnstileSiteKey).toBeNull();
  });
});

describe("límite de tasa por IP", () => {
  it("si el limitador dice que no → 429 con Retry-After y sin tocar la base", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps);
    const limit = vi.fn(async () => ({ success: false }));
    const res = await reserve(createApp(), [1], {
      ip: "192.0.2.9",
      env: withEnv({ RESERVE_LIMITER: { limit } }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(limit).toHaveBeenCalledWith({ key: "192.0.2.9" });
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets").all<{
      n: number;
    }>();
    expect(results[0]?.n).toBe(0);
  });

  it("si el limitador lo permite, sigue el flujo normal", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps);
    const limit = vi.fn(async () => ({ success: true }));
    const res = await reserve(createApp(), [1], { env: withEnv({ RESERVE_LIMITER: { limit } }) });
    expect(res.status).toBe(201);
  });
});

describe("encabezados de seguridad", () => {
  it("están presentes en respuestas correctas y de error", async () => {
    const app = createApp();
    for (const path of ["/api/v1/health", "/api/v1/no-existe"]) {
      const res = await app.request(path, {}, env);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
  });
});
