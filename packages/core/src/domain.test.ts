import { describe, expect, it } from "vitest";
import { RESERVATION_TTL_MS } from "./constants";
import { formatNumber, isNumberInRange, isValidTotalNumbers, numberWidth } from "./numbers";
import { createOrganization } from "./organizations";
import { createRaffle, setRaffleStatus } from "./raffles";
import { buildReservationCode, RESERVATION_CODE_ALPHABET } from "./reservation-code";
import { createTestDeps } from "./test-support";
import {
  expireReservations,
  getPublicRaffle,
  listAdminTickets,
  listDebts,
  listHistory,
  listPublicTickets,
  markSold,
  releaseTicket,
  reserveTickets,
  updatePayment,
} from "./tickets";
import { isValidDate, isValidPhone, isValidSlug } from "./validation";

async function setup(totalNumbers = 100, status: "activa" | "borrador" = "activa") {
  const t = createTestDeps();
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
    totalNumbers,
    status,
  });
  if (!raffle.ok) throw new Error("raffle");
  return { ...t, org: org.value, raffle: raffle.value };
}
const pub = { orgSlug: "finaura", raffleSlug: "navidad" };

describe("números", () => {
  it("calcula el ancho según el total", () => {
    expect(numberWidth(10)).toBe(1);
    expect(numberWidth(11)).toBe(2);
    expect(numberWidth(100)).toBe(2);
    expect(numberWidth(101)).toBe(3);
    expect(numberWidth(1000)).toBe(3);
    expect(numberWidth(10_000)).toBe(4);
  });
  it("formatea con ceros a la izquierda", () => {
    expect(formatNumber(0, 4)).toBe("0000");
    expect(formatNumber(7, 2)).toBe("07");
    expect(formatNumber(9999, 4)).toBe("9999");
  });
  it("valida el rango de la rifa (10 a 10 000) y de cada número", () => {
    expect(isValidTotalNumbers(9)).toBe(false);
    expect(isValidTotalNumbers(10)).toBe(true);
    expect(isValidTotalNumbers(10_000)).toBe(true);
    expect(isValidTotalNumbers(10_001)).toBe(false);
    expect(isValidTotalNumbers(50.5)).toBe(false);
    expect(isNumberInRange(0, 100)).toBe(true);
    expect(isNumberInRange(99, 100)).toBe(true);
    expect(isNumberInRange(100, 100)).toBe(false);
    expect(isNumberInRange(-1, 100)).toBe(false);
    expect(isNumberInRange("5", 100)).toBe(false);
  });
});

describe("validaciones", () => {
  it("fechas reales", () => {
    expect(isValidDate("2026-12-24")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("24/12/2026")).toBe(false);
  });
  it("slug y teléfono", () => {
    expect(isValidSlug("rifa-navidad-2026")).toBe(true);
    expect(isValidSlug("Rifa Navidad")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidPhone("573045235606")).toBe(true);
    expect(isValidPhone("+573045235606")).toBe(false);
  });
  it("código de apartado legible", () => {
    const code = buildReservationCode(new Uint8Array([0, 1, 2, 30, 31, 255]));
    expect(code).toMatch(/^RF-[A-Z2-9]{6}$/);
    for (const ch of code.slice(3)) expect(RESERVATION_CODE_ALPHABET).toContain(ch);
  });
});

describe("rifas", () => {
  it("rechaza datos inválidos y slug repetido por organización", async () => {
    const { deps, org } = await setup();
    const base = { orgId: org.id, slug: "otra", title: "Otra rifa", totalNumbers: 100 };
    expect((await createRaffle(deps, { ...base, totalNumbers: 5 })).ok).toBe(false);
    expect((await createRaffle(deps, { ...base, drawDate: "2026-13-01" })).ok).toBe(false);
    expect((await createRaffle(deps, { ...base, ticketPrice: -1 })).ok).toBe(false);
    const dup = await createRaffle(deps, { ...base, slug: "navidad" });
    expect(dup.ok ? null : dup.error.code).toBe("slug_taken");
  });
  it("calcula el ancho al crear", async () => {
    const { raffle } = await setup(10_000);
    expect(raffle.numberWidth).toBe(4);
  });
});

