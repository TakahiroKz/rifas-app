import type {
  AuthRepository,
  Clock,
  CodeGenerator,
  IdGenerator,
  MarkSoldInput,
  Organization,
  OrganizationRepository,
  PaymentStatus,
  PublicTicket,
  Raffle,
  RaffleRepository,
  RaffleStatus,
  ReserveInput,
  Session,
  TicketEvent,
  TicketRecord,
  TicketRepository,
  User,
  UserWithHash,
} from "@rifas/core";
import { buildReservationCode } from "@rifas/core";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

// ───────────── Utilidades ─────────────

export const systemClock: Clock = { now: () => new Date() };

export const cryptoIds: IdGenerator = { uuid: () => crypto.randomUUID() };

export const cryptoCodes: CodeGenerator = {
  reservationCode: () => buildReservationCode(crypto.getRandomValues(new Uint8Array(6))),
};

// ───────────── Organizaciones ─────────────

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  whatsapp_phone: string;
  created_at: string;
}

const toOrg = (r: OrgRow): Organization => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  whatsappPhone: r.whatsapp_phone,
  createdAt: r.created_at,
});

export class D1OrganizationRepository implements OrganizationRepository {
  constructor(private db: D1Database) {}

  async create(org: Organization) {
    try {
      await this.db
        .prepare(
          "INSERT INTO organizations (id, name, slug, whatsapp_phone, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(org.id, org.name, org.slug, org.whatsappPhone, org.createdAt)
        .run();
      return { ok: true as const };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false as const, reason: "slug_taken" as const };
      throw error;
    }
  }

  async findBySlug(slug: string) {
    const row = await this.db
      .prepare("SELECT * FROM organizations WHERE slug = ?")
      .bind(slug)
      .first<OrgRow>();
    return row ? toOrg(row) : null;
  }

  async findById(orgId: string) {
    const row = await this.db
      .prepare("SELECT * FROM organizations WHERE id = ?")
      .bind(orgId)
      .first<OrgRow>();
    return row ? toOrg(row) : null;
  }

  async update(orgId: string, patch: { name?: string; whatsappPhone?: string }) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.whatsappPhone !== undefined) {
      sets.push("whatsapp_phone = ?");
      params.push(patch.whatsappPhone);
    }
    if (sets.length === 0) return false;
    const res = await this.db
      .prepare(`UPDATE organizations SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...params, orgId)
      .run();
    return res.meta.changes > 0;
  }
}

// ───────────── Rifas ─────────────

interface RaffleRow {
  id: string;
  org_id: string;
  slug: string;
  title: string;
  description: string;
  total_numbers: number;
  number_width: number;
  ticket_price: number | null;
  status: RaffleStatus;
  draw_date: string | null;
  created_at: string;
}

const toRaffle = (r: RaffleRow): Raffle => ({
  id: r.id,
  orgId: r.org_id,
  slug: r.slug,
  title: r.title,
  description: r.description,
  totalNumbers: r.total_numbers,
  numberWidth: r.number_width,
  ticketPrice: r.ticket_price,
  status: r.status,
  drawDate: r.draw_date,
  createdAt: r.created_at,
});

export class D1RaffleRepository implements RaffleRepository {
  constructor(private db: D1Database) {}

  async create(raffle: Raffle) {
    try {
      await this.db
        .prepare(
          `INSERT INTO raffles (id, org_id, slug, title, description, total_numbers, number_width,
                                ticket_price, status, draw_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          raffle.id,
          raffle.orgId,
          raffle.slug,
          raffle.title,
          raffle.description,
          raffle.totalNumbers,
          raffle.numberWidth,
          raffle.ticketPrice,
          raffle.status,
          raffle.drawDate,
          raffle.createdAt,
        )
        .run();
      return { ok: true as const };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false as const, reason: "slug_taken" as const };
      throw error;
    }
  }

  async findById(orgId: string, raffleId: string) {
    const row = await this.db
      .prepare("SELECT * FROM raffles WHERE org_id = ? AND id = ?")
      .bind(orgId, raffleId)
      .first<RaffleRow>();
    return row ? toRaffle(row) : null;
  }

  async findPublic(orgSlug: string, raffleSlug: string) {
    const org = await this.db
      .prepare("SELECT * FROM organizations WHERE slug = ?")
      .bind(orgSlug)
      .first<OrgRow>();
    if (!org) return null;
    const row = await this.db
      .prepare("SELECT * FROM raffles WHERE org_id = ? AND slug = ?")
      .bind(org.id, raffleSlug)
      .first<RaffleRow>();
    return row ? { organization: toOrg(org), raffle: toRaffle(row) } : null;
  }

  async update(orgId: string, raffleId: string, patch: Parameters<RaffleRepository["update"]>[2]) {
    const columns: [string, unknown][] = [];
    if (patch.title !== undefined) columns.push(["title", patch.title]);
    if (patch.description !== undefined) columns.push(["description", patch.description]);
    if (patch.ticketPrice !== undefined) columns.push(["ticket_price", patch.ticketPrice]);
    if (patch.drawDate !== undefined) columns.push(["draw_date", patch.drawDate]);
    if (patch.status !== undefined) columns.push(["status", patch.status]);
    if (columns.length === 0) return false;
    const res = await this.db
      .prepare(
        `UPDATE raffles SET ${columns.map(([c]) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`,
      )
      .bind(...columns.map(([, v]) => v), orgId, raffleId)
      .run();
    return res.meta.changes > 0;
  }

  async listByOrg(orgId: string) {
    const { results } = await this.db
      .prepare("SELECT * FROM raffles WHERE org_id = ? ORDER BY created_at DESC, id")
      .bind(orgId)
      .all<RaffleRow>();
    return results.map(toRaffle);
  }

  async setStatus(orgId: string, raffleId: string, status: RaffleStatus) {
    const res = await this.db
      .prepare("UPDATE raffles SET status = ? WHERE org_id = ? AND id = ?")
      .bind(status, orgId, raffleId)
      .run();
    return res.meta.changes > 0;
  }
}

