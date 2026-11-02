import type {
  Buyer,
  Organization,
  Payment,
  PaymentStatus,
  PublicTicket,
  Raffle,
  RaffleStatus,
  TicketEvent,
  TicketRecord,
} from "./types";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface CodeGenerator {
  reservationCode(): string;
}

export interface OrganizationRepository {
  create(org: Organization): Promise<{ ok: true } | { ok: false; reason: "slug_taken" }>;
  findBySlug(slug: string): Promise<Organization | null>;
}

export interface RaffleRepository {
  create(raffle: Raffle): Promise<{ ok: true } | { ok: false; reason: "slug_taken" }>;
  /** Siempre acotado por organización. */
  findById(orgId: string, raffleId: string): Promise<Raffle | null>;
  /** Para la zona pública: organización + rifa por sus slugs. */
  findPublic(
    orgSlug: string,
    raffleSlug: string,
  ): Promise<{ organization: Organization; raffle: Raffle } | null>;
  setStatus(orgId: string, raffleId: string, status: RaffleStatus): Promise<boolean>;
}

export interface ReserveInput {
  orgId: string;
  raffleId: string;
  numbers: number[];
  code: string;
  /** ISO UTC */
  now: string;
  /** ISO UTC */
  until: string;
}

export interface MarkSoldInput {
  orgId: string;
  raffleId: string;
  number: number;
  payment: Payment;
  buyer: Buyer;
  now: string;
}

export interface TicketRepository {
  /** Todo o nada: reserva todos los números o ninguno. */
  reserve(input: ReserveInput): Promise<{ ok: true } | { ok: false; unavailable: number[] }>;
  markSold(input: MarkSoldInput): Promise<void>;
  /** false si el número no está vendido. */
  updatePayment(input: {
    orgId: string;
    raffleId: string;
    number: number;
    payment: Payment;
    now: string;
  }): Promise<boolean>;
  /** Devuelve el número a `activo`. false si no tenía fila. */
  release(input: {
    orgId: string;
    raffleId: string;
    number: number;
    now: string;
  }): Promise<boolean>;
  /** Persiste la caducidad de apartados vencidos (todas las organizaciones). Devuelve cuántos. */
  expireDue(now: string): Promise<number>;
  /** Números no activos y vigentes (los apartados vencidos no cuentan). */
  listPublic(raffleId: string, now: string): Promise<PublicTicket[]>;
  listAdmin(
    orgId: string,
    raffleId: string,
    filter: { status?: "apartado" | "vendido"; paymentStatus?: PaymentStatus },
  ): Promise<TicketRecord[]>;
  listEvents(
    orgId: string,
    raffleId: string,
    options: { number?: number; limit: number; beforeId?: number },
  ): Promise<TicketEvent[]>;
}
