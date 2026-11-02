import type { AdminTicket } from "@rifas/contracts";
import { describe, expect, it } from "vitest";
import { viewOf } from "./ticket-status";

const base: AdminTicket = {
  number: 1,
  status: "apartado",
  paymentStatus: null,
  dueDate: null,
  buyerName: null,
  buyerPhone: null,
  note: null,
  reservationCode: "RF-X",
  reservedAt: null,
  reservedUntil: "2026-11-03T00:00:00Z",
  soldAt: null,
  updatedAt: "2026-11-02T00:00:00Z",
};
const now = new Date("2026-11-02T12:00:00Z");

describe("viewOf", () => {
  it("sin fila es activo", () => expect(viewOf(undefined, now, "2026-11-02").kind).toBe("activo"));
  it("apartado vigente vs vencido", () => {
    expect(viewOf(base, now, "2026-11-02").kind).toBe("apartado");
    expect(viewOf({ ...base, reservedUntil: "2026-11-02T11:00:00Z" }, now, "2026-11-02").kind).toBe(
      "activo",
    );
  });
  it("vendido: pagado o debe (vencida si la fecha ya pasó)", () => {
    const sold = { ...base, status: "vendido" as const, reservedUntil: null };
    expect(viewOf({ ...sold, paymentStatus: "pagado" }, now, "2026-11-02").kind).toBe("pagado");
    const owes = { ...sold, paymentStatus: "debe" as const };
    expect(viewOf({ ...owes, dueDate: "2026-11-02" }, now, "2026-11-02")).toMatchObject({
      kind: "debe",
      overdue: false,
    });
    expect(viewOf({ ...owes, dueDate: "2026-11-01" }, now, "2026-11-02")).toMatchObject({
      kind: "debe",
      overdue: true,
    });
  });
});
