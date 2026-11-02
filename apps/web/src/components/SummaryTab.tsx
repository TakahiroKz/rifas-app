import type { AdminRaffle } from "@rifas/contracts";
import { api } from "../api";
import { activitySummary, barHeights, niceMax } from "../chart";
import { formatDay, formatMoney, plural } from "../format";
import { Button, ErrorBox, useAsync } from "../ui";

const SOLD = "#4f46e5"; // índigo: vendidos (mismo color de acción de la app)
const RESERVED = "#f59e0b"; // ámbar: apartados (igual que en el tablero)

export function SummaryTab({
  raffle,
  version,
  onShowDebts,
}: {
  raffle: AdminRaffle;
  version: number;
  onShowDebts: () => void;
}) {
  const report = useAsync(() => api.getReport(raffle.id), [raffle.id, version]);
  const r = report.data;
  const s = raffle.stats;
  const available = raffle.totalNumbers - s.sold - s.reserved;

  return (
    <div class="space-y-5">
      <ErrorBox message={report.error} />

      {r && r.debts.overdueCount > 0 && (
        <div
          role="alert"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 p-4 ring-1 ring-rose-200"
        >
          <p class="text-sm text-rose-900">
            <b>
              {r.debts.overdueCount}{" "}
              {plural(r.debts.overdueCount, "deuda vencida", "deudas vencidas")}
            </b>
            {r.debts.overdueAmount !== null && (
              <>
                {" "}
                por <b>{formatMoney(r.debts.overdueAmount)}</b>
              </>
            )}
            {r.debts.oldestOverdueDate && (
              <>. La más antigua venció el {formatDay(r.debts.oldestOverdueDate)}</>
            )}
            .
          </p>
          <Button variant="danger" onClick={onShowDebts}>
            Ver deudas
          </Button>
        </div>
      )}

      <section
        aria-label="Avance"
        class="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
      >
        <div class="flex items-baseline justify-between gap-3">
          <p class="text-3xl font-bold tabular-nums text-slate-900">
            {r ? `${r.soldPercent}%` : "—"}
          </p>
          <p class="text-sm text-slate-500">
            {s.sold.toLocaleString("es-CO")} de {raffle.totalNumbers.toLocaleString("es-CO")}{" "}
            vendidos
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuenow={s.sold}
          aria-valuemin={0}
          aria-valuemax={raffle.totalNumbers}
          aria-label="Números vendidos"
          class="flex h-3 overflow-hidden rounded-full bg-slate-100"
        >
          <div style={{ width: `${(s.sold / raffle.totalNumbers) * 100}%`, background: SOLD }} />
          <div
            style={{ width: `${(s.reserved / raffle.totalNumbers) * 100}%`, background: RESERVED }}
          />
        </div>
        <dl class="grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
          <Stat label="Disponibles" value={available} />
          <Stat label="Apartados" value={s.reserved} />
          <Stat label="Vendidos" value={s.sold} />
          <Stat label="Pagados" value={s.paid} />
          <Stat label="Deben" value={s.owed} />
          <Stat label="Vencidas" value={s.overdue} tone={s.overdue > 0 ? "danger" : undefined} />
        </dl>
      </section>

      {raffle.ticketPrice !== null && (
        <section aria-label="Dinero" class="grid grid-cols-3 gap-2 text-center">
          <Money label="Recaudado" value={s.paidAmount} />
          <Money label="Por cobrar" value={s.owedAmount} />
          <Money
            label="Vencido"
            value={s.overdueAmount}
            tone={s.overdue > 0 ? "danger" : undefined}
          />
        </section>
      )}

      <section
        aria-label="Actividad"
        class="space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-slate-800">Actividad de los últimos 30 días</h3>
          <ul class="flex gap-3 text-xs text-slate-600">
            <Key color={SOLD}>Ventas</Key>
            <Key color={RESERVED}>Apartados</Key>
          </ul>
        </div>
        {report.loading && !r && <p class="text-sm text-slate-500">Cargando…</p>}
        {r && <ActivityChart activity={r.activity} />}
      </section>

      <div class="flex flex-wrap items-center gap-3">
        <a
          href={api.exportCsvUrl(raffle.id)}
          download
          class="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Descargar CSV
        </a>
        <p class="text-xs text-slate-500">
          Números apartados y vendidos, con comprador, pago y premios. Se abre en Excel.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | undefined;
}) {
  return (
    <div>
      <dd
        class={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-rose-700" : "text-slate-900"}`}
      >
        {value.toLocaleString("es-CO")}
      </dd>
      <dt class="text-slate-500">{label}</dt>
    </div>
  );
}

function Money({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone?: "danger" | undefined;
}) {
  return (
    <div class="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <p
        class={`text-base font-semibold tabular-nums sm:text-lg ${tone === "danger" ? "text-rose-700" : "text-slate-900"}`}
      >
        {formatMoney(value)}
      </p>
      <p class="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Key({ color, children }: { color: string; children: preact.ComponentChildren }) {
  return (
    <li class="flex items-center gap-1.5">
      <span class="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {children}
    </li>
  );
}

/** "2 nov" a partir de AAAA-MM-DD (cabe en el eje del gráfico). */
const shortDay = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(".", "");
};

const W = 600;
const H = 190;
// Tamaños pensados para que, al escalar el gráfico al ancho de un celular, el texto siga legible.
const FONT = 17;
const PAD = { left: 40, right: 6, top: 10, bottom: 30 };

function ActivityChart({
  activity,
}: {
  activity: { day: string; reserved: number; sold: number }[];
}) {
  const peak = niceMax(Math.max(...activity.map((d) => Math.max(d.sold, d.reserved)), 0));
  const plotH = H - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / activity.length;
  const barW = Math.max(2, slot / 2 - 1.5);
  const soldH = barHeights(
    activity.map((d) => d.sold),
    plotH * (Math.max(...activity.map((d) => d.sold), 0) / peak),
  );
  const resH = barHeights(
    activity.map((d) => d.reserved),
    plotH * (Math.max(...activity.map((d) => d.reserved), 0) / peak),
  );
  const base = H - PAD.bottom;
  const labelAt = [0, Math.floor(activity.length / 2), activity.length - 1];

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={activitySummary(activity)}
        class="h-auto w-full"
      >
        {/* Líneas de referencia y eje Y */}
        {[0, 0.5, 1].map((f) => {
          const y = base - plotH * f;
          return (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                stroke-width="1"
              />
              <text x={PAD.left - 6} y={y + 6} text-anchor="end" font-size={FONT} fill="#64748b">
                {Math.round(peak * f)}
              </text>
            </g>
          );
        })}
        {activity.map((d, i) => {
          const x = PAD.left + i * slot + 1;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${d.sold} ventas, ${d.reserved} apartados`}</title>
              <rect
                x={x}
                y={base - (soldH[i] ?? 0)}
                width={barW}
                height={soldH[i] ?? 0}
                fill={SOLD}
                rx="1.5"
              />
              <rect
                x={x + barW + 1}
                y={base - (resH[i] ?? 0)}
                width={barW}
                height={resH[i] ?? 0}
                fill={RESERVED}
                rx="1.5"
              />
            </g>
          );
        })}
        {labelAt.map((i) => (
          <text
            key={i}
            x={PAD.left + i * slot + slot / 2}
            y={H - 8}
            text-anchor={i === 0 ? "start" : i === activity.length - 1 ? "end" : "middle"}
            font-size={FONT}
            fill="#64748b"
          >
            {activity[i] ? shortDay(activity[i].day) : ""}
          </text>
        ))}
      </svg>
      <table class="sr-only">
        <caption>Actividad diaria</caption>
        <thead>
          <tr>
            <th>Día</th>
            <th>Ventas</th>
            <th>Apartados</th>
          </tr>
        </thead>
        <tbody>
          {activity
            .filter((d) => d.sold + d.reserved > 0)
            .map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.sold}</td>
                <td>{d.reserved}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}
