// Implementación en memoria de los puertos, solo para pruebas unitarias del dominio.
import type { Deps } from "./deps";
import type {
  AuthRepository,
  Clock,
  CodeGenerator,
  DrawResultRepository,
  IdGenerator,
  LotterySource,
  MarkSoldInput,
  OrganizationRepository,
  PrizeRepository,
  RaffleRepository,
  ReserveInput,
  ResolveInput,
  SourceDraw,
  TicketRepository,
  UserWithHash,
} from "./ports";
import { bogotaDate } from "./time";
import type {
  DrawResult,
  Organization,
  PaymentStatus,
  Prize,
  PrizeAttempt,
  PrizeWinner,
  PublicPrize,
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
  rows: (TicketRecord & { orgId: string; reservedBy?: string })[] = [];
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
    if (unavailable.length > 0)
      return { ok: false as const, reason: "unavailable" as const, unavailable };
    const active = this.rows.filter(
      (r) =>
        r.raffleId === i.raffleId &&
        r.status === "apartado" &&
        r.reservedBy === i.clientKey &&
        (r.reservedUntil ?? "") > i.now,
    ).length;
    if (active + i.numbers.length > i.maxActivePerClient)
      return { ok: false as const, reason: "limit" as const };
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
        reservedBy: i.clientKey,
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

  async countByRaffle(orgId: string, now: string, today: string) {
    const map = new Map<
      string,
      { reserved: number; sold: number; paid: number; owed: number; overdue: number }
    >();
    for (const r of this.rows.filter((x) => x.orgId === orgId)) {
      const c = map.get(r.raffleId) ?? { reserved: 0, sold: 0, paid: 0, owed: 0, overdue: 0 };
      if (r.status === "apartado" && (r.reservedUntil ?? "") > now) c.reserved++;
      if (r.status === "vendido") {
        c.sold++;
        if (r.paymentStatus === "pagado") c.paid++;
        if (r.paymentStatus === "debe") {
          c.owed++;
          if (r.dueDate !== null && r.dueDate < today) c.overdue++;
        }
      }
      map.set(r.raffleId, c);
    }
    return map;
  }

  async activityByDay(orgId: string, raffleId: string, sinceDay: string) {
    const days = new Map<string, { day: string; reserved: number; sold: number }>();
    for (const e of this.events.filter((x) => x.orgId === orgId && x.raffleId === raffleId)) {
      const day = bogotaDate(new Date(e.at));
      if (day < sinceDay || (e.action !== "reserve" && e.action !== "sell")) continue;
      const d = days.get(day) ?? { day, reserved: 0, sold: 0 };
      if (e.action === "reserve") d.reserved++;
      else d.sold++;
      days.set(day, d);
    }
    return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
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

export class FakePrizes implements PrizeRepository {
  items: Prize[] = [];
  attempts: (PrizeAttempt & { orgId: string })[] = [];
  winners: (PrizeWinner & { orgId: string })[] = [];
  private nextAttemptId = 1;

  async create(prize: Prize) {
    if (this.items.some((p) => p.raffleId === prize.raffleId && p.place === prize.place)) {
      return { ok: false as const, reason: "place_taken" as const };
    }
    this.items.push({ ...prize });
    return { ok: true as const };
  }
  async findById(orgId: string, prizeId: string) {
    const p = this.items.find((x) => x.orgId === orgId && x.id === prizeId);
    return p ? { ...p } : null;
  }
  async listByRaffle(orgId: string, raffleId: string) {
    return this.items
      .filter((x) => x.orgId === orgId && x.raffleId === raffleId)
      .map((p) => ({ ...p }));
  }
  async update(orgId: string, prizeId: string, patch: Parameters<PrizeRepository["update"]>[2]) {
    const p = this.items.find((x) => x.orgId === orgId && x.id === prizeId);
    if (!p) return false;
    Object.assign(p, patch);
    return true;
  }
  async delete(orgId: string, prizeId: string) {
    const i = this.items.findIndex((x) => x.orgId === orgId && x.id === prizeId);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }
  async listAttempts(orgId: string, prizeId: string) {
    return this.attempts
      .filter((a) => a.orgId === orgId && a.prizeId === prizeId)
      .sort((a, b) => a.attemptNo - b.attemptNo);
  }
  async listWinners(orgId: string, prizeId: string) {
    return this.winners
      .filter((w) => w.orgId === orgId && w.prizeId === prizeId)
      .sort((a, b) => a.number - b.number);
  }
  async resolve(i: ResolveInput) {
    const p = this.items.find((x) => x.orgId === i.orgId && x.id === i.prizeId);
    if (!p || p.status !== "pendiente" || p.drawDate !== i.expectedDrawDate) return false;
    if (this.attempts.some((a) => a.prizeId === i.prizeId && a.attemptNo === i.attemptNo))
      return false;
    const attemptId = this.nextAttemptId++;
    this.attempts.push({
      id: attemptId,
      orgId: i.orgId,
      prizeId: i.prizeId,
      attemptNo: i.attemptNo,
      drawDate: i.expectedDrawDate,
      resultNumber: i.resultNumber,
      outcome: i.outcome,
      createdAt: i.now,
    });
    for (const w of i.winners) {
      this.winners.push({
        orgId: i.orgId,
        prizeId: i.prizeId,
        attemptId,
        number: w.number,
        buyerName: w.buyerName,
        buyerPhone: w.buyerPhone,
        paymentStatus: w.paymentStatus,
      });
    }
    p.status = i.newStatus;
    if (i.nextDrawDate) p.drawDate = i.nextDrawDate;
    return true;
  }
  async listPendingDue(day: string) {
    return this.items
      .filter((p) => p.status === "pendiente" && p.drawDate <= day)
      .map((p) => ({ ...p }));
  }
  async listPublic(raffleId: string): Promise<PublicPrize[]> {
    return this.items
      .filter((p) => p.raffleId === raffleId)
      .sort((a, b) => a.place - b.place)
      .map((p) => {
        const won = this.attempts
          .filter((a) => a.prizeId === p.id && a.outcome === "ganador")
          .at(-1);
        return {
          place: p.place,
          description: p.description,
          lotteryId: p.lotteryId,
          drawDate: p.drawDate,
          status: p.status,
          resultNumber: won?.resultNumber ?? null,
          winningNumbers: won
            ? this.winners
                .filter((w) => w.attemptId === won.id)
                .map((w) => w.number)
                .sort((a, b) => a - b)
            : [],
        };
      });
  }
}

export class FakeResults implements DrawResultRepository {
  items: (DrawResult & { raw?: unknown })[] = [];
  async findOfficial(lotteryId: string, date: string) {
    return (
      this.items.find(
        (r) => r.orgId === null && r.lotteryId === lotteryId && r.drawDate === date,
      ) ?? null
    );
  }
  async findManual(orgId: string, lotteryId: string, date: string) {
    return (
      this.items.find(
        (r) => r.orgId === orgId && r.lotteryId === lotteryId && r.drawDate === date,
      ) ?? null
    );
  }
  async saveOfficial(result: DrawResult & { raw: unknown }) {
    if (await this.findOfficial(result.lotteryId, result.drawDate)) return false;
    this.items.push(result);
    return true;
  }
  async saveManual(result: DrawResult) {
    const i = this.items.findIndex(
      (r) =>
        r.orgId === result.orgId &&
        r.lotteryId === result.lotteryId &&
        r.drawDate === result.drawDate,
    );
    if (i >= 0) this.items.splice(i, 1);
    this.items.push(result);
  }
}

export class FakeSource implements LotterySource {
  enabled = true;
  /** Resultados que "publica" la fuente, por fecha. */
  data = new Map<string, SourceDraw[]>();
  failWith: Error | null = null;
  calls: string[] = [];
  async fetchDraws(date: string) {
    this.calls.push(date);
    if (this.failWith) throw this.failWith;
    return this.data.get(date) ?? [];
  }
  publish(lotteryId: string, drawDate: string, number: string, series = "--1") {
    const list = this.data.get(drawDate) ?? [];
    list.push({ lotteryId, drawDate, number, series, sourceRef: "123", raw: { fake: true } });
    this.data.set(drawDate, list);
  }
}

export function createTestDeps(start = new Date("2026-11-02T15:00:00.000Z")) {
  const clock = new FakeClock(start);
  const orgs = new Orgs();
  const raffles = new Raffles(orgs);
  const tickets = new Tickets();
  const auth = new FakeAuth();
  const prizes = new FakePrizes();
  const results = new FakeResults();
  const source = new FakeSource();
  let n = 0;
  const ids: IdGenerator = { uuid: () => `id-${++n}` };
  let c = 0;
  const codes: CodeGenerator = { reservationCode: () => `RF-TEST${++c}` };
  const deps: Deps = { auth, prizes, results, source, orgs, raffles, tickets, clock, ids, codes };
  return { deps, clock, stores: { orgs, raffles, tickets, auth, prizes, results, source } };
}
