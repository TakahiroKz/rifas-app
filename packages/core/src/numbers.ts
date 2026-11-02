export const MIN_TOTAL_NUMBERS = 10;
export const MAX_TOTAL_NUMBERS = 10_000;

/** Cantidad de cifras con la que se muestra cada número (10 → 1, 100 → 2, 10 000 → 4). */
export function numberWidth(totalNumbers: number): number {
  return String(totalNumbers - 1).length;
}

/** Número con ceros a la izquierda: formatNumber(7, 2) → "07". */
export function formatNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function isValidTotalNumbers(total: unknown): total is number {
  return (
    typeof total === "number" &&
    Number.isInteger(total) &&
    total >= MIN_TOTAL_NUMBERS &&
    total <= MAX_TOTAL_NUMBERS
  );
}

/** Los números de una rifa van de 0 a total - 1. */
export function isNumberInRange(value: unknown, totalNumbers: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < totalNumbers;
}
