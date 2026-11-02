import { addDays, weekdayOf } from "./time";

export interface LotteryGame {
  id: string;
  name: string;
  country: "CO";
  /** Días de la semana en que sortea (0 = domingo … 6 = sábado), hora de Colombia. */
  drawWeekdays: number[];
  /** Hora local (HH:MM) antes de la cual no tiene sentido consultar el resultado del día. */
  resultsAfter: string;
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * Juegos soportados. Un "juego" agrupa las variantes que la fuente publica según el día
 * (p. ej. Chontico Noche cambia de código y hora los sábados, domingos y festivos).
 * El calendario sale de 5 semanas de histórico de Gane (ver docs/GANE-API.md).
 */
export const LOTTERY_GAMES: readonly LotteryGame[] = [
  {
    id: "chontico-noche",
    name: "Chontico Noche",
    country: "CO",
    drawWeekdays: EVERY_DAY,
    resultsAfter: "18:55",
  },
  {
    id: "dorado-noche",
    name: "Dorado Noche",
    country: "CO",
    drawWeekdays: EVERY_DAY,
    resultsAfter: "18:55",
  },
  {
    id: "loteria-del-valle",
    name: "Lotería del Valle",
    country: "CO",
    drawWeekdays: [3],
    resultsAfter: "21:55",
  },
];

export const getGame = (id: string): LotteryGame | undefined =>
  LOTTERY_GAMES.find((g) => g.id === id);

export function isDrawDay(gameId: string, day: string): boolean {
  const game = getGame(gameId);
  return game !== undefined && game.drawWeekdays.includes(weekdayOf(day));
}

/** Días en que sortea el juego dentro de [from, to] (ambos incluidos). Máximo 400 días. */
export function drawDaysBetween(gameId: string, from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) {
    if (isDrawDay(gameId, d)) days.push(d);
  }
  return days;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}
