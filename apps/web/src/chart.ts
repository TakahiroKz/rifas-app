/** Altura de cada barra en píxeles: proporcional al máximo, con un mínimo visible para valores > 0. */
export function barHeights(values: number[], maxHeight: number, minVisible = 3): number[] {
  const max = Math.max(...values, 0);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => (v === 0 ? 0 : Math.max(minVisible, Math.round((v / max) * maxHeight))));
}

/** Máximo "redondo" para el eje: 1, 2, 5, 10, 20, 50… */
export function niceMax(value: number): number {
  if (value <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Texto alternativo del gráfico para lectores de pantalla. */
export function activitySummary(
  activity: { day: string; reserved: number; sold: number }[],
): string {
  const sold = activity.reduce((n, d) => n + d.sold, 0);
  const reserved = activity.reduce((n, d) => n + d.reserved, 0);
  const best = activity.reduce(
    (a, d) => (d.sold > a.sold ? d : a),
    activity[0] ?? { day: "", reserved: 0, sold: 0 },
  );
  return `Últimos ${activity.length} días: ${sold} ventas y ${reserved} apartados registrados.${
    best.sold > 0 ? ` El día con más ventas fue ${best.day} (${best.sold}).` : ""
  }`;
}
