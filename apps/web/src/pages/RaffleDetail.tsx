import { useState } from "preact/hooks";
import { Link } from "wouter-preact";
import { api } from "../api";
import { DebtsTab } from "../components/DebtsTab";
import { HistoryTab } from "../components/HistoryTab";
import { NumberBoard } from "../components/NumberBoard";
import { PrizesTab } from "../components/PrizesTab";
import { ReservationSearch } from "../components/ReservationSearch";
import { SettingsTab } from "../components/SettingsTab";
import { SummaryTab } from "../components/SummaryTab";
import { TicketDialog } from "../components/TicketDialog";
import { formatMoney, plural } from "../format";
import { useSession } from "../session";
import { Badge, Button, ErrorBox, useAsync, useToast } from "../ui";

type Tab = "resumen" | "numeros" | "premios" | "deudas" | "historial" | "ajustes";
const TABS: [Tab, string][] = [
  ["resumen", "Resumen"],
  ["numeros", "Números"],
  ["premios", "Premios"],
  ["deudas", "Deudas"],
  ["historial", "Historial"],
  ["ajustes", "Ajustes"],
];
const statusTone = { borrador: "slate", activa: "green", cerrada: "amber" } as const;

export function RaffleDetail({ id }: { id: string }) {
  const toast = useToast();
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>("resumen");
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

      {r.status === "activa" ? (
        <PublicLink url={`${location.origin}/r/${session.organization.slug}/${r.slug}`} />
      ) : (
        <p class="text-xs text-slate-500">
          La rifa es pública cuando su estado es <b>activa</b> (se cambia en Ajustes).
        </p>
      )}

      <nav class="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Secciones">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            class={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
            {key === "deudas" && r.stats.owed > 0 && (
              <span
                class={`ml-1.5 rounded-full px-1.5 text-xs ${r.stats.overdue > 0 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}
                title={
                  r.stats.overdue > 0 ? `${r.stats.overdue} vencidas` : `${r.stats.owed} por cobrar`
                }
              >
                {r.stats.overdue > 0 ? r.stats.overdue : r.stats.owed}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === "resumen" && (
        <SummaryTab raffle={r} version={version} onShowDebts={() => setTab("deudas")} />
      )}
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
      {tab === "premios" && <PrizesTab raffle={r} />}
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

function PublicLink({ url }: { url: string }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Enlace copiado");
    } catch {
      toast("No se pudo copiar; selecciónalo y cópialo a mano");
    }
  }
  return (
    <div class="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-slate-200">
      <span class="text-slate-500">Enlace público:</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="min-w-0 flex-1 truncate text-indigo-700 underline"
      >
        {url}
      </a>
      <Button variant="secondary" onClick={copy}>
        Copiar
      </Button>
    </div>
  );
}
