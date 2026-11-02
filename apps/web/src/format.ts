/** Número con ceros a la izquierda: formatTicket(7, 2) → "07". */
export const formatTicket = (value: number, width: number): string =>
  String(value).padStart(width, "0");

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
export const formatMoney = (pesos: number | null): string =>
  pesos === null ? "—" : money.format(pesos);

const TZ = "America/Bogota";

/** "2 nov 2026, 3:00 p. m." en hora de Colombia. */
export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TZ,
  }).format(new Date(iso));

/** AAAA-MM-DD → "20 dic 2026" (sin desfase de zona horaria). */
export const formatDay = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
};

/** Fecha de hoy en Colombia como AAAA-MM-DD. */
export const todayBogota = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);

/** Texto para un identificador de URL a partir de un título. */
export const slugify = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");

/** Un apartado cuyo plazo ya pasó se considera libre aunque el Cron aún no lo haya limpiado. */
export const isExpired = (reservedUntil: string | null, now = new Date()): boolean =>
  reservedUntil !== null && new Date(reservedUntil).getTime() <= now.getTime();

/** plural(1, "vendido", "vendidos") → "vendido"; plural(2, …) → "vendidos". */
export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "lun 2 nov 2026": fecha AAAA-MM-DD con el día de la semana, sin desfase de zona horaria. */
export const formatDayLong = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** "Últimas 2 cifras", "Primera cifra"… */
export const ruleLabel = (matchType: "first" | "last", digits: number): string => {
  if (matchType === "last") return digits === 1 ? "Última cifra" : `Últimas ${digits} cifras`;
  return digits === 1 ? "Primera cifra" : `Primeras ${digits} cifras`;
};

/** Texto de la política cuando no hay ganador. */
export const policyLabel = (
  onNoWinner: "reprogramar" | "finalizar",
  maxAttempts: number | null,
): string =>
  onNoWinner === "finalizar"
    ? "Si no hay ganador, el premio termina"
    : maxAttempts === null
      ? "Si no hay ganador, se reprograma sin límite de intentos"
      : `Si no hay ganador, se reprograma (hasta ${maxAttempts} ${plural(maxAttempts, "intento", "intentos")})`;
