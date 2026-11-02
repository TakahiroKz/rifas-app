import { expireReservations, LOGIN_WINDOW_MS, syncOfficialResults } from "@rifas/core";
import { createApp, type Env } from "./app";
import { createDeps } from "./infra/deps";

const app = createApp();

export default {
  fetch: app.fetch,

  // Cron Triggers (cada 10 min): caducidad de apartados, resultados oficiales pendientes y limpieza de sesiones.
  // La corrección no depende de esta tarea: las consultas ya ignoran los vencidos.
  // La Fase 5 agregará aquí el respaldo diario.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const deps = createDeps(env);
    const now = deps.clock.now();
    ctx.waitUntil(
      Promise.all([
        expireReservations(deps),
        syncOfficialResults(deps),
        deps.auth.deleteExpired(
          now.toISOString(),
          new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString(),
        ),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
