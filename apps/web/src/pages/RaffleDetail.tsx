import { useState } from "preact/hooks";
import { Link } from "wouter-preact";
import { api } from "../api";
import { DebtsTab } from "../components/DebtsTab";
import { HistoryTab } from "../components/HistoryTab";
import { NumberBoard } from "../components/NumberBoard";
import { ReservationSearch } from "../components/ReservationSearch";
import { SettingsTab } from "../components/SettingsTab";
import { TicketDialog } from "../components/TicketDialog";
import { formatMoney, plural } from "../format";
import { Badge, ErrorBox, useAsync, useToast } from "../ui";

type Tab = "numeros" | "deudas" | "historial" | "ajustes";
const TABS: [Tab, string][] = [
  ["numeros", "Números"],
  ["deudas", "Deudas"],
  ["historial", "Historial"],
  ["ajustes", "Ajustes"],
];
const statusTone = { borrador: "slate", activa: "green", cerrada: "amber" } as const;

export function RaffleDetail({ id }: { id: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("numeros");
  const [selected, setSelected] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const raffle = useAsync(() => api.getRaffle(id), [id, version]);
  const tickets = useAsync(() => api.listTickets(id), [id, version]);
  const refresh = () => setVersion((v) => v + 1);

  const r = raffle.data;
  if (raffle.error) {
    return (
      <div class="space-y-3">
        <ErrorBox message={raffle.error} />
        <Link href="/admin" class="text-sm text-indigo-700 underline">
          Volver a mis rifas
        </Link>
      </div>
    );
  }
  if (!r) return <p class="text-sm text-slate-500">Cargando…</p>;

  return (
    <div class="space-y-4">
      <div>
        <Link href="/admin" class="text-sm text-slate-500 hover:text-slate-800">
          ← Mis rifas
        </Link>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <h1 class="text-xl font-bold text-slate-900">{r.title}</h1>
          <Badge tone={statusTone[r.status]}>{r.status}</Badge>
        </div>
        <p class="mt-1 text-sm text-slate-600">
          {r.stats.sold} {plural(r.stats.sold, "vendido", "vendidos")} ({r.stats.paid}{" "}
          {plural(r.stats.paid, "pagado", "pagados")}, {r.stats.owed}{" "}
          {plural(r.stats.owed, "debe", "deben")}) · {r.stats.reserved}{" "}
          {plural(r.stats.reserved, "apartado", "apartados")}
          {r.stats.soldAmount !== null && (
            <>
              {" "}
              · recaudado <strong>{formatMoney(r.stats.paidAmount)}</strong> · por cobrar{" "}
              <strong class="text-rose-700">{formatMoney(r.stats.owedAmount)}</strong>
            </>
          )}
        </p>
      </div>

      <nav class="flex gap-1 border-b border-slate-200" aria-label="Secciones">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            class={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
            {key === "deudas" && r.stats.owed > 0 && (
              <span class="ml-1.5 rounded-full bg-rose-100 px-1.5 text-xs text-rose-700">
                {r.stats.owed}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === "numeros" && (
        <div class="space-y-4">
          <ReservationSearch
            raffle={r}
            onSold={(m) => {
              toast(m);
              refresh();
            }}
          />
          <ErrorBox message={tickets.error} />
          <NumberBoard raffle={r} tickets={tickets.data ?? []} onSelect={setSelected} />
        </div>
      )}
      {tab === "deudas" && <DebtsTab raffle={r} version={version} onChanged={refresh} />}
      {tab === "historial" && <HistoryTab raffle={r} version={version} />}
      {tab === "ajustes" && <SettingsTab raffle={r} onSaved={refresh} />}

      {selected !== null && (
        <TicketDialog
          raffle={r}
          number={selected}
          ticket={tickets.data?.find((t) => t.number === selected)}
          onClose={() => setSelected(null)}
          onChanged={(message) => {
            toast(message);
            setSelected(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
