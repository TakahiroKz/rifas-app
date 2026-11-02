import { env } from "cloudflare:test";
import {
  expireReservations,
  listAdminTickets,
  listDebts,
  listHistory,
  listPublicTickets,
  markSold,
  RESERVATION_TTL_MS,
  releaseTicket,
  reserveTickets,
  updatePayment,
} from "@rifas/core";
import { describe, expect, it } from "vitest";
import { makeDeps, seedRaffle } from "./helpers";

const pub = { orgSlug: "finaura", raffleSlug: "navidad" };

async function rows(raffleId: string) {
  const { results } = await env.DB.prepare(
    "SELECT number, status, reservation_code AS code FROM tickets WHERE raffle_id = ? ORDER BY number",
  )
    .bind(raffleId)
    .all<{ number: number; status: string; code: string | null }>();
  return results;
}

describe("D1: apartar", () => {
  it("aparta por 24 h, lista solo no disponibles y deja historial", async () => {
    const { deps, clock } = makeDeps();
    const { raffle, org } = await seedRaffle(deps);
    const r = await reserveTickets(deps, { ...pub, numbers: [23, 7] });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.numbers).toEqual([7, 23]);
    expect(Date.parse(r.value.reservedUntil) - clock.now().getTime()).toBe(RESERVATION_TTL_MS);

    const list = await listPublicTickets(deps, pub);
    expect(list.ok && list.value).toEqual([
      { number: 7, status: "apartado" },
      { number: 23, status: "apartado" },
    ]);
    const hist = await listHistory(deps, { orgId: org.id, raffleId: raffle.id });
    expect(
      hist.ok && hist.value.map((e) => [e.number, e.action, e.fromStatus, e.toStatus, e.actor]),
    ).toEqual([
      [23, "reserve", "activo", "apartado", "public"],
      [7, "reserve", "activo", "apartado", "public"],
    ]);
  });

  it("es todo o nada", async () => {
    const { deps } = makeDeps();
    const { raffle } = await seedRaffle(deps);
    await reserveTickets(deps, { ...pub, numbers: [5] });
    const r = await reserveTickets(deps, { ...pub, numbers: [4, 5, 6] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details).toEqual({ unavailable: [5] });
    expect((await rows(raffle.id)).map((x) => x.number)).toEqual([5]);
  });

  it("CONCURRENCIA: 20 solicitudes por los mismos números → exactamente una gana", async () => {
    const { deps } = makeDeps();
    const { raffle } = await seedRaffle(deps);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveTickets(deps, { ...pub, numbers: [5, 6] })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const stored = await rows(raffle.id);
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((s) => s.code)).size).toBe(1);
    const { results: events } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ticket_events WHERE raffle_id = ? AND action = 'reserve'",
    )
      .bind(raffle.id)
      .all<{ n: number }>();
    expect(events[0]?.n).toBe(2);
  });

  it("CONCURRENCIA: solicitudes solapadas nunca dejan un número en dos reservas ni reservas incompletas", async () => {
    const { deps } = makeDeps();
    let n = 0;
    deps.codes = { reservationCode: () => `RF-C${++n}` };
    const { raffle } = await seedRaffle(deps);
    const requests = [
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
      [7, 8, 9],
      [1, 9],
      [2, 4, 6, 8],
    ];
    const results = await Promise.all(
      requests.map((numbers) => reserveTickets(deps, { ...pub, numbers })),
    );
    const winners = results.flatMap((r) => (r.ok ? [r.value] : []));
    expect(winners.length).toBeGreaterThan(0);
    const stored = await rows(raffle.id);
    // cada reserva ganadora está completa y ningún número pertenece a dos reservas
    for (const w of winners) {
      expect(stored.filter((s) => s.code === w.code).map((s) => s.number)).toEqual(w.numbers);
    }
    expect(stored.length).toBe(winners.reduce((sum, w) => sum + w.numbers.length, 0));
    expect(new Set(stored.map((s) => s.number)).size).toBe(stored.length);
  });
});

