import type { AdminRaffle, TicketEventDto } from "@rifas/contracts";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { formatDateTime, formatTicket } from "../format";
import { Button, ErrorBox, inputClass } from "../ui";

const ACTION: Record<TicketEventDto["action"], string> = {
  reserve: "Apartado",
  expire: "Apartado vencido",
  sell: "Vendido",
  update_payment: "Pago actualizado",
  release: "Liberado",
};
const ACTOR: Record<TicketEventDto["actor"], string> = {
  public: "Cliente",
  admin: "Administrador",
  system: "Sistema",
};
const PAGE = 50;

export function HistoryTab({ raffle, version }: { raffle: AdminRaffle; version: number }) {
  const [filter, setFilter] = useState("");
  const [events, setEvents] = useState<TicketEventDto[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const number = filter.trim() === "" ? undefined : Number(filter);

  async function load(beforeId?: number) {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listHistory(raffle.id, {
        limit: PAGE,
        ...(number !== undefined ? { number } : {}),
        ...(beforeId !== undefined ? { beforeId } : {}),
      });
      setEvents((prev) => (beforeId === undefined ? page : [...prev, ...page]));
      setMore(page.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [raffle.id, version, number]);

  return (
    <div class="space-y-3">
      <input
        class={`${inputClass} max-w-[12rem]`}
        inputMode="numeric"
        placeholder="Filtrar por nº"
        aria-label="Filtrar por número"
        value={filter}
        onInput={(e) =>
          setFilter((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 5))
        }
      />
      <ErrorBox message={error} />
      {!loading && events.length === 0 && (
        <p class="rounded-xl bg-white p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">
          Sin movimientos todavía.
        </p>
      )}
      <ul class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {events.map((e) => (
          <li key={e.id} class="flex items-center justify-between gap-3 p-3 text-sm">
            <div>
              <p class="font-medium text-slate-900">
                <span class="tabular-nums">{formatTicket(e.number, raffle.numberWidth)}</span> ·{" "}
                {ACTION[e.action]}
              </p>
              <p class="text-xs text-slate-500">
                {ACTOR[e.actor]}
                {e.reservationCode ? ` · ${e.reservationCode}` : ""}
              </p>
            </div>
            <time class="shrink-0 text-xs text-slate-500" dateTime={e.at}>
              {formatDateTime(e.at)}
            </time>
          </li>
        ))}
      </ul>
      {more && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => load(events[events.length - 1]?.id)}
        >
          {loading ? "Cargando…" : "Cargar más"}
        </Button>
      )}
    </div>
  );
}
