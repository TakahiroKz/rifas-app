import { expireReservations, LOGIN_WINDOW_MS } from "@rifas/core";
import { createApp, type Env } from "./app";
import { createDeps } from "./infra/deps";

const app = createApp();

export default {
  fetch: app.fetch,

  // Cron Triggers (cada 10 min): persiste la caducidad de apartados y limpia sesiones/intentos viejos.
  // La corrección no depende de esta tarea: las consultas ya ignoran los vencidos.
  // Fases 4 y 5 agregan aquí la captura de resultados y el respaldo.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const deps = createDeps(env.DB);
    const now = deps.clock.now();
    ctx.waitUntil(
      Promise.all([
        expireReservations(deps),
        deps.auth.deleteExpired(
          now.toISOString(),
          new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString(),
        ),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
