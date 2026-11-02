import { describe, expect, it } from "vitest";
import { getRaffleWithStats } from "./admin";
import { createOrganization } from "./organizations";
import { createRaffle } from "./raffles";
import { getRaffleReport } from "./report";
import { createTestDeps } from "./test-support";
import { markSold, reserveTickets } from "./tickets";

async function setup(price: number | null = 10_000) {
  const t = createTestDeps(); // 2026-11-02 10:00 en Colombia
  const org = await createOrganization(t.deps, {
    name: "Capital Finaura",
    slug: "finaura",
    whatsappPhone: "573045235606",
  });
  if (!org.ok) throw new Error("org");
  const raffle = await createRaffle(t.deps, {
    orgId: org.value.id,
    slug: "navidad",
    title: "Rifa de Navidad",
    totalNumbers: 200,
    status: "activa",
    ...(price !== null ? { ticketPrice: price } : {}),
  });
  if (!raffle.ok) throw new Error("raffle");
  const ids = { orgId: org.value.id, raffleId: raffle.value.id };
  const sell = (number: number, payment: unknown) => markSold(t.deps, { ...ids, number, payment });
  const reserve = (numbers: number[]) =>
    reserveTickets(t.deps, { orgSlug: "finaura", raffleSlug: "navidad", clientId: "c", numbers });
  return { ...t, ids, sell, reserve };
}

const DAY = 24 * 3600 * 1000;

describe("deudas vencidas en las estadísticas", () => {
  it("cuenta como vencida solo la fecha de pago anterior a hoy (hoy no vence)", async () => {
    const { deps, ids, sell } = await setup();
    await sell(1, { status: "debe", dueDate: "2026-10-30" }); // vencida
    await sell(2, { status: "debe", dueDate: "2026-10-01" }); // vencida
    await sell(3, { status: "debe", dueDate: "2026-11-02" }); // vence hoy: aún no
    await sell(4, { status: "debe", dueDate: "2026-11-10" });
    await sell(5, { status: "pagado" });
    const r = await getRaffleWithStats(deps, ids);
    expect(r.ok && r.value.stats).toMatchObject({
      sold: 5,
      owed: 4,
      overdue: 2,
      overdueAmount: 20_000,
      owedAmount: 40_000,
    });
  });

  it("al cobrar una deuda vencida deja de contar", async () => {
    const { deps, ids, sell } = await setup();
    await sell(1, { status: "debe", dueDate: "2026-10-30" });
    await sell(1, { status: "pagado" });
    const r = await getRaffleWithStats(deps, ids);
    expect(r.ok && r.value.stats).toMatchObject({ owed: 0, overdue: 0, paid: 1 });
  });

  it("sin precio, los montos son null pero los conteos siguen", async () => {
    const { deps, ids, sell } = await setup(null);
    await sell(1, { status: "debe", dueDate: "2026-10-30" });
    const r = await getRaffleWithStats(deps, ids);
    expect(r.ok && r.value.stats).toMatchObject({ overdue: 1, overdueAmount: null });
  });
});

describe("reporte de la rifa", () => {
  it("actividad de los últimos 30 días, con ceros donde no hubo movimiento", async () => {
    const { deps, clock, ids, sell, reserve } = await setup();
    await reserve([10, 11]); // 2 nov: 2 apartados
    await sell(20, { status: "pagado" }); // 2 nov: 1 venta
    clock.advance(DAY);
    await sell(21, { status: "pagado" });
    await sell(22, { status: "debe", dueDate: "2026-11-20" }); // 3 nov: 2 ventas
    const r = await getRaffleReport(deps, ids);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.activity).toHaveLength(30);
    expect(r.value.activity[0]?.day).toBe("2026-10-05");
    expect(r.value.activity.at(-1)?.day).toBe("2026-11-03");
    const byDay = Object.fromEntries(r.value.activity.map((d) => [d.day, [d.reserved, d.sold]]));
    expect(byDay["2026-11-02"]).toEqual([2, 1]);
    expect(byDay["2026-11-03"]).toEqual([0, 2]);
    expect(byDay["2026-10-20"]).toEqual([0, 0]);
    expect(r.value.soldPercent).toBe(1.5); // 3 de 200
  });

  it("resume las deudas: la vencida más antigua y la próxima por llegar", async () => {
    const { deps, ids, sell } = await setup();
    await sell(1, { status: "debe", dueDate: "2026-10-20" });
    await sell(2, { status: "debe", dueDate: "2026-10-28" });
    await sell(3, { status: "debe", dueDate: "2026-11-15" });
    await sell(4, { status: "debe", dueDate: "2026-11-09" });
    const r = await getRaffleReport(deps, ids);
    expect(r.ok && r.value.debts).toEqual({
      overdueCount: 2,
      overdueAmount: 20_000,
      oldestOverdueDate: "2026-10-20",
      nextDueDate: "2026-11-09",
    });
  });

  it("sin deudas: todo en cero y sin fechas", async () => {
    const { deps, ids } = await setup();
    const r = await getRaffleReport(deps, ids);
    expect(r.ok && r.value.debts).toEqual({
      overdueCount: 0,
      overdueAmount: 0,
      oldestOverdueDate: null,
      nextDueDate: null,
    });
    expect(r.ok && r.value.soldPercent).toBe(0);
  });

  it("acota el rango y no cruza organizaciones", async () => {
    const { deps, ids } = await setup();
    const long = await getRaffleReport(deps, { ...ids, days: 9999 });
    expect(long.ok && long.value.activity).toHaveLength(90);
    const one = await getRaffleReport(deps, { ...ids, days: 0 });
    expect(one.ok && one.value.activity).toHaveLength(1);
    const other = await getRaffleReport(deps, { orgId: "otra", raffleId: ids.raffleId });
    expect(other.ok ? null : other.error.code).toBe("not_found");
  });
});
