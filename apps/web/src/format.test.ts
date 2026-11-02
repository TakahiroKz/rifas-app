import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatDayLong,
  formatMoney,
  formatTicket,
  isExpired,
  plural,
  policyLabel,
  ruleLabel,
  slugify,
  todayBogota,
} from "./format";

describe("format", () => {
  it("números con ceros a la izquierda", () => {
    expect(formatTicket(0, 4)).toBe("0000");
    expect(formatTicket(7, 2)).toBe("07");
    expect(formatTicket(9999, 4)).toBe("9999");
  });
  it("pesos colombianos sin decimales", () => {
    expect(formatMoney(10000).replace(/\s/g, " ")).toMatch(/10\.000/);
    expect(formatMoney(null)).toBe("—");
  });
  it("fecha de hoy según Colombia (UTC-5), no UTC", () => {
    expect(todayBogota(new Date("2026-11-03T03:00:00Z"))).toBe("2026-11-02");
    expect(todayBogota(new Date("2026-11-03T05:00:00Z"))).toBe("2026-11-03");
  });
  it("un día AAAA-MM-DD no se corre por zona horaria", () => {
    expect(formatDay("2026-12-20")).toMatch(/20/);
  });
  it("slugify quita tildes y símbolos", () => {
    expect(slugify("Rifa de Navidad 2026!")).toBe("rifa-de-navidad-2026");
    expect(slugify("  ¡Año nuevo, ñandú!  ")).toBe("ano-nuevo-nandu");
    expect(slugify("---")).toBe("");
  });
  it("detecta apartados vencidos", () => {
    const now = new Date("2026-11-02T15:00:00Z");
    expect(isExpired("2026-11-02T15:00:00Z", now)).toBe(true);
    expect(isExpired("2026-11-02T15:00:01Z", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });
  it("plural", () => {
    expect(plural(1, "vendido", "vendidos")).toBe("vendido");
    expect(plural(0, "vendido", "vendidos")).toBe("vendidos");
    expect(plural(3, "vendido", "vendidos")).toBe("vendidos");
  });
  it("regla de premio y política", () => {
    expect(ruleLabel("last", 2)).toBe("Últimas 2 cifras");
    expect(ruleLabel("last", 1)).toBe("Última cifra");
    expect(ruleLabel("first", 3)).toBe("Primeras 3 cifras");
    expect(ruleLabel("first", 1)).toBe("Primera cifra");
    expect(policyLabel("finalizar", null)).toMatch(/termina/);
    expect(policyLabel("reprogramar", null)).toMatch(/sin límite/);
    expect(policyLabel("reprogramar", 1)).toMatch(/1 intento\)/);
    expect(policyLabel("reprogramar", 3)).toMatch(/3 intentos/);
  });
  it("día con día de la semana, sin correrse de zona horaria", () => {
    expect(formatDayLong("2026-11-04")).toMatch(/mié/);
    expect(formatDayLong("2026-11-04")).toMatch(/4/);
    expect(formatDayLong("2026-11-02")).toMatch(/lun/);
  });
});
