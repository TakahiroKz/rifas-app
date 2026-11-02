import type { ErrorResponse } from "@rifas/contracts";
import type { DomainError, ErrorCode } from "@rifas/core";

export type HttpStatus = 400 | 401 | 404 | 409 | 429 | 502;

const STATUS: Record<ErrorCode, HttpStatus> = {
  invalid_input: 400,
  not_found: 404,
  // No se revela que una rifa existe pero no está publicada.
  raffle_not_active: 404,
  numbers_unavailable: 409,
  slug_taken: 409,
  invalid_state: 409,
  unauthorized: 401,
  too_many_attempts: 429,
  too_many_reservations: 429,
  raffle_closed: 409,
  conflict: 409,
  source_unavailable: 502,
};

export function toHttpError(error: DomainError): { status: HttpStatus; body: ErrorResponse } {
  // Para el cliente, "rifa inactiva" es igual a "no encontrada".
  const code = error.code === "raffle_not_active" ? "not_found" : error.code;
  const message = error.code === "raffle_not_active" ? "Rifa no encontrada" : error.message;
  return {
    status: STATUS[error.code],
    body: { error: error.details ? { code, message, details: error.details } : { code, message } },
  };
}
