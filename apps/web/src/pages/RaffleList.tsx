import type { AdminRaffle } from "@rifas/contracts";
import { Link } from "wouter-preact";
import { api } from "../api";
import { formatDay, formatMoney } from "../format";
import { Badge, ErrorBox, useAsync } from "../ui";

const statusTone = { borrador: "slate", activa: "green", cerrada: "amber" } as const;

export function RaffleList() {
  const { data, error, loading } = useAsync(() => api.listRaffles(), []);

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-slate-900">Mis rifas</h1>
        <Link
          href="/admin/raffles/new"
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Nueva rifa
        </Link>
      </div>
      <ErrorBox message={error} />
      {loading && <p class="text-sm text-slate-500">Cargando…</p>}
      {data && data.length === 0 && (
        <p class="rounded-xl bg-white p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">
          Aún no tienes rifas. Crea la primera con “Nueva rifa”.
        </p>
      )}
      <ul class="space-y-3">
        {data?.map((r) => (
          <li key={r.id}>
            <RaffleCard raffle={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RaffleCard({ raffle: r }: { raffle: AdminRaffle }) {
  const pct = Math.round(((r.stats.sold + r.stats.reserved) / r.totalNumbers) * 100);
  return (
    <Link
      href={`/admin/raffles/${r.id}`}
      class="block space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-slate-900">{r.title}</h2>
          <p class="text-xs text-slate-500">
            {r.totalNumbers.toLocaleString("es-CO")} números
            {r.drawDate ? ` · sorteo ${formatDay(r.drawDate)}` : ""}
          </p>
        </div>
        <Badge tone={statusTone[r.status]}>{r.status}</Badge>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div class="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <dl class="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="Apartados" value={r.stats.reserved} />
        <Stat label="Vendidos" value={r.stats.sold} />
        <Stat label="Pagados" value={r.stats.paid} />
        <Stat
          label="Deben"
          value={r.stats.owed}
          sub={r.stats.owedAmount !== null ? formatMoney(r.stats.owedAmount) : undefined}
        />
      </dl>
    </Link>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string | undefined }) {
  return (
    <div>
      <dd class="text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
      <dt class="text-slate-500">{label}</dt>
      {sub && <p class="text-rose-700">{sub}</p>}
    </div>
  );
}
