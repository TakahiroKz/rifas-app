/** Sin caracteres ambiguos (0/O, 1/I/L). 31 símbolos. */
export const RESERVATION_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RESERVATION_CODE_LENGTH = 6;

/** Convierte bytes aleatorios en un código legible, p. ej. "RF-4K9P2X". */
export function buildReservationCode(bytes: Uint8Array): string {
  let code = "";
  for (let i = 0; i < RESERVATION_CODE_LENGTH; i++) {
    const byte = bytes[i] ?? 0;
    code += RESERVATION_CODE_ALPHABET[byte % RESERVATION_CODE_ALPHABET.length];
  }
  return `RF-${code}`;
}
