import { describe, expect, it } from "vitest";
import { activitySummary, barHeights, niceMax } from "./chart";

describe("chart", () => {
  it("alturas proporcionales con mínimo visible y 0 para vacío", () => {
    expect(barHeights([0, 0, 0], 100)).toEqual([0, 0, 0]);
    expect(barHeights([0, 5, 10], 100)).toEqual([0, 50, 100]);
    expect(barHeights([0, 1, 100], 100)).toEqual([0, 3, 100]); // 1 de 100 sigue viéndose
    expect(barHeights([], 100)).toEqual([]);
  });
  it("máximo redondo", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(1200)).toBe(2000);
  });
  it("texto alternativo", () => {
    const a = [
      { day: "2026-11-01", reserved: 2, sold: 1 },
      { day: "2026-11-02", reserved: 0, sold: 4 },
    ];
    expect(activitySummary(a)).toBe(
      "Últimos 2 días: 5 ventas y 2 apartados registrados. El día con más ventas fue 2026-11-02 (4).",
    );
    expect(activitySummary([{ day: "2026-11-01", reserved: 0, sold: 0 }])).toBe(
      "Últimos 1 días: 0 ventas y 0 apartados registrados.",
    );
  });
});
