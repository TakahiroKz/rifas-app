import { type HealthResponse, healthResponseSchema } from "@rifas/contracts";
import type { Deps } from "@rifas/core";
import { Hono } from "hono";
import { adminRoutes } from "./http/admin";
import { publicRoutes } from "./http/public";
import { securityHeaders } from "./http/security";
import { serveRafflePage } from "./http/share";
import { createDeps } from "./infra/deps";

export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  /** "true" exige Turnstile al apartar. Falla cerrado: sin TURNSTILE_SECRET responde 503. */
  REQUIRE_TURNSTILE?: string;
  TURNSTILE_SECRET?: string;
  /** Clave pública (no secreta) del widget de Turnstile. */
  TURNSTILE_SITE_KEY?: string;
  /** Límite de tasa de Cloudflare por IP (opcional). */
  RESERVE_LIMITER?: RateLimit;
  /** "true" activa la consulta automática de resultados a Gane. Requiere su autorización por escrito. */
  LOTTERY_SYNC_ENABLED?: string;
  /** Bucket R2 de respaldos (opcional hasta que R2 esté habilitado). */
  BACKUPS?: R2Bucket;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: Deps; turnstileFetch: typeof fetch | undefined };
};

export interface AppOptions {
  /** Solo pruebas: sustituye reloj, ids o códigos. */
  overrides?: Partial<Deps>;
  /** Solo pruebas: sustituye el `fetch` usado para verificar Turnstile. */
  turnstileFetch?: typeof fetch;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", securityHeaders);

  // Páginas públicas de la rifa: el Worker añade la vista previa del enlace (título y descripción).
  app.use("/r/*", async (c, next) => {
    c.set("deps", createDeps(c.env, options.overrides));
    await next();
  });
  app.get("/r/:org/:raffle", serveRafflePage);
  app.get("/r/:org/:raffle/privacidad", serveRafflePage);

  app.use("/api/*", async (c, next) => {
    c.set("deps", createDeps(c.env, options.overrides));
    c.set("turnstileFetch", options.turnstileFetch);
    await next();
  });

  app.get("/api/v1/health", (c) => {
    const body: HealthResponse = healthResponseSchema.parse({
      status: "ok",
      service: "rifas-api",
      time: new Date().toISOString(),
    });
    return c.json(body);
  });

  app.route("/api/v1/public", publicRoutes);
  app.route("/api/v1/admin", adminRoutes);

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Recurso no encontrado" } }, 404),
  );

  app.onError((error, c) => {
    console.error(JSON.stringify({ level: "error", message: error.message, path: c.req.path }));
    return c.json({ error: { code: "internal_error", message: "Error interno" } }, 500);
  });

  return app;
}
