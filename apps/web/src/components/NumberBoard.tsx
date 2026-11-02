import type { AdminRaffle, AdminTicket } from "@rifas/contracts";
import { useMemo, useState } from "preact/hooks";
import { formatTicket, todayBogota } from "../format";
import { type TicketView, viewOf } from "../ticket-status";
import { Button, inputClass } from "../ui";

const PAGE_SIZE = 200;

const cellClass: Record<TicketView["kind"], string> = {
  activo: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  apartado: "border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200",
  pagado: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
  debe: "border-rose-500 bg-rose-100 text-rose-900 hover:bg-rose-200",
};

const labels: Record<TicketView["kind"], string> = {
  activo: "Activo",
  apartado: "Apartado",
  pagado: "Vendido · pagado",
  debe: "Vendido · debe",
};

export function Legend() {
  return (
    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {(Object.keys(cellClass) as TicketView["kind"][]).map((k) => (
        <li key={k} class="flex items-center gap-1.5">
          <span
            class={`inline-block h-3 w-3 rounded border ${cellClass[k].split(" ").slice(0, 2).join(" ")}`}
          />
          {labels[k]}
        </li>
      ))}
    </ul>
  );
}

export function NumberBoard({
  raffle,
  tickets,
  onSelect,
}: {
  raffle: AdminRaffle;
  tickets: AdminTicket[];
  onSelect: (number: number) => void;
}) {
  const [page, setPage] = useState(0);
  const [jump, setJump] = useState("");
  const pages = Math.ceil(raffle.totalNumbers / PAGE_SIZE);
  const byNumber = useMemo(() => new Map(tickets.map((t) => [t.number, t])), [tickets]);
  const now = new Date();
  const today = todayBogota(now);

  const first = page * PAGE_SIZE;
  const last = Math.min(first + PAGE_SIZE, raffle.totalNumbers) - 1;
  const w = raffle.numberWidth;

  function goTo(e: Event) {
    e.preventDefault();
    const n = Number(jump);
    if (jump.trim() !== "" && Number.isInteger(n) && n >= 0 && n < raffle.totalNumbers) {
      setPage(Math.floor(n / PAGE_SIZE));
      onSelect(n);
      setJump("");
    }
  }

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <form onSubmit={goTo} class="flex gap-2">
          <input
            class={`${inputClass} w-28`}
            inputMode="numeric"
            placeholder="Ir al nº"
            aria-label="Ir al número"
            value={jump}
            onInput={(e) =>
              setJump((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, w))
            }
          />
          <Button type="submit" variant="secondary">
            Ir
          </Button>
        </form>
      </div>

      {pages > 1 && (
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            aria-label="Anterior"
          >
            ←
          </Button>
          <select
            class={`${inputClass} flex-1`}
            aria-label="Rango de números"
            value={page}
            onChange={(e) => setPage(Number((e.target as HTMLSelectElement).value))}
          >
            {Array.from({ length: pages }, (_, p) => (
              <option key={p} value={p}>
                {formatTicket(p * PAGE_SIZE, w)} –{" "}
                {formatTicket(Math.min((p + 1) * PAGE_SIZE, raffle.totalNumbers) - 1, w)}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
            aria-label="Siguiente"
          >
            →
          </Button>
        </div>
      )}

      <div class="grid grid-cols-5 gap-1.5 sm:grid-cols-8 md:grid-cols-10">
        {Array.from({ length: last - first + 1 }, (_, i) => {
          const n = first + i;
          const view = viewOf(byNumber.get(n), now, today);
          return (
            <button
              key={n}
              type="button"
              data-number={n}
              data-state={view.kind}
              title={`${formatTicket(n, w)} · ${labels[view.kind]}`}
              aria-label={`Número ${formatTicket(n, w)}, ${labels[view.kind]}`}
              onClick={() => onSelect(n)}
              class={`rounded-md border py-2 text-sm font-semibold tabular-nums transition-colors ${cellClass[view.kind]}`}
            >
              {formatTicket(n, w)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