// ───────────── Números ─────────────

interface TicketRow {
  raffle_id: string;
  number: number;
  status: "apartado" | "vendido";
  payment_status: PaymentStatus | null;
  due_date: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  note: string | null;
  reservation_code: string | null;
  reserved_at: string | null;
  reserved_until: string | null;
  sold_at: string | null;
  updated_at: string;
}

const toTicket = (r: TicketRow): TicketRecord => ({
  raffleId: r.raffle_id,
  number: r.number,
  status: r.status,
  paymentStatus: r.payment_status,
  dueDate: r.due_date,
  buyerName: r.buyer_name,
  buyerPhone: r.buyer_phone,
  note: r.note,
  reservationCode: r.reservation_code,
  reservedAt: r.reserved_at,
  reservedUntil: r.reserved_until,
  soldAt: r.sold_at,
  updatedAt: r.updated_at,
});

interface EventRow {
  id: number;
  raffle_id: string;
  number: number;
  action: TicketEvent["action"];
  from_status: TicketEvent["fromStatus"];
  to_status: TicketEvent["toStatus"];
  actor: TicketEvent["actor"];
  reservation_code: string | null;
  at: string;
}

const toEvent = (r: EventRow): TicketEvent => ({
  id: r.id,
  raffleId: r.raffle_id,
  number: r.number,
  action: r.action,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  actor: r.actor,
  reservationCode: r.reservation_code,
  at: r.at,
});

const EVENT_COLUMNS =
  "org_id, raffle_id, number, action, from_status, to_status, actor, reservation_code, at";

export class D1TicketRepository implements TicketRepository {
  constructor(private db: D1Database) {}

  /**
   * Persiste la caducidad de los apartados vencidos entre `numbers` (historial + borrado de la fila).
   * Se incluye en los batch de las operaciones que tocan esos números para que un apartado vencido
   * nunca quede "pegado", aunque el Cron no haya corrido.
   */
  private expireStatements(
    raffleId: string,
    numbers: number[],
    now: string,
  ): D1PreparedStatement[] {
    const json = JSON.stringify(numbers);
    return [
      this.db
        .prepare(
          `INSERT INTO ticket_events (${EVENT_COLUMNS})
           SELECT org_id, raffle_id, number, 'expire', 'apartado', 'activo', 'system', reservation_code, ?
             FROM tickets
            WHERE raffle_id = ? AND number IN (SELECT value FROM json_each(?))
              AND status = 'apartado' AND reserved_until <= ?`,
        )
        .bind(now, raffleId, json, now),
      this.db
        .prepare(
          `DELETE FROM tickets
            WHERE raffle_id = ? AND number IN (SELECT value FROM json_each(?))
              AND status = 'apartado' AND reserved_until <= ?`,
        )
        .bind(raffleId, json, now),
    ];
  }

