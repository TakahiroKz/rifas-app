/** `activo` no tiene fila en la base de datos: es la ausencia de apartado/venta. */
export type TicketStatus = "activo" | "apartado" | "vendido";
export type PaymentStatus = "pagado" | "debe";
export type RaffleStatus = "borrador" | "activa" | "cerrada";
export type Actor = "public" | "admin" | "system";
export type EventAction = "reserve" | "expire" | "sell" | "update_payment" | "release";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** Formato internacional sin '+', p. ej. 57XXXXXXXXXX. */
  whatsappPhone: string;
  createdAt: string;
}

export interface Raffle {
  id: string;
  orgId: string;
  slug: string;
  title: string;
  description: string;
  totalNumbers: number;
  numberWidth: number;
  /** Pesos colombianos enteros. */
  ticketPrice: number | null;
  status: RaffleStatus;
  /** AAAA-MM-DD */
  drawDate: string | null;
  createdAt: string;
}

export interface Buyer {
  name?: string | undefined;
  phone?: string | undefined;
  note?: string | undefined;
}

export type Payment = { status: "pagado" } | { status: "debe"; dueDate: string };

/** Fila de un número que NO está activo. */
export interface TicketRecord {
  raffleId: string;
  number: number;
  status: "apartado" | "vendido";
  paymentStatus: PaymentStatus | null;
  dueDate: string | null;
  buyerName: string | null;
  buyerPhone: string | null;
  note: string | null;
  reservationCode: string | null;
  reservedAt: string | null;
  reservedUntil: string | null;
  soldAt: string | null;
  updatedAt: string;
}

/** Vista pública: sin datos del comprador. */
export interface PublicTicket {
  number: number;
  status: "apartado" | "vendido";
}

export interface TicketEvent {
  id: number;
  raffleId: string;
  number: number;
  action: EventAction;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  actor: Actor;
  reservationCode: string | null;
  at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Session {
  /** SHA-256 del token de la cookie. */
  id: string;
  userId: string;
  orgId: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

/** Quién está haciendo la petición de administración. */
export interface AuthContext {
  user: User;
  organization: Organization;
  csrfToken: string;
}

export interface RaffleStats {
  /** Apartados vigentes. */
  reserved: number;
  sold: number;
  paid: number;
  owed: number;
  /** Pesos: vendidos × precio (null si la rifa no tiene precio). */
  soldAmount: number | null;
  paidAmount: number | null;
  owedAmount: number | null;
}

export type RaffleWithStats = Raffle & { stats: RaffleStats };
