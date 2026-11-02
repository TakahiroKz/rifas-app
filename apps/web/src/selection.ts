/** Máximo de números por solicitud; el servidor lo vuelve a validar. */
export const MAX_PER_RESERVATION = 10;

export type Taken = Map<number, "apartado" | "vendido">;

/** Agrega o quita un número de la selección (ordenada). No pasa del máximo. */
export function toggleNumber(
  selected: number[],
  n: number,
  max = MAX_PER_RESERVATION,
): { selected: number[]; limitReached: boolean } {
  if (selected.includes(n))
    return { selected: selected.filter((x) => x !== n), limitReached: false };
  if (selected.length >= max) return { selected, limitReached: true };
  return { selected: [...selected, n].sort((a, b) => a - b), limitReached: false };
}

/** Números a mostrar: todos, o solo los disponibles. */
export function visibleNumbers(total: number, taken: Taken, onlyAvailable: boolean): number[] {
  const all = Array.from({ length: total }, (_, i) => i);
  return onlyAvailable ? all.filter((n) => !taken.has(n)) : all;
}

/** Un número disponible al azar que no esté ya elegido. `rng` devuelve [0, 1). */
export function pickRandomAvailable(
  total: number,
  taken: Taken,
  selected: number[],
  rng: () => number = Math.random,
): number | null {
  const candidates = visibleNumbers(total, taken, true).filter((n) => !selected.includes(n));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}

/** Quita de la selección los números que ya no están disponibles. */
export function dropTaken(selected: number[], taken: Taken): number[] {
  return selected.filter((n) => !taken.has(n));
}
