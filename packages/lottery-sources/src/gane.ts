import type { LotterySource, SourceDraw } from "@rifas/core";
import { z } from "zod";

export const GANE_BASE_URL =
  "https://8r0pwu3qoj.execute-api.us-east-1.amazonaws.com/api/resultados_chance/chance";

/**
 * Códigos de sorteo de Gane por juego. Un mismo juego cambia de código según el día:
 * - Chontico Noche: 62 (lunes a viernes, 18:50), 89 (sábado, 21:50), 63 (domingo y festivos, 19:50)
 * - Dorado Noche:   46 (lunes a sábado, 21:50), 65 (domingo y festivos, 18:50)
 * - Lotería del Valle: 17 (miércoles, 21:50)
 */
export const GANE_CODES: Record<string, string> = {
  "62": "chontico-noche",
  "89": "chontico-noche",
  "63": "chontico-noche",
  "46": "dorado-noche",
  "65": "dorado-noche",
  "17": "loteria-del-valle",
};

const rowSchema = z.object({
  CODIGO: z.number(),
  FECHA_SORTEO: z.string(),
  RESULTADO: z.union([z.string(), z.number()]),
  SERIE_RESULTADO: z.string().nullable().optional(),
  NUMERO_SORTEO: z.number().nullable().optional(),
});

const responseSchema = z.object({
  exito: z.boolean(),
  resultados: z.array(z.unknown()).default([]),
});

export class GaneSourceError extends Error {}

/** Normaliza el resultado a 4 cifras con ceros a la izquierda; null si no tiene el formato esperado. */
export function normalizeNumber(value: string | number): string | null {
  const text = String(value).trim();
  return /^\d{1,4}$/.test(text) ? text.padStart(4, "0") : null;
}

/**
 * Parsea la respuesta de `/consultar` y devuelve solo los juegos soportados.
 * Es tolerante: ignora filas que no entiende en lugar de fallar por completo.
 */
export function parseGaneResponse(date: string, body: unknown): SourceDraw[] {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.exito) {
    throw new GaneSourceError("Respuesta de Gane con formato inesperado");
  }
  const draws: SourceDraw[] = [];
  for (const raw of parsed.data.resultados) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) continue;
    const lotteryId = GANE_CODES[String(row.data.CODIGO)];
    const number = normalizeNumber(row.data.RESULTADO);
    // La fecha de la fila debe coincidir con la pedida: evita guardar un resultado en el día equivocado.
    if (!lotteryId || number === null || row.data.FECHA_SORTEO.slice(0, 10) !== date) continue;
    draws.push({
      lotteryId,
      drawDate: date,
      number,
      series: row.data.SERIE_RESULTADO ?? null,
      sourceRef: row.data.NUMERO_SORTEO != null ? String(row.data.NUMERO_SORTEO) : null,
      raw,
    });
  }
  return draws;
}

/**
 * Fuente de resultados: servicio público de Gane (el mismo que usa su página de resultados).
 * No está documentado oficialmente: antes de usarlo en producción hay que tener la autorización de
 * Gane por escrito, por eso `enabled` se controla por configuración.
 */
export class GaneSource implements LotterySource {
  constructor(
    readonly enabled: boolean,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl: string = GANE_BASE_URL,
  ) {}

  async fetchDraws(date: string): Promise<SourceDraw[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GaneSourceError("Fecha no válida");
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/consultar?fecha_especifica=${date}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Tiempo agotado o sin red: es transitorio, se reintenta en la próxima ejecución del cron.
      throw new GaneSourceError("No se pudo contactar a Gane");
    }
    // 404: Gane responde así cuando todavía no hay resultados de esa fecha. No es un error.
    if (res.status === 404) return [];
    // Cualquier otro fallo (p. ej. 500 por su base de datos) se reintenta luego. No se propaga su detalle interno.
    if (!res.ok) throw new GaneSourceError(`Gane respondió ${res.status}`);
    return parseGaneResponse(date, await res.json().catch(() => null));
  }
}

/** Fuente apagada: el cron y el botón «Consultar» no hacen nada y el resultado se ingresa a mano. */
export const disabledSource: LotterySource = {
  enabled: false,
  async fetchDraws() {
    return [];
  },
};