describe("D1: expiración", () => {
  it("un apartado vencido se ignora al consultar y se puede volver a apartar (con evento de caducidad)", async () => {
    const { deps, clock } = makeDeps();
    const { raffle, org } = await seedRaffle(deps);
    await reserveTickets(deps, { ...pub, numbers: [9] });
    clock.advance(RESERVATION_TTL_MS - 1);
    expect((await reserveTickets(deps, { ...pub, numbers: [9] })).ok).toBe(false);
    clock.advance(1);
    const list = await listPublicTickets(deps, pub);
    expect(list.ok && list.value).toEqual([]);
    expect((await reserveTickets(deps, { ...pub, numbers: [9] })).ok).toBe(true);
    const hist = await listHistory(deps, { orgId: org.id, raffleId: raffle.id, number: 9 });
    expect(hist.ok && hist.value.map((e) => e.action)).toEqual(["reserve", "expire", "reserve"]);
  });

  it("el cron persiste la caducidad una sola vez", async () => {
    const { deps, clock } = makeDeps();
    const { raffle, org } = await seedRaffle(deps);
    await reserveTickets(deps, { ...pub, numbers: [1, 2] });
    await markSold(deps, {
      orgId: org.id,
      raffleId: raffle.id,
      number: 3,
      payment: { status: "pagado" },
    });
    clock.advance(RESERVATION_TTL_MS);
    expect(await expireReservations(deps)).toBe(2);
    expect(await expireReservations(deps)).toBe(0);
    expect((await rows(raffle.id)).map((x) => [x.number, x.status])).toEqual([[3, "vendido"]]);
    const hist = await listHistory(deps, { orgId: org.id, raffleId: raffle.id, number: 1 });
    expect(hist.ok && hist.value.map((e) => e.action)).toEqual(["expire", "reserve"]);
  });
});

describe("D1: administración", () => {
  it("vende desde apartado conservando el código, gestiona deudas y libera", async () => {
    const { deps } = makeDeps();
    const { raffle, org } = await seedRaffle(deps);
    const ids = { orgId: org.id, raffleId: raffle.id };
    const r = await reserveTickets(deps, { ...pub, numbers: [42] });
    if (!r.ok) throw new Error("reserva");

    await markSold(deps, {
      ...ids,
      number: 42,
      payment: { status: "debe", dueDate: "2026-12-20" },
      buyer: { name: "Ana", phone: "3001112233" },
    });
    await markSold(deps, {
      ...ids,
      number: 10,
      payment: { status: "debe", dueDate: "2026-12-05" },
    });
    await markSold(deps, { ...ids, number: 11, payment: { status: "pagado" } });

    const debts = await listDebts(deps, ids);
    expect(debts.ok && debts.value.map((d) => [d.number, d.dueDate])).toEqual([
      [10, "2026-12-05"],
      [42, "2026-12-20"],
    ]);
    const all = await listAdminTickets(deps, { ...ids, status: "vendido" });
    expect(all.ok && all.value.find((t) => t.number === 42)).toMatchObject({
      buyerName: "Ana",
      reservationCode: r.value.code,
      paymentStatus: "debe",
      reservedUntil: null,
    });
    expect((await reserveTickets(deps, { ...pub, numbers: [42] })).ok).toBe(false);

    expect(
      (await updatePayment(deps, { ...ids, number: 42, payment: { status: "pagado" } })).ok,
    ).toBe(true);
    const after = await listDebts(deps, ids);
    expect(after.ok && after.value.map((d) => d.number)).toEqual([10]);

    expect((await releaseTicket(deps, { ...ids, number: 42 })).ok).toBe(true);
    expect((await releaseTicket(deps, { ...ids, number: 42 })).ok).toBe(false);
    expect((await reserveTickets(deps, { ...pub, numbers: [42] })).ok).toBe(true);

    const hist = await listHistory(deps, { ...ids, number: 42 });
    expect(hist.ok && hist.value.map((e) => `${e.action}:${e.fromStatus}>${e.toStatus}`)).toEqual([
      "reserve:activo>apartado",
      "release:vendido>activo",
      "update_payment:vendido>vendido",
      "sell:apartado>vendido",
      "reserve:activo>apartado",
    ]);
  });

  it("paginación del historial por beforeId", async () => {
    const { deps } = makeDeps();
    const { raffle, org } = await seedRaffle(deps);
    await reserveTickets(deps, { ...pub, numbers: [1, 2, 3, 4, 5] });
    const ids = { orgId: org.id, raffleId: raffle.id };
    const p1 = await listHistory(deps, { ...ids, limit: 2 });
    if (!p1.ok) throw new Error("p1");
    expect(p1.value).toHaveLength(2);
    const p2 = await listHistory(deps, { ...ids, limit: 2, beforeId: p1.value[1]?.id as number });
    expect(p2.ok && p2.value).toHaveLength(2);
    expect(p2.ok && p2.value[0]?.id).toBeLessThan(p1.value[1]?.id as number);
  });
});

