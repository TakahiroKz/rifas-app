import { describe, expect, it } from "vitest";
import {
  findReservation,
  getRaffleWithStats,
  listRafflesWithStats,
  sellReservation,
  updateOrganization,
  updateRaffle,
} from "./admin";
import { authenticate, login, logout, MAX_FAILED_BY_EMAIL, SESSION_TTL_MS } from "./auth";
import { RESERVATION_TTL_MS } from "./constants";
import { createOrganization } from "./organizations";
import { hashPassword, verifyPassword } from "./password";
import { createRaffle } from "./raffles";
import { hashToken } from "./session-token";
import { createTestDeps } from "./test-support";
import { markSold, reserveTickets } from "./tickets";

describe("contraseñas", () => {
  it("verifica la correcta y rechaza la incorrecta", async () => {
    const hash = await hashPassword("una-clave-larga-123");
    expect(hash).toMatch(/^pbkdf2\$100000\$/);
    expect(await verifyPassword("una-clave-larga-123", hash)).toBe(true);
    expect(await verifyPassword("otra-clave", hash)).toBe(false);
  });
  it("usa una sal distinta cada vez y rechaza formatos inválidos", async () => {
    expect(await hashPassword("x1234567890")).not.toBe(await hashPassword("x1234567890"));
    for (const bad of ["", "abc", "md5$1$a$b", "pbkdf2$0$a$b", "pbkdf2$100000$$"]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });
});

async function setup() {
  const t = createTestDeps();
  const org = await createOrganization(t.deps, {
    name: "Capital Finaura",
    slug: "finaura",
    whatsappPhone: "573045235606",
  });
  if (!org.ok) throw new Error("org");
  t.stores.auth.users.push({
    id: "u1",
    email: "leo@example.com",
    name: "Leo",
    passwordHash: await hashPassword("clave-correcta-1"),
    orgId: org.value.id,
    role: "owner",
  });
  const raffle = await createRaffle(t.deps, {
    orgId: org.value.id,
    slug: "navidad",
    title: "Rifa de Navidad",
    totalNumbers: 100,
    ticketPrice: 10000,
    status: "activa",
  });
  if (!raffle.ok) throw new Error("raffle");
  return { ...t, org: org.value, raffle: raffle.value };
}
const creds = { email: "leo@example.com", password: "clave-correcta-1", ip: "1.1.1.1" };

describe("sesiones", () => {
  it("login correcto crea sesión; el token no se guarda, solo su hash", async () => {
    const { deps, stores, org } = await setup();
    const r = await login(deps, { ...creds, email: "  LEO@Example.com " });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.organization.id).toBe(org.id);
    expect(stores.auth.sessions).toHaveLength(1);
    expect(stores.auth.sessions[0]?.id).toBe(await hashToken(r.value.token));
    expect(stores.auth.sessions[0]?.id).not.toBe(r.value.token);

    const me = await authenticate(deps, r.value.token);
    expect(me.ok && me.value.user.email).toBe("leo@example.com");
    expect(me.ok && me.value.csrfToken).toBe(r.value.csrfToken);
  });

  it("credenciales incorrectas o correo inexistente dan el mismo error", async () => {
    const { deps } = await setup();
    const wrong = await login(deps, { ...creds, password: "mala" });
    const unknown = await login(deps, { ...creds, email: "nadie@example.com" });
    expect(wrong.ok || unknown.ok).toBe(false);
    if (!wrong.ok && !unknown.ok) expect(wrong.error).toEqual(unknown.error);
    const bad = await login(deps, { email: 1, password: null, ip: "x" });
    expect(bad.ok ? null : bad.error.code).toBe("invalid_input");
  });

  it("bloquea tras 5 fallos y se libera con el tiempo; un acierto limpia los fallos", async () => {
    const { deps, clock } = await setup();
    for (let i = 0; i < MAX_FAILED_BY_EMAIL; i++) await login(deps, { ...creds, password: "mala" });
    const locked = await login(deps, creds);
    expect(locked.ok ? null : locked.error.code).toBe("too_many_attempts");
    clock.advance(15 * 60 * 1000 + 1);
    expect((await login(deps, creds)).ok).toBe(true);

    for (let i = 0; i < 3; i++) await login(deps, { ...creds, password: "mala" });
    expect((await login(deps, creds)).ok).toBe(true);
    for (let i = 0; i < 3; i++) await login(deps, { ...creds, password: "mala" });
    expect((await login(deps, creds)).ok).toBe(true); // los 3 anteriores se borraron al ingresar bien
  });

  it("la sesión caduca a los 7 días y logout la invalida", async () => {
    const { deps, clock } = await setup();
    const r = await login(deps, creds);
    if (!r.ok) throw new Error("login");
    clock.advance(SESSION_TTL_MS - 1);
    expect((await authenticate(deps, r.value.token)).ok).toBe(true);
    clock.advance(1);
    expect((await authenticate(deps, r.value.token)).ok).toBe(false);

    const again = await login(deps, creds);
    if (!again.ok) throw new Error("login2");
    await logout(deps, again.value.token);
    expect((await authenticate(deps, again.value.token)).ok).toBe(false);
    expect((await authenticate(deps, undefined)).ok).toBe(false);
    expect((await authenticate(deps, "inventado")).ok).toBe(false);
  });
});