describe("apartar (zona pública)", () => {
  it("aparta por 24 h con código y deja historial", async () => {
    const { deps, clock, raffle } = await setup();
    const r = await reserveTickets(deps, { ...pub, numbers: [23, 7, 85] });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.numbers).toEqual([7, 23, 85]);
    expect(r.value.code).toBe("RF-TEST1");
    expect(new Date(r.value.reservedUntil).getTime() - clock.now().getTime()).toBe(
      RESERVATION_TTL_MS,
    );

    const list = await listPublicTickets(deps, pub);
    expect(list.ok && list.value).toEqual([
      { number: 7, status: "apartado" },
      { number: 23, status: "apartado" },
      { number: 85, status: "apartado" },
    ]);
    const hist = await listHistory(deps, { orgId: raffle.orgId, raffleId: raffle.id });
    expect(hist.ok && hist.value.map((e) => e.action)).toEqual(["reserve", "reserve", "reserve"]);
  });

  it("es todo o nada: si uno está tomado no aparta ninguno", async () => {
    const { deps } = await setup();
    await reserveTickets(deps, { ...pub, numbers: [5] });
    const r = await reserveTickets(deps, { ...pub, numbers: [4, 5, 6] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("numbers_unavailable");
      expect(r.error.details).toEqual({ unavailable: [5] });
    }
    const list = await listPublicTickets(deps, pub);
    expect(list.ok && list.value.map((t) => t.number)).toEqual([5]);
  });

  it.each([
    ["vacío", []],
    ["no es lista", "5"],
    ["fuera de rango", [100]],
    ["negativo", [-1]],
    ["decimal", [1.5]],
    ["texto", ["7"]],
    ["repetidos", [3, 3]],
    ["más de 10", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ])("rechaza entrada inválida: %s", async (_name, numbers) => {
    const { deps } = await setup();
    const r = await reserveTickets(deps, { ...pub, numbers });
    expect(r.ok ? null : r.error.code).toBe("invalid_input");
  });

  it("no aparta en rifas inactivas ni inexistentes", async () => {
    const { deps } = await setup(100, "borrador");
    const r1 = await reserveTickets(deps, { ...pub, numbers: [1] });
    expect(r1.ok ? null : r1.error.code).toBe("raffle_not_active");
    const r2 = await reserveTickets(deps, { orgSlug: "finaura", raffleSlug: "nope", numbers: [1] });
    expect(r2.ok ? null : r2.error.code).toBe("not_found");
    const r3 = await getPublicRaffle(deps, pub);
    expect(r3.ok).toBe(false);
  });

  it("un apartado vencido vuelve a estar disponible aunque el cron no haya corrido", async () => {
    const { deps, clock } = await setup();
    await reserveTickets(deps, { ...pub, numbers: [9] });
    clock.advance(RESERVATION_TTL_MS - 1);
    expect((await reserveTickets(deps, { ...pub, numbers: [9] })).ok).toBe(false);
    clock.advance(1);
    const list = await listPublicTickets(deps, pub);
    expect(list.ok && list.value).toEqual([]);
    expect((await reserveTickets(deps, { ...pub, numbers: [9] })).ok).toBe(true);
  });

  it("el cron persiste la caducidad en el historial", async () => {
    const { deps, clock, raffle } = await setup();
    await reserveTickets(deps, { ...pub, numbers: [1, 2] });
    clock.advance(RESERVATION_TTL_MS);
    expect(await expireReservations(deps)).toBe(2);
    expect(await expireReservations(deps)).toBe(0);
    const hist = await listHistory(deps, { orgId: raffle.orgId, raffleId: raffle.id, number: 1 });
    expect(hist.ok && hist.value.map((e) => e.action)).toEqual(["expire", "reserve"]);
  });
});

describe("administración", () => {
  it("vende, marca deuda con fecha y la lista ordenada por fecha de pago", async () => {
    const { deps, raffle } = await setup();
    const ids = { orgId: raffle.orgId, raffleId: raffle.id };
    await markSold(deps, {
      ...ids,
      number: 10,
      payment: { status: "debe", dueDate: "2026-12-20" },
      buyer: { name: " Ana ", phone: "3001112233" },
    });
    await markSold(deps, {
      ...ids,
      number: 11,
      payment: { status: "debe", dueDate: "2026-12-05" },
    });
    await markSold(deps, { ...ids, number: 12, payment: { status: "pagado" } });
    const debts = await listDebts(deps, ids);
    expect(debts.ok && debts.value.map((d) => [d.number, d.dueDate])).toEqual([
      [11, "2026-12-05"],
      [10, "2026-12-20"],
    ]);
    const all = await listAdminTickets(deps, ids);
    expect(all.ok && all.value.find((t) => t.number === 10)?.buyerName).toBe("Ana");
  });

  it("'debe' exige fecha válida", async () => {
    const { deps, raffle } = await setup();
    const ids = { orgId: raffle.orgId, raffleId: raffle.id };
    for (const payment of [
      { status: "debe" },
      { status: "debe", dueDate: "2026-02-30" },
      { status: "otro" },
      null,
    ]) {
      const r = await markSold(deps, { ...ids, number: 1, payment });
      expect(r.ok ? null : r.error.code).toBe("invalid_input");
    }
  });

  it("vender un número apartado conserva el código y registra la transición", async () => {
    const { deps, raffle } = await setup();
    const ids = { orgId: raffle.orgId, raffleId: raffle.id };
    await reserveTickets(deps, { ...pub, numbers: [42] });
    await markSold(deps, { ...ids, number: 42, payment: { status: "pagado" } });
    const rows = await listAdminTickets(deps, ids);
    expect(rows.ok && rows.value[0]).toMatchObject({
      number: 42,
      status: "vendido",
      paymentStatus: "pagado",
      reservationCode: "RF-TEST1",
    });
    const hist = await listHistory(deps, { ...ids, number: 42 });
    expect(hist.ok && hist.value.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual([
      "apartado>vendido",
      "activo>apartado",
    ]);
    // ya no se puede apartar
    expect((await reserveTickets(deps, { ...pub, numbers: [42] })).ok).toBe(false);
  });

  it("cambia de debe a pagado y solo si está vendido", async () => {
    const { deps, raffle } = await setup();
    const ids = { orgId: raffle.orgId, raffleId: raffle.id };
    const notSold = await updatePayment(deps, { ...ids, number: 3, payment: { status: "pagado" } });
    expect(notSold.ok ? null : notSold.error.code).toBe("invalid_state");
    await markSold(deps, { ...ids, number: 3, payment: { status: "debe", dueDate: "2026-12-01" } });
    expect(
      (await updatePayment(deps, { ...ids, number: 3, payment: { status: "pagado" } })).ok,
    ).toBe(true);
    const debts = await listDebts(deps, ids);
    expect(debts.ok && debts.value).toEqual([]);
  });

  it("libera un número y no permite liberar uno ya activo", async () => {
    const { deps, raffle } = await setup();
    const ids = { orgId: raffle.orgId, raffleId: raffle.id };
    await markSold(deps, { ...ids, number: 8, payment: { status: "pagado" } });
    expect((await releaseTicket(deps, { ...ids, number: 8 })).ok).toBe(true);
    const again = await releaseTicket(deps, { ...ids, number: 8 });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
    expect((await reserveTickets(deps, { ...pub, numbers: [8] })).ok).toBe(true);
  });

  it("valida el rango y aísla por organización", async () => {
    const { deps, raffle } = await setup();
    const ids = { orgId: raffle.orgId, raffleId: raffle.id };
    const out = await markSold(deps, { ...ids, number: 100, payment: { status: "pagado" } });
    expect(out.ok ? null : out.error.code).toBe("invalid_input");
    // otra organización no ve ni modifica la rifa
    const other = { orgId: "otra-org", raffleId: raffle.id };
    for (const r of [
      await markSold(deps, { ...other, number: 1, payment: { status: "pagado" } }),
      await releaseTicket(deps, { ...other, number: 1 }),
      await listAdminTickets(deps, other),
      await listHistory(deps, other),
      await setRaffleStatus(deps, { ...other, status: "cerrada" }),
    ]) {
      expect(r.ok ? null : r.error.code).toBe("not_found");
    }
  });
});