describe("D1: multi-tenant y restricciones", () => {
  it("una organización no puede tocar los números de otra, ni siquiera saltándose el caso de uso", async () => {
    const { deps } = makeDeps();
    const a = await seedRaffle(deps, { orgSlug: "org-a" });
    const b = await seedRaffle(deps, { orgSlug: "org-b" });

    // Caso de uso: la rifa de A no existe para B.
    const viaUseCase = await markSold(deps, {
      orgId: b.org.id,
      raffleId: a.raffle.id,
      number: 1,
      payment: { status: "pagado" },
    });
    expect(viaUseCase.ok).toBe(false);

    // Repositorio directo: la guarda SQL impide escribir en una rifa ajena.
    await deps.tickets.markSold({
      orgId: b.org.id,
      raffleId: a.raffle.id,
      number: 1,
      payment: { status: "pagado" },
      buyer: {},
      now: "2026-11-02T15:00:00.000Z",
    });
    expect(await rows(a.raffle.id)).toEqual([]);
    expect(
      await deps.tickets.release({ orgId: b.org.id, raffleId: a.raffle.id, number: 1, now: "x" }),
    ).toBe(false);
    expect(await deps.tickets.listAdmin(b.org.id, a.raffle.id, {})).toEqual([]);
    expect(await deps.tickets.listEvents(b.org.id, a.raffle.id, { limit: 10 })).toEqual([]);
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ticket_events WHERE raffle_id = ?",
    )
      .bind(a.raffle.id)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it("los slugs de rifa son únicos por organización, no globales", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps, { orgSlug: "org-a", raffleSlug: "navidad" });
    await expect(
      seedRaffle(deps, { orgSlug: "org-b", raffleSlug: "navidad" }),
    ).resolves.toBeDefined();
    await expect(seedRaffle(deps, { orgSlug: "org-a", raffleSlug: "otra" })).rejects.toThrow(
      /Ya existe/,
    );
  });

  it("la base de datos rechaza estados inconsistentes", async () => {
    const { deps } = makeDeps();
    const { raffle, org } = await seedRaffle(deps);
    const insert = (status: string, payment: string | null, due: string | null) =>
      env.DB.prepare(
        "INSERT INTO tickets (raffle_id, number, org_id, status, payment_status, due_date, reserved_until, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, 'x')",
      )
        .bind(raffle.id, org.id, status, payment, due, status === "apartado" ? "x" : null)
        .run();
    await expect(insert("vendido", null, null)).rejects.toThrow();
    await expect(insert("vendido", "debe", null)).rejects.toThrow();
    await expect(insert("apartado", "pagado", null)).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO raffles (id, org_id, slug, title, total_numbers, number_width, status, created_at) VALUES ('x', ?, 'x', 'x', 10001, 4, 'activa', 'x')",
      )
        .bind(org.id)
        .run(),
    ).rejects.toThrow();
  });
});

describe("D1: rifas de 10 000 números", () => {
  it("aparta extremos 0000 y 9999", async () => {
    const { deps } = makeDeps();
    await seedRaffle(deps, { total: 10_000 });
    const r = await reserveTickets(deps, { ...pub, numbers: [0, 9999] });
    expect(r.ok && r.value.numbers).toEqual([0, 9999]);
    expect((await reserveTickets(deps, { ...pub, numbers: [10_000] })).ok).toBe(false);
  });
});
