import { createApp, type Env } from "./app";

const app = createApp();

export default {
  fetch: app.fetch,

  // Cron Triggers: expirar apartados, traer resultados, respaldo (fases 1, 4 y 5).
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {},
} satisfies ExportedHandler<Env>;
