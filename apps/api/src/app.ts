import { type HealthResponse, healthResponseSchema } from "@rifas/contracts";
import { Hono } from "hono";

export type Env = {
  ASSETS: Fetcher;
};

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/v1/health", (c) => {
    const body: HealthResponse = healthResponseSchema.parse({
      status: "ok",
      service: "rifas-api",
      time: new Date().toISOString(),
    });
    return c.json(body);
  });

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Recurso no encontrado" } }, 404),
  );

  return app;
}
