import { expireReservations } from "@rifas/core";
import { createApp, type Env } from "./app";
import { createDeps } from "./infra/deps";

const app = createApp();

export default {
  fetch: app.fetch,

  // Cron Triggers (cada 10 min): persiste la caducidad de apartados vencidos.
  // La corrección no depende de esta tarea: las consultas ya ignoran los vencidos.
  // Fases 4 y 5 agregan aquí la captura de resultados y el respaldo.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(expireReservations(createDeps(env.DB)));
  },
} satisfies ExportedHandler<Env>;