  /**
   * Reserva todo-o-nada. La sentencia de inserción se ejecuta en una sola operación atómica:
   * solo inserta si NINGUNO de los números tiene fila (tras limpiar los apartados vencidos).
   */
  async reserve(i: ReserveInput) {
    const json = JSON.stringify(i.numbers);
    const results = await this.db.batch([
      ...this.expireStatements(i.raffleId, i.numbers, i.now),
      this.db
        .prepare(
          `INSERT INTO tickets (raffle_id, number, org_id, status, reservation_code,
                                reserved_at, reserved_until, updated_at)
           SELECT ?, value, ?, 'apartado', ?, ?, ?, ?
             FROM json_each(?)
            WHERE NOT EXISTS (
              SELECT 1 FROM tickets
               WHERE raffle_id = ? AND number IN (SELECT value FROM json_each(?))
            )`,
        )
        .bind(i.raffleId, i.orgId, i.code, i.now, i.until, i.now, json, i.raffleId, json),
      this.db
        .prepare(
          `INSERT INTO ticket_events (${EVENT_COLUMNS})
           SELECT org_id, raffle_id, number, 'reserve', 'activo', 'apartado', 'public', reservation_code, reserved_at
             FROM tickets
            WHERE raffle_id = ? AND reservation_code = ? AND reserved_at = ? AND status = 'apartado'`,
        )
        .bind(i.raffleId, i.code, i.now),
    ]);

    const inserted = results[2]?.meta.changes ?? 0;
    if (inserted === i.numbers.length) return { ok: true as const };

    const { results: taken } = await this.db
      .prepare(
        `SELECT number FROM tickets
          WHERE raffle_id = ? AND number IN (SELECT value FROM json_each(?))
          ORDER BY number`,
      )
      .bind(i.raffleId, json)
      .all<{ number: number }>();
    return { ok: false as const, unavailable: taken.map((r) => r.number) };
  }

  async markSold(i: MarkSoldInput) {
    const dueDate = i.payment.status === "debe" ? i.payment.dueDate : null;
    const ownsRaffle = "EXISTS (SELECT 1 FROM raffles WHERE id = ? AND org_id = ?)";
    await this.db.batch([
      ...this.expireStatements(i.raffleId, [i.number], i.now),
      this.db
        .prepare(
          `INSERT INTO ticket_events (${EVENT_COLUMNS})
           SELECT ?, ?, ?, 'sell',
                  COALESCE((SELECT status FROM tickets WHERE raffle_id = ? AND number = ?), 'activo'),
                  'vendido', 'admin',
                  (SELECT reservation_code FROM tickets WHERE raffle_id = ? AND number = ?), ?
            WHERE ${ownsRaffle}`,
        )
        .bind(
          i.orgId,
          i.raffleId,
          i.number,
          i.raffleId,
          i.number,
          i.raffleId,
          i.number,
          i.now,
          i.raffleId,
          i.orgId,
        ),
      this.db
        .prepare(
          `INSERT INTO tickets (raffle_id, number, org_id, status, payment_status, due_date,
                                buyer_name, buyer_phone, note, sold_at, updated_at)
           SELECT ?, ?, ?, 'vendido', ?, ?, ?, ?, ?, ?, ?
            WHERE ${ownsRaffle}
           ON CONFLICT (raffle_id, number) DO UPDATE SET
             status = 'vendido',
             payment_status = excluded.payment_status,
             due_date = excluded.due_date,
             buyer_name = COALESCE(excluded.buyer_name, tickets.buyer_name),
             buyer_phone = COALESCE(excluded.buyer_phone, tickets.buyer_phone),
             note = COALESCE(excluded.note, tickets.note),
             reserved_until = NULL,
             sold_at = excluded.sold_at,
             updated_at = excluded.updated_at`,
        )
        .bind(
          i.raffleId,
          i.number,
          i.orgId,
          i.payment.status,
          dueDate,
          i.buyer.name ?? null,
          i.buyer.phone ?? null,
          i.buyer.note ?? null,
          i.now,
          i.now,
          i.raffleId,
          i.orgId,
        ),
    ]);
  }

