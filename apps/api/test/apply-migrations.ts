import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

// Migraciones: una vez por archivo de pruebas (idempotente).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Base limpia antes de cada prueba (orden respetando claves foráneas).
beforeEach(async () => {
  await env.DB.batch(
    ["ticket_events", "tickets", "raffles", "memberships", "organizations", "users"].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});
