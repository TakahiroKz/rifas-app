import { z } from "zod";

/** Respuesta de GET /api/v1/health, compartida entre API y web. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("rifas-api"),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
