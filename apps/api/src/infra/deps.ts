import type { Deps } from "@rifas/core";
import {
  cryptoCodes,
  cryptoIds,
  D1AuthRepository,
  D1OrganizationRepository,
  D1RaffleRepository,
  D1TicketRepository,
  systemClock,
} from "./d1";

/** Compone las dependencias reales; las pruebas pueden sobrescribir reloj, ids o códigos. */
export function createDeps(db: D1Database, overrides: Partial<Deps> = {}): Deps {
  return {
    auth: new D1AuthRepository(db),
    orgs: new D1OrganizationRepository(db),
    raffles: new D1RaffleRepository(db),
    tickets: new D1TicketRepository(db),
    clock: systemClock,
    ids: cryptoIds,
    codes: cryptoCodes,
    ...overrides,
  };
}
