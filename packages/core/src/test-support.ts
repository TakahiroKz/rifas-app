// Implementación en memoria de los puertos, solo para pruebas unitarias del dominio.
import type { Deps } from "./deps";
import type {
  AuthRepository,
  Clock,
  CodeGenerator,
  IdGenerator,
  MarkSoldInput,
  OrganizationRepository,
  RaffleRepository,
  ReserveInput,
  TicketRepository,
  UserWithHash,
} from "./ports";
import type {
  Organization,
  PaymentStatus,
  PublicTicket,
  Raffle,
  Session,
  TicketEvent,
  TicketRecord,
  User,
} from "./types";

export class FakeClock implements Clock {
  constructor(public current: Date) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class Orgs implements OrganizationRepository {
  items: Organization[] = [];
  async create(org: Organization) {
    if (this.items.some((o) => o.slug === org.slug))
      return { ok: false as const, reason: "slug_taken" as const };
    this.items.push(org);
    return { ok: true as const };
  }
  async findBySlug(slug: string) {
    return this.items.find((o) => o.slug === slug) ?? null;
  }
  async findById(orgId: string) {
    return this.items.find((o) => o.id === orgId) ?? null;
  }
  async update(orgId: string, patch: { name?: string; whatsappPhone?: string }) {
    const org = this.items.find((o) => o.id === orgId);
    if (!org) return false;
    if (patch.name !== undefined) org.name = patch.name;
    if (patch.whatsappPhone !== undefined) org.whatsappPhone = patch.whatsappPhone;
    return true;
  }
}

class Raffles implements RaffleRepository {
  items: Raffle[] = [];
  constructor(private orgs: Orgs) {}
  async create(raffle: Raffle) {
    if (this.items.some((r) => r.orgId === raffle.orgId && r.slug === raffle.slug)) {
      return { ok: false as const, reason: "slug_taken" as const };
    }
    this.items.push(raffle);
    return { ok: true as const };
  }
  async findById(orgId: string, raffleId: string) {
    return this.items.find((r) => r.orgId === orgId && r.id === raffleId) ?? null;
  }
  async findPublic(orgSlug: string, raffleSlug: string) {
    const organization = this.orgs.items.find((o) => o.slug === orgSlug);
    const raffle = organization
      ? this.items.find((r) => r.orgId === organization.id && r.slug === raffleSlug)
      : undefined;
    return organization && raffle ? { organization, raffle } : null;
  }
  async update(orgId: string, raffleId: string, patch: Parameters<RaffleRepository["update"]>[2]) {
    const raffle = await this.findById(orgId, raffleId);
    if (!raffle) return false;
    Object.assign(raffle, patch);
    return true;
  }
  async listByOrg(orgId: string) {
    return this.items.filter((r) => r.orgId === orgId);
  }
  async setStatus(orgId: string, raffleId: string, status: Raffle["status"]) {
    const raffle = await this.findById(orgId, raffleId);
    if (!raffle) return false;
    raffle.status = status;
    return true;
  }
}

class Tickets implements TicketRepository {
  rows: (TicketRecord & { orgId: string })[] = [];
  events: (TicketEvent & { orgId: string })[] = [];
  private nextId = 1;

  private log(
    row: { orgId: string; raffleId: string; number: number; reservationCode?: string | null },
    e: Pick<TicketEvent, "action" | "fromStatus" | "toStatus" | "actor" | "at">,
  ) {
    this.events.push({
      id: this.nextId++,
      orgId: row.orgId,
      raffleId: row.raffleId,
      number: row.number,
      reservationCode: row.reservationCode ?? null,
      ...e,
    });
  }

  private find(raffleId: string, number: number) {
    return this.rows.find((r) => r.raffleId === raffleId && r.number === number);
  }

  private expireRows(now: string, only?: { raffleId: string; numbers: number[] }) {
    let count = 0;
    for (const row of [...this.rows]) {
      const inScope =
        !only || (row.raffleId === only.raffleId && only.numbers.includes(row.number));
      if (inScope && row.status === "apartado" && (row.reservedUntil ?? "") <= now) {
        this.log(row, {
          action: "expire",
          fromStatus: "apartado",
          toStatus: "activo",
          actor: "system",
          at: now,
        });
        this.rows.splice(this.rows.indexOf(row), 1);
        count++;
      }
    }
    return count;
  }

