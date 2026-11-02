import { type HealthResponse, healthResponseSchema } from "@rifas/contracts";
import type { Deps } from "@rifas/core";
import { Hono } from "hono";
import { publicRoutes } from "./http/public";
import { createDeps } from "./infra/deps";

export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: Deps };
};

export interface AppOptions {
  /** Solo pruebas: sustituye reloj, ids o códigos. */
  overrides?: Partial<Deps>;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    c.set("deps", createDeps(c.env.DB, options.overrides));
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

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Recurso no encontrado" } }, 404),
  );

  app.onError((error, c) => {
    console.error(JSON.stringify({ level: "error", message: error.message, path: c.req.path }));
    return c.json({ error: { code: "internal_error", message: "Error interno" } }, 500);
  });

  return app;
}
