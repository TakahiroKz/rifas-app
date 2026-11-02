import { getRaffleWithStats } from "./admin";
import type { Deps } from "./deps";
import { ok, type Result } from "./result";
import { addDays, bogotaDate } from "./time";
import type { RaffleWithStats } from "./types";

export interface DayActivity {
  day: string;
  reserved: number;
  sold: number;
}

export interface DebtSummary {
  /** Deudas cuya fecha de pago ya pasó. */
  overdueCount: number;
  overdueAmount: number | null;
  /** Fecha de pago más antigua vencida (la más urgente). */
  oldestOverdueDate: string | null;
  /** Próxima fecha de pago por llegar (hoy o después). */
  nextDueDate: string | null;
}

export interface RaffleReport {
  raffle: RaffleWithStats;
  /** Últimos `days` días, incluido hoy, con ceros donde no hubo movimiento. */
  activity: DayActivity[];
  debts: DebtSummary;
  /** Porcentaje de números vendidos (0–100). */
  soldPercent: number;
}

export const REPORT_DAYS = 30;

/** Resumen de una rifa para el panel: avance, actividad por día y deudas vencidas. */
export async function getRaffleReport(
  deps: Deps,
  input: { orgId: string; raffleId: string; days?: number },
): Promise<Result<RaffleReport>> {
  const base = await getRaffleWithStats(deps, input);
  if (!base.ok) return base;
  const raffle = base.value;

  const today = bogotaDate(deps.clock.now());
  const days = Math.min(Math.max(input.days ?? REPORT_DAYS, 1), 90);
  const since = addDays(today, -(days - 1));

  const found = await deps.tickets.activityByDay(input.orgId, input.raffleId, since);
  const byDay = new Map(found.map((d) => [d.day, d]));
  const activity: DayActivity[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(since, i);
    activity.push(byDay.get(day) ?? { day, reserved: 0, sold: 0 });
  }

  const debts = await deps.tickets.listAdmin(input.orgId, input.raffleId, {
    status: "vendido",
    paymentStatus: "debe",
  });
  const due = debts.flatMap((t) => (t.dueDate ? [t.dueDate] : [])).sort();
  const overdue = due.filter((d) => d < today);

  return ok({
    raffle,
    activity,
    debts: {
      overdueCount: overdue.length,
      overdueAmount: raffle.ticketPrice === null ? null : overdue.length * raffle.ticketPrice,
      oldestOverdueDate: overdue[0] ?? null,
      nextDueDate: due.find((d) => d >= today) ?? null,
    },
    soldPercent: Math.round((raffle.stats.sold / raffle.totalNumbers) * 1000) / 10,
  });
}