  async reserve(i: ReserveInput) {
    this.expireRows(i.now, { raffleId: i.raffleId, numbers: i.numbers });
    const unavailable = i.numbers.filter((n) => this.find(i.raffleId, n));
    if (unavailable.length > 0) return { ok: false as const, unavailable };
    for (const number of i.numbers) {
      this.rows.push({
        orgId: i.orgId,
        raffleId: i.raffleId,
        number,
        status: "apartado",
        paymentStatus: null,
        dueDate: null,
        buyerName: null,
        buyerPhone: null,
        note: null,
        reservationCode: i.code,
        reservedAt: i.now,
        reservedUntil: i.until,
        soldAt: null,
        updatedAt: i.now,
      });
      this.log(
        { orgId: i.orgId, raffleId: i.raffleId, number, reservationCode: i.code },
        {
          action: "reserve",
          fromStatus: "activo",
          toStatus: "apartado",
          actor: "public",
          at: i.now,
        },
      );
    }
    return { ok: true as const };
  }

  async markSold(i: MarkSoldInput) {
    const prev = this.find(i.raffleId, i.number);
    this.log(
      {
        orgId: i.orgId,
        raffleId: i.raffleId,
        number: i.number,
        reservationCode: prev?.reservationCode ?? null,
      },
      {
        action: "sell",
        fromStatus: prev?.status ?? "activo",
        toStatus: "vendido",
        actor: "admin",
        at: i.now,
      },
    );
    const row: TicketRecord & { orgId: string } = {
      orgId: i.orgId,
      raffleId: i.raffleId,
      number: i.number,
      status: "vendido",
      paymentStatus: i.payment.status,
      dueDate: i.payment.status === "debe" ? i.payment.dueDate : null,
      buyerName: i.buyer.name ?? prev?.buyerName ?? null,
      buyerPhone: i.buyer.phone ?? prev?.buyerPhone ?? null,
      note: i.buyer.note ?? prev?.note ?? null,
      reservationCode: prev?.reservationCode ?? null,
      reservedAt: prev?.reservedAt ?? null,
      reservedUntil: null,
      soldAt: i.now,
      updatedAt: i.now,
    };
    if (prev) this.rows.splice(this.rows.indexOf(prev), 1);
    this.rows.push(row);
  }

  async updatePayment(i: Parameters<TicketRepository["updatePayment"]>[0]) {
    const row = this.find(i.raffleId, i.number);
    if (!row || row.orgId !== i.orgId || row.status !== "vendido") return false;
    this.log(row, {
      action: "update_payment",
      fromStatus: "vendido",
      toStatus: "vendido",
      actor: "admin",
      at: i.now,
    });
    row.paymentStatus = i.payment.status;
    row.dueDate = i.payment.status === "debe" ? i.payment.dueDate : null;
    row.updatedAt = i.now;
    return true;
  }

  async release(i: Parameters<TicketRepository["release"]>[0]) {
    const row = this.find(i.raffleId, i.number);
    if (!row || row.orgId !== i.orgId) return false;
    this.log(row, {
      action: "release",
      fromStatus: row.status,
      toStatus: "activo",
      actor: "admin",
      at: i.now,
    });
    this.rows.splice(this.rows.indexOf(row), 1);
    return true;
  }

  async expireDue(now: string) {
    return this.expireRows(now);
  }

  async listPublic(raffleId: string, now: string): Promise<PublicTicket[]> {
    return this.rows
      .filter(
        (r) =>
          r.raffleId === raffleId && !(r.status === "apartado" && (r.reservedUntil ?? "") <= now),
      )
      .map((r) => ({ number: r.number, status: r.status }))
      .sort((a, b) => a.number - b.number);
  }

