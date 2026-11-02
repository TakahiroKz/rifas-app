export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "raffle_not_active"
  | "numbers_unavailable"
  | "slug_taken"
  | "invalid_state"
  | "unauthorized"
  | "too_many_attempts"
  | "too_many_reservations";

export interface DomainError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): { ok: false; error: DomainError } => ({
  ok: false,
  error: details ? { code, message, details } : { code, message },
});