  async updatePayment(i: Parameters<TicketRepository["updatePayment"]>[0]) {
    const dueDate = i.payment.status === "debe" ? i.payment.dueDate : null;
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO ticket_events (${EVENT_COLUMNS})
           SELECT org_id, raffle_id, number, 'update_payment', 'vendido', 'vendido', 'admin', reservation_code, ?
             FROM tickets
            WHERE raffle_id = ? AND org_id = ? AND number = ? AND status = 'vendido'`,
        )
        .bind(i.now, i.raffleId, i.orgId, i.number),
      this.db
        .prepare(
          `UPDATE tickets SET payment_status = ?, due_date = ?, updated_at = ?
            WHERE raffle_id = ? AND org_id = ? AND number = ? AND status = 'vendido'`,
        )
        .bind(i.payment.status, dueDate, i.now, i.raffleId, i.orgId, i.number),
    ]);
    return (results[1]?.meta.changes ?? 0) > 0;
  }

  async release(i: Parameters<TicketRepository["release"]>[0]) {
    const results = await this.db.batch([
      ...this.expireStatements(i.raffleId, [i.number], i.now),
      this.db
        .prepare(
          `INSERT INTO ticket_events (${EVENT_COLUMNS})
           SELECT org_id, raffle_id, number, 'release', status, 'activo', 'admin', reservation_code, ?
             FROM tickets
            WHERE raffle_id = ? AND org_id = ? AND number = ?`,
        )
        .bind(i.now, i.raffleId, i.orgId, i.number),
      this.db
        .prepare("DELETE FROM tickets WHERE raffle_id = ? AND org_id = ? AND number = ?")
        .bind(i.raffleId, i.orgId, i.number),
    ]);
    return (results[3]?.meta.changes ?? 0) > 0;
  }

  async expireDue(now: string) {
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO ticket_events (${EVENT_COLUMNS})
           SELECT org_id, raffle_id, number, 'expire', 'apartado', 'activo', 'system', reservation_code, ?
             FROM tickets WHERE status = 'apartado' AND reserved_until <= ?`,
        )
        .bind(now, now),
      this.db
        .prepare("DELETE FROM tickets WHERE status = 'apartado' AND reserved_until <= ?")
        .bind(now),
    ]);
    return results[1]?.meta.changes ?? 0;
  }

  async listPublic(raffleId: string, now: string): Promise<PublicTicket[]> {
    const { results } = await this.db
      .prepare(
        `SELECT number, status FROM tickets
          WHERE raffle_id = ? AND NOT (status = 'apartado' AND reserved_until <= ?)
          ORDER BY number`,
      )
      .bind(raffleId, now)
      .all<PublicTicket>();
    return results;
  }

  async listAdmin(
    orgId: string,
    raffleId: string,
    filter: { status?: "apartado" | "vendido"; paymentStatus?: PaymentStatus },
  ) {
    const where = ["org_id = ?", "raffle_id = ?"];
    const params: unknown[] = [orgId, raffleId];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.paymentStatus) {
      where.push("payment_status = ?");
      params.push(filter.paymentStatus);
    }
    const { results } = await this.db
      .prepare(
        `SELECT * FROM tickets WHERE ${where.join(" AND ")}
          ORDER BY due_date IS NULL, due_date, number`,
      )
      .bind(...params)
      .all<TicketRow>();
    return results.map(toTicket);
  }

  async findReservation(orgId: string, raffleId: string, code: string, now: string) {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM tickets
          WHERE org_id = ? AND raffle_id = ? AND reservation_code = ?
            AND status = 'apartado' AND reserved_until > ?
          ORDER BY number`,
      )
      .bind(orgId, raffleId, code, now)
      .all<TicketRow>();
    return results.map(toTicket);
  }

  async countByRaffle(orgId: string, now: string) {
    const { results } = await this.db
      .prepare(
        `SELECT raffle_id,
                SUM(CASE WHEN status = 'apartado' AND reserved_until > ? THEN 1 ELSE 0 END) AS reserved,
                SUM(CASE WHEN status = 'vendido' THEN 1 ELSE 0 END) AS sold,
                SUM(CASE WHEN payment_status = 'pagado' THEN 1 ELSE 0 END) AS paid,
                SUM(CASE WHEN payment_status = 'debe' THEN 1 ELSE 0 END) AS owed
           FROM tickets WHERE org_id = ? GROUP BY raffle_id`,
      )
      .bind(now, orgId)
      .all<{ raffle_id: string; reserved: number; sold: number; paid: number; owed: number }>();
    return new Map(
      results.map((r) => [
        r.raffle_id,
        { reserved: r.reserved, sold: r.sold, paid: r.paid, owed: r.owed },
      ]),
    );
  }

  async listEvents(
    orgId: string,
    raffleId: string,
    options: { number?: number; limit: number; beforeId?: number },
  ) {
    const where = ["org_id = ?", "raffle_id = ?"];
    const params: unknown[] = [orgId, raffleId];
    if (options.number !== undefined) {
      where.push("number = ?");
      params.push(options.number);
    }
    if (options.beforeId !== undefined) {
      where.push("id < ?");
      params.push(options.beforeId);
    }
    params.push(options.limit);
    const { results } = await this.db
      .prepare(`SELECT * FROM ticket_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`)
      .bind(...params)
      .all<EventRow>();
    return results.map(toEvent);
  }
}

// ───────────── Autenticación ─────────────

export class D1AuthRepository implements AuthRepository {
  constructor(private db: D1Database) {}

  async findUserByEmail(email: string): Promise<UserWithHash | null> {
    const row = await this.db
      .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string; email: string; name: string; password_hash: string }>();
    return row
      ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash }
      : null;
  }

  async findMembership(userId: string) {
    const row = await this.db
      .prepare("SELECT org_id, role FROM memberships WHERE user_id = ? ORDER BY rowid LIMIT 1")
      .bind(userId)
      .first<{ org_id: string; role: "owner" | "admin" }>();
    return row ? { orgId: row.org_id, role: row.role } : null;
  }

  async createSession(session: Session) {
    await this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, org_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        session.id,
        session.userId,
        session.orgId,
        session.csrfToken,
        session.createdAt,
        session.expiresAt,
      )
      .run();
  }

  async findSession(id: string) {
    const row = await this.db
      .prepare(
        `SELECT s.id, s.user_id, s.org_id, s.csrf_token, s.created_at, s.expires_at,
                u.email, u.name
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ?`,
      )
      .bind(id)
      .first<{
        id: string;
        user_id: string;
        org_id: string;
        csrf_token: string;
        created_at: string;
        expires_at: string;
        email: string;
        name: string;
      }>();
    if (!row) return null;
    const user: User = { id: row.user_id, email: row.email, name: row.name };
    return {
      id: row.id,
      userId: row.user_id,
      orgId: row.org_id,
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      user,
    };
  }

  async deleteSession(id: string) {
    await this.db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  }

  async deleteExpired(now: string, attemptsBefore: string) {
    await this.db.batch([
      this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      this.db.prepare("DELETE FROM login_attempts WHERE at < ?").bind(attemptsBefore),
    ]);
  }

  async recordFailedLogin(email: string, ip: string, at: string) {
    await this.db
      .prepare("INSERT INTO login_attempts (email, ip, at) VALUES (?, ?, ?)")
      .bind(email, ip, at)
      .run();
  }

  async countFailedLogins(input: { email: string; ip: string; since: string }) {
    const row = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM login_attempts WHERE email = ? AND at >= ?) AS by_email,
           (SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at >= ?) AS by_ip`,
      )
      .bind(input.email, input.since, input.ip, input.since)
      .first<{ by_email: number; by_ip: number }>();
    return { byEmail: row?.by_email ?? 0, byIp: row?.by_ip ?? 0 };
  }

  async clearFailedLogins(email: string) {
    await this.db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
  }
}
