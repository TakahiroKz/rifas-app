import { formatDateTime } from "./format";

/** "07", "07 y 23", "07, 23 y 85". */
export function joinNumbers(numbers: string[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} y ${numbers[numbers.length - 1]}`;
}

/** Mensaje que el cliente envía por WhatsApp al organizador (antes de codificarlo para la URL). */
export function buildWhatsAppMessage(input: {
  raffleTitle: string;
  /** Números ya formateados con ceros a la izquierda. */
  numbers: string[];
  code: string;
  /** ISO UTC */
  reservedUntil: string;
  privacyUrl: string;
}): string {
  const one = input.numbers.length === 1;
  return [
    `Hola, quiero apartar ${one ? "el número" : "los números"} ${joinNumbers(input.numbers)} de la rifa "${input.raffleTitle}".`,
    `Código de apartado: ${input.code} (vigente hasta el ${formatDateTime(input.reservedUntil)}).`,
    `Autorizo el tratamiento de mis datos personales según la política de privacidad: ${input.privacyUrl}`,
    "Mi nombre completo es:",
  ].join("\n");
}

/**
 * Enlace https://wa.me/<teléfono>?text=<mensaje>. El teléfono va solo con dígitos (sin '+');
 * `text` es el único parámetro que admite wa.me para prellenar el chat.
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
