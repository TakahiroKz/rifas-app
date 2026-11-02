import type { TicketRecord } from "./types";

export type MatchType = "first" | "last";

/** Cifras del resultado que se comparan: "last" = las últimas k, "first" = las primeras k. */
export function winningTerm(result: string, matchType: MatchType, digits: number): string {
  return matchType === "last" ? result.slice(-digits) : result.slice(0, digits);
}

/**
 * Lógica por terminaciones: se compara el mismo tramo (primeras o últimas k cifras) del número
 * de la rifa y del resultado. Si k es menor que el ancho del número, pueden coincidir varios
 * números; cada coincidencia vendida es un premio.
 */
export function ticketMatches(
  ticketNumber: number,
  width: number,
  result: string,
  matchType: MatchType,
  digits: number,
): boolean {
  const t = String(ticketNumber).padStart(width, "0");
  const part = matchType === "last" ? t.slice(-digits) : t.slice(0, digits);
  return part === winningTerm(result, matchType, digits);
}

/** Todos los números de la rifa (0 … total-1) que coinciden con la regla. */
export function matchingNumbers(
  totalNumbers: number,
  width: number,
  result: string,
  matchType: MatchType,
  digits: number,
): number[] {
  const out: number[] = [];
  for (let n = 0; n < totalNumbers; n++) {
    if (ticketMatches(n, width, result, matchType, digits)) out.push(n);
  }
  return out;
}

/** Los ganadores son los coincidentes que están vendidos (pagados o con deuda). */
export function pickWinners(matches: number[], sold: TicketRecord[]): TicketRecord[] {
  const set = new Set(matches);
  return sold.filter((t) => t.status === "vendido" && set.has(t.number));
}
