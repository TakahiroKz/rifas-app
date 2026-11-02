import { env } from "cloudflare:test";
import { createOrganization, createRaffle, type Deps } from "@rifas/core";
import { createDeps } from "../src/infra/deps";

export class TestClock {
  constructor(public current = new Date("2026-11-02T15:00:00.000Z")) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export function makeDeps(clock = new TestClock()): { deps: Deps; clock: TestClock } {
  return { deps: createDeps(env.DB, { clock }), clock };
}

export async function seedRaffle(
  deps: Deps,
  opts: {
    orgSlug?: string;
    raffleSlug?: string;
    total?: number;
    status?: "activa" | "borrador";
  } = {},
) {
  const org = await createOrganization(deps, {
    name: "Capital Finaura",
    slug: opts.orgSlug ?? "finaura",
    whatsappPhone: "573045235606",
  });
  if (!org.ok) throw new Error(org.error.message);
  const raffle = await createRaffle(deps, {
    orgId: org.value.id,
    slug: opts.raffleSlug ?? "navidad",
    title: "Rifa de Navidad",
    totalNumbers: opts.total ?? 100,
    ticketPrice: 10000,
    status: opts.status ?? "activa",
  });
  if (!raffle.ok) throw new Error(raffle.error.message);
  return { org: org.value, raffle: raffle.value };
}

// ───────────── Administración por HTTP ─────────────

import { hashPassword } from "@rifas/core";
import { createApp } from "../src/app";

export async function seedUser(opts: {
  orgId: string;
  email: string;
  password: string;
  name?: string;
}) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(
      id,
      opts.email,
      await hashPassword(opts.password),
      opts.name ?? "Admin",
      "2026-11-02T00:00:00.000Z",
    ),
    env.DB.prepare("INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, 'owner')").bind(
      id,
      opts.orgId,
    ),
  ]);
  return id;
}

export interface Client {
  app: ReturnType<typeof createApp>;
  cookie: string;
  csrf: string;
  call(
    method: string,
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<Response>;
}

/** Inicia sesión por HTTP y devuelve un cliente con cookie y token CSRF. */
export async function loginClient(
  app: ReturnType<typeof createApp>,
  email: string,
  password: string,
): Promise<Client> {
  const res = await app.request(
    "/api/v1/admin/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    env,
  );
  if (res.status !== 200) throw new Error(`login ${res.status}: ${await res.text()}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  const client: Client = {
    app,
    cookie,
    csrf: csrfToken,
    call: async (method, path, body, extra = {}) =>
      await app.request(
        `/api/v1/admin${path}`,
        {
          method,
          headers: {
            cookie,
            "content-type": "application/json",
            ...(method === "GET" ? {} : { "x-csrf-token": csrfToken }),
            ...extra,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
        env,
      ),
  };
  return client;
}