  async listAdmin(
    orgId: string,
    raffleId: string,
    filter: { status?: "apartado" | "vendido"; paymentStatus?: PaymentStatus },
  ) {
    return this.rows
      .filter((r) => r.orgId === orgId && r.raffleId === raffleId)
      .filter((r) => !filter.status || r.status === filter.status)
      .filter((r) => !filter.paymentStatus || r.paymentStatus === filter.paymentStatus)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.number - b.number);
  }

  async findReservation(orgId: string, raffleId: string, code: string, now: string) {
    return this.rows.filter(
      (r) =>
        r.orgId === orgId &&
        r.raffleId === raffleId &&
        r.status === "apartado" &&
        r.reservationCode === code &&
        (r.reservedUntil ?? "") > now,
    );
  }

  async countByRaffle(orgId: string, now: string) {
    const map = new Map<string, { reserved: number; sold: number; paid: number; owed: number }>();
    for (const r of this.rows.filter((x) => x.orgId === orgId)) {
      const c = map.get(r.raffleId) ?? { reserved: 0, sold: 0, paid: 0, owed: 0 };
      if (r.status === "apartado" && (r.reservedUntil ?? "") > now) c.reserved++;
      if (r.status === "vendido") {
        c.sold++;
        if (r.paymentStatus === "pagado") c.paid++;
        if (r.paymentStatus === "debe") c.owed++;
      }
      map.set(r.raffleId, c);
    }
    return map;
  }

  async listEvents(
    orgId: string,
    raffleId: string,
    o: { number?: number; limit: number; beforeId?: number },
  ) {
    return this.events
      .filter((e) => e.orgId === orgId && e.raffleId === raffleId)
      .filter((e) => o.number === undefined || e.number === o.number)
      .filter((e) => o.beforeId === undefined || e.id < o.beforeId)
      .sort((a, b) => b.id - a.id)
      .slice(0, o.limit);
  }
}

export class FakeAuth implements AuthRepository {
  users: (UserWithHash & { orgId: string; role: "owner" | "admin" })[] = [];
  sessions: Session[] = [];
  failures: { email: string; ip: string; at: string }[] = [];
  async findUserByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async findMembership(userId: string) {
    const u = this.users.find((x) => x.id === userId);
    return u ? { orgId: u.orgId, role: u.role } : null;
  }
  async createSession(session: Session) {
    this.sessions.push(session);
  }
  async findSession(id: string) {
    const session = this.sessions.find((x) => x.id === id);
    const u = session && this.users.find((x) => x.id === session.userId);
    if (!session || !u) return null;
    const user: User = { id: u.id, email: u.email, name: u.name };
    return { ...session, user };
  }
  async deleteSession(id: string) {
    this.sessions = this.sessions.filter((x) => x.id !== id);
  }
  async deleteExpired(now: string, attemptsBefore: string) {
    this.sessions = this.sessions.filter((x) => x.expiresAt > now);
    this.failures = this.failures.filter((f) => f.at >= attemptsBefore);
  }
  async recordFailedLogin(email: string, ip: string, at: string) {
    this.failures.push({ email, ip, at });
  }
  async countFailedLogins(i: { email: string; ip: string; since: string }) {
    const recent = this.failures.filter((f) => f.at >= i.since);
    return {
      byEmail: recent.filter((f) => f.email === i.email).length,
      byIp: recent.filter((f) => f.ip === i.ip).length,
    };
  }
  async clearFailedLogins(email: string) {
    this.failures = this.failures.filter((f) => f.email !== email);
  }
}

export function createTestDeps(start = new Date("2026-11-02T15:00:00.000Z")) {
  const clock = new FakeClock(start);
  const orgs = new Orgs();
  const raffles = new Raffles(orgs);
  const tickets = new Tickets();
  const auth = new FakeAuth();
  let n = 0;
  const ids: IdGenerator = { uuid: () => `id-${++n}` };
  let c = 0;
  const codes: CodeGenerator = { reservationCode: () => `RF-TEST${++c}` };
  const deps: Deps = { auth, orgs, raffles, tickets, clock, ids, codes };
  return { deps, clock, stores: { orgs, raffles, tickets, auth } };
}
