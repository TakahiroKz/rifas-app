import type {
  Buyer,
  DrawResult,
  Organization,
  Payment,
  PaymentStatus,
  Prize,
  PrizeAttempt,
  PrizeStatus,
  PrizeWinner,
  PublicPrize,
  PublicTicket,
  Raffle,
  RaffleStatus,
  Session,
  TicketEvent,
  TicketRecord,
  User,
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
  findById(orgId: string): Promise<Organization | null>;
  update(orgId: string, patch: { name?: string; whatsappPhone?: string }): Promise<boolean>;
}

export interface UserWithHash extends User {
  passwordHash: string;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserWithHash | null>;
  /** Primera organización a la que pertenece el usuario. */
  findMembership(userId: string): Promise<{ orgId: string; role: "owner" | "admin" } | null>;
  createSession(session: Session): Promise<void>;
  findSession(id: string): Promise<(Session & { user: User }) | null>;
  deleteSession(id: string): Promise<void>;
  /** Limpieza de sesiones e intentos fallidos antiguos. */
  deleteExpired(now: string, attemptsBefore: string): Promise<void>;
  recordFailedLogin(email: string, ip: string, at: string): Promise<void>;
  countFailedLogins(input: {
    email: string;
    ip: string;
    since: string;
  }): Promise<{ byEmail: number; byIp: number }>;
  clearFailedLogins(email: string): Promise<void>;
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
  update(
    orgId: string,
    raffleId: string,
    patch: {
      title?: string;
      description?: string;
      ticketPrice?: number | null;
      drawDate?: string | null;
      status?: RaffleStatus;
    },
  ): Promise<boolean>;
  listByOrg(orgId: string): Promise<Raffle[]>;
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
  /** Huella (hash) del cliente que aparta. */
  clientKey: string;
  /** Tope de apartados vigentes de ese cliente en la rifa, contando estos. */
  maxActivePerClient: number;
}

export type ReserveOutcome =
  | { ok: true }
  | { ok: false; reason: "unavailable"; unavailable: number[] }
  | { ok: false; reason: "limit" };

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
  reserve(input: ReserveInput): Promise<ReserveOutcome>;
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
  /** Números de una reserva (apartados vigentes con ese código). */
  findReservation(
    orgId: string,
    raffleId: string,
    code: string,
    now: string,
  ): Promise<TicketRecord[]>;
  /** Conteos por rifa de la organización, para el tablero. `today` = AAAA-MM-DD en Colombia. */
  countByRaffle(
    orgId: string,
    now: string,
    today: string,
  ): Promise<
    Map<string, { reserved: number; sold: number; paid: number; owed: number; overdue: number }>
  >;
  /** Movimientos por día (hora de Colombia) desde `sinceDay`: apartados y ventas registrados. */
  activityByDay(
    orgId: string,
    raffleId: string,
    sinceDay: string,
  ): Promise<{ day: string; reserved: number; sold: number }[]>;
  listEvents(
    orgId: string,
    raffleId: string,
    options: { number?: number; limit: number; beforeId?: number },
  ): Promise<TicketEvent[]>;
}

// ───────────── Loterías y premios ─────────────

/** Resultado normalizado entregado por una fuente (p. ej. Gane). */
export interface SourceDraw {
  lotteryId: string;
  drawDate: string;
  number: string;
  series: string | null;
  sourceRef: string | null;
  raw: unknown;
}

export interface LotterySource {
  /** false = consulta automática desactivada (p. ej. a la espera de la autorización de la fuente). */
  readonly enabled: boolean;
  /** Resultados de los juegos soportados para esa fecha. [] si aún no hay. Lanza si la fuente falla. */
  fetchDraws(date: string): Promise<SourceDraw[]>;
}

export interface DrawResultRepository {
  findOfficial(lotteryId: string, date: string): Promise<DrawResult | null>;
  findManual(orgId: string, lotteryId: string, date: string): Promise<DrawResult | null>;
  /** Inserta si no existe (los resultados oficiales no se sobrescriben). true si insertó. */
  saveOfficial(result: DrawResult & { raw: unknown }): Promise<boolean>;
  /** Crea o reemplaza el resultado manual de la organización para ese juego y fecha. */
  saveManual(result: DrawResult): Promise<void>;
}

export interface ResolveInput {
  orgId: string;
  prizeId: string;
  /** Fecha del sorteo que se está resolviendo; protege contra resolver dos veces. */
  expectedDrawDate: string;
  attemptNo: number;
  resultNumber: string;
  outcome: "ganador" | "sin_ganador";
  winners: {
    number: number;
    buyerName: string | null;
    buyerPhone: string | null;
    paymentStatus: PaymentStatus;
  }[];
  newStatus: PrizeStatus;
  /** Nueva fecha si se reprograma. */
  nextDrawDate: string | null;
  now: string;
}

export interface PrizeRepository {
  create(prize: Prize): Promise<{ ok: true } | { ok: false; reason: "place_taken" }>;
  findById(orgId: string, prizeId: string): Promise<Prize | null>;
  listByRaffle(orgId: string, raffleId: string): Promise<Prize[]>;
  update(
    orgId: string,
    prizeId: string,
    patch: {
      description?: string;
      lotteryId?: string;
      matchType?: Prize["matchType"];
      digits?: number;
      drawDate?: string;
      onNoWinner?: Prize["onNoWinner"];
      maxAttempts?: number | null;
    },
  ): Promise<boolean>;
  delete(orgId: string, prizeId: string): Promise<boolean>;
  listAttempts(orgId: string, prizeId: string): Promise<PrizeAttempt[]>;
  listWinners(orgId: string, prizeId: string): Promise<PrizeWinner[]>;
  /** Atómico. false si el premio ya no estaba pendiente en esa fecha (otro lo resolvió antes). */
  resolve(input: ResolveInput): Promise<boolean>;
  /** Premios pendientes de todas las organizaciones con fecha de sorteo <= `day`. */
  listPendingDue(day: string): Promise<Prize[]>;
  listPublic(raffleId: string): Promise<PublicPrize[]>;
}