describe("administración de rifas", () => {
  it("estadísticas por rifa con montos", async () => {
    const { deps, org, raffle } = await setup();
    const ids = { orgId: org.id, raffleId: raffle.id };
    await reserveTickets(deps, {
      orgSlug: "finaura",
      clientId: "c1",
      raffleSlug: "navidad",

      numbers: [1, 2],
    });
    await markSold(deps, { ...ids, number: 10, payment: { status: "pagado" } });
    await markSold(deps, {
      ...ids,
      number: 11,
      payment: { status: "debe", dueDate: "2026-12-01" },
    });
    await markSold(deps, {
      ...ids,
      number: 12,
      payment: { status: "debe", dueDate: "2026-12-02" },
    });

    const detail = await getRaffleWithStats(deps, ids);
    expect(detail.ok && detail.value.stats).toEqual({
      reserved: 2,
      sold: 3,
      paid: 1,
      owed: 2,
      overdue: 0,
      soldAmount: 30000,
      paidAmount: 10000,
      owedAmount: 20000,
      overdueAmount: 0,
    });
    const list = await listRafflesWithStats(deps, { orgId: org.id });
    expect(list).toHaveLength(1);
    expect(list[0]?.stats.sold).toBe(3);
  });

  it("los apartados vencidos no cuentan como apartados", async () => {
    const { deps, clock, org, raffle } = await setup();
    await reserveTickets(deps, {
      orgSlug: "finaura",
      clientId: "c1",
      raffleSlug: "navidad",

      numbers: [1],
    });
    clock.advance(RESERVATION_TTL_MS);
    const d = await getRaffleWithStats(deps, { orgId: org.id, raffleId: raffle.id });
    expect(d.ok && d.value.stats.reserved).toBe(0);
  });

  it("edita una rifa con validaciones y sin cruzar organizaciones", async () => {
    const { deps, org, raffle } = await setup();
    const ids = { orgId: org.id, raffleId: raffle.id };
    expect(
      (
        await updateRaffle(deps, {
          ...ids,
          title: "Rifa 2026",
          ticketPrice: 5000,
          drawDate: "2026-12-24",
          status: "cerrada",
        })
      ).ok,
    ).toBe(true);
    const d = await getRaffleWithStats(deps, ids);
    expect(d.ok && d.value).toMatchObject({
      title: "Rifa 2026",
      ticketPrice: 5000,
      drawDate: "2026-12-24",
      status: "cerrada",
    });
    for (const bad of [
      { title: "x" },
      { ticketPrice: -5 },
      { drawDate: "2026-02-30" },
      { status: "otra" as never },
      {},
    ]) {
      const r = await updateRaffle(deps, { ...ids, ...bad });
      expect(r.ok ? null : r.error.code).toBe("invalid_input");
    }
    const other = await updateRaffle(deps, {
      orgId: "otra",
      raffleId: raffle.id,
      title: "Hackeada",
    });
    expect(other.ok ? null : other.error.code).toBe("not_found");
    expect((await getRaffleWithStats(deps, { orgId: "otra", raffleId: raffle.id })).ok).toBe(false);
  });

  it("edita la organización (teléfono de WhatsApp) con validación", async () => {
    const { deps, org } = await setup();
    const ok = await updateOrganization(deps, { orgId: org.id, whatsappPhone: "573001112233" });
    expect(ok.ok && ok.value.whatsappPhone).toBe("573001112233");
    const bad = await updateOrganization(deps, { orgId: org.id, whatsappPhone: "+57300" });
    expect(bad.ok ? null : bad.error.code).toBe("invalid_input");
  });

  it("vende todos los números de un apartado a partir de su código", async () => {
    const { deps, org, raffle } = await setup();
    const ids = { orgId: org.id, raffleId: raffle.id };
    const r = await reserveTickets(deps, {
      orgSlug: "finaura",
      clientId: "c1",
      raffleSlug: "navidad",
      numbers: [4, 5, 6],
    });
    if (!r.ok) throw new Error("reserva");
    const found = await findReservation(deps, { ...ids, code: ` ${r.value.code.toLowerCase()} ` });
    expect(found.ok && found.value.numbers).toEqual([4, 5, 6]);

    const sold = await sellReservation(deps, {
      ...ids,
      code: r.value.code,
      payment: { status: "debe", dueDate: "2026-12-10" },
      buyer: { name: "Ana" },
    });
    expect(sold.ok && sold.value.numbers).toEqual([4, 5, 6]);
    // ya no hay apartado vigente con ese código
    expect((await findReservation(deps, { ...ids, code: r.value.code })).ok).toBe(false);
    expect(
      (await sellReservation(deps, { ...ids, code: "RF-NOEXIS", payment: { status: "pagado" } }))
        .ok,
    ).toBe(false);
    // fecha inválida: no vende nada
    const r2 = await reserveTickets(deps, {
      orgSlug: "finaura",
      clientId: "c1",
      raffleSlug: "navidad",
      numbers: [7],
    });
    if (!r2.ok) throw new Error("reserva2");
    const bad = await sellReservation(deps, {
      ...ids,
      code: r2.value.code,
      payment: { status: "debe" },
    });
    expect(bad.ok).toBe(false);
    expect((await findReservation(deps, { ...ids, code: r2.value.code })).ok).toBe(true);
  });
});
