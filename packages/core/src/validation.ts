export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === "string" && value.length >= 3 && value.length <= 60 && SLUG_PATTERN.test(value)
  );
}

/** Fecha de calendario AAAA-MM-DD existente (rechaza 2026-02-30). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Teléfono en formato internacional sin '+': 10 a 15 dígitos. */
export function isValidPhone(value: unknown): value is string {
  return typeof value === "string" && /^\d{10,15}$/.test(value);
}

export function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length === 0 ? undefined : text.slice(0, maxLength);
}
