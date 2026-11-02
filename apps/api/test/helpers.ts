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
