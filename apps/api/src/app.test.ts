import { healthResponseSchema } from "@rifas/contracts";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("API", () => {
  it("GET /api/v1/health responde ok y cumple el contrato", async () => {
    const res = await createApp().request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(healthResponseSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("rutas inexistentes devuelven el formato de error uniforme", async () => {
    const res = await createApp().request("/api/v1/nada");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Recurso no encontrado" },
    });
  });
});
