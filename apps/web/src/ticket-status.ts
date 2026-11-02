import type { AdminTicket } from "@rifas/contracts";
import { isExpired } from "./format";

export type TicketView =
  | { kind: "activo" }
  | { kind: "apartado"; ticket: AdminTicket }
  | { kind: "pagado"; ticket: AdminTicket }
  | { kind: "debe"; ticket: AdminTicket; overdue: boolean };

/** Estado efectivo de un número: un apartado vencido cuenta como activo. */
export function viewOf(ticket: AdminTicket | undefined, now: Date, today: string): TicketView {
  if (!ticket) return { kind: "activo" };
  if (ticket.status === "apartado") {
    return isExpired(ticket.reservedUntil, now) ? { kind: "activo" } : { kind: "apartado", ticket };
  }
  if (ticket.paymentStatus === "debe") {
    return { kind: "debe", ticket, overdue: ticket.dueDate !== null && ticket.dueDate < today };
  }
  return { kind: "pagado", ticket };
}
