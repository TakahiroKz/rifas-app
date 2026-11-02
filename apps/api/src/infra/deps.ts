import type { Deps } from "@rifas/core";
import { GaneSource } from "@rifas/lottery-sources";
import {
  cryptoCodes,
  cryptoIds,
  D1AuthRepository,
  D1DrawResultRepository,
  D1OrganizationRepository,
  D1PrizeRepository,
  D1RaffleRepository,
  D1TicketRepository,
  systemClock,
} from "./d1";

export interface DepsEnv {
  DB: D1Database;
  /** "true" activa la consulta automática a Gane (requiere su autorización). */
  LOTTERY_SYNC_ENABLED?: string | undefined;
}

/** Compone las dependencias reales; las pruebas pueden sobrescribir reloj, ids, códigos o la fuente. */
export function createDeps(env: DepsEnv, overrides: Partial<Deps> = {}): Deps {
  const db = env.DB;
  return {
    auth: new D1AuthRepository(db),
    prizes: new D1PrizeRepository(db),
    results: new D1DrawResultRepository(db),
    source: new GaneSource(env.LOTTERY_SYNC_ENABLED === "true"),
    orgs: new D1OrganizationRepository(db),
    raffles: new D1RaffleRepository(db),
    tickets: new D1TicketRepository(db),
    clock: systemClock,
    ids: cryptoIds,
    codes: cryptoCodes,
    ...overrides,
  };
}
