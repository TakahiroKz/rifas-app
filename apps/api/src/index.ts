import { expireReservations, LOGIN_WINDOW_MS, syncOfficialResults } from "@rifas/core";
import { createApp, type Env } from "./app";
import { createDeps } from "./infra/deps";
import { BACKUP_CRON, runBackup } from "./jobs/backup";

const app = createApp();

export default {
  fetch: app.fetch,

  // Cron Triggers (cada 10 min): caducidad de apartados, resultados oficiales pendientes y limpieza de sesiones.
  // La corrección no depende de esta tarea: las consultas ya ignoran los vencidos.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Cron diario: respaldo a R2.
    if (controller.cron === BACKUP_CRON) {
      ctx.waitUntil(
        runBackup(env.DB, env.BACKUPS, new Date())
          .then((s) => console.log(JSON.stringify({ level: "info", message: "respaldo", ...s })))
          .catch((e: Error) =>
            console.error(
              JSON.stringify({ level: "error", message: "respaldo falló", error: e.message }),
            ),
          ),
      );
      return;
    }

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
