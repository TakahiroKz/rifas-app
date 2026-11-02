import { describe, expect, it } from "vitest";
import {
  dropTaken,
  MAX_PER_RESERVATION,
  pickRandomAvailable,
  type Taken,
  toggleNumber,
  visibleNumbers,
} from "./selection";

describe("toggleNumber", () => {
  it("agrega ordenado y quita", () => {
    let s: number[] = [];
    s = toggleNumber(s, 23).selected;
    s = toggleNumber(s, 7).selected;
    expect(s).toEqual([7, 23]);
    expect(toggleNumber(s, 7).selected).toEqual([23]);
  });
  it("no pasa del máximo y lo avisa", () => {
    const full = Array.from({ length: MAX_PER_RESERVATION }, (_, i) => i);
    const r = toggleNumber(full, 50);
    expect(r.selected).toEqual(full);
    expect(r.limitReached).toBe(true);
    expect(toggleNumber(full, 3).limitReached).toBe(false); // quitar siempre se puede
  });
});

describe("visibleNumbers / pickRandomAvailable / dropTaken", () => {
  const taken: Taken = new Map([
    [1, "apartado"],
    [3, "vendido"],
  ]);
  it("filtra los no disponibles", () => {
    expect(visibleNumbers(5, taken, false)).toEqual([0, 1, 2, 3, 4]);
    expect(visibleNumbers(5, taken, true)).toEqual([0, 2, 4]);
  });
  it("elige al azar solo entre disponibles y no elegidos", () => {
    expect(pickRandomAvailable(5, taken, [0], () => 0)).toBe(2);
    expect(pickRandomAvailable(5, taken, [0], () => 0.99)).toBe(4);
    expect(pickRandomAvailable(5, taken, [0, 2, 4])).toBeNull();
    for (let i = 0; i < 50; i++) expect([0, 2, 4]).toContain(pickRandomAvailable(5, taken, []));
  });
  it("quita de la selección lo que ya se tomó", () => {
    expect(dropTaken([0, 1, 2, 3], taken)).toEqual([0, 2]);
  });
});
