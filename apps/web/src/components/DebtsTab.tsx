import type { AdminRaffle } from "@rifas/contracts";
import { api } from "../api";
import { formatDay, formatMoney, formatTicket, todayBogota } from "../format";
import { Badge, Button, ErrorBox, useAsync, useToast } from "../ui";

export function DebtsTab({
  raffle,
  version,
  onChanged,
}: {
  raffle: AdminRaffle;
  version: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(
    () => api.listDebts(raffle.id),
    [raffle.id, version],
  );
  const today = todayBogota();
  const total = data && raffle.ticketPrice !== null ? data.length * raffle.ticketPrice : null;

  async function pay(number: number) {
    try {
      await api.setPayment(raffle.id, number, { status: "pagado" });
      toast(`Número ${formatTicket(number, raffle.numberWidth)} marcado como pagado`);
      reload();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo actualizar");
    }
  }

  return (
    <div class="space-y-3">
      <ErrorBox message={error} />
      {loading && <p class="text-sm text-slate-500">Cargando…</p>}
      {data && data.length === 0 && (
        <p class="rounded-xl bg-white p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">
          No hay deudas pendientes.
        </p>
      )}
      {data && data.length > 0 && (
        <>
          <p class="text-sm text-slate-600">
            {data.length} {data.length === 1 ? "número" : "números"} por cobrar
            {total !== null && (
              <>
                {" "}
                · <strong class="text-rose-700">{formatMoney(total)}</strong>
              </>
            )}
            . Ordenados por fecha de pago.
          </p>
          <ul class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {data.map((t) => {
              const overdue = t.dueDate !== null && t.dueDate < today;
              return (
                <li key={t.number} class="flex items-center justify-between gap-3 p-3">
                  <div class="min-w-0">
                    <p class="font-semibold tabular-nums text-slate-900">
                      {formatTicket(t.number, raffle.numberWidth)}
                      <span class="ml-2 font-normal text-slate-600">
                        {t.buyerName ?? "Sin nombre"}
                      </span>
                    </p>
                    <p class="truncate text-xs text-slate-500">
                      {t.buyerPhone ?? "Sin teléfono"} · paga{" "}
                      {t.dueDate ? formatDay(t.dueDate) : "—"}{" "}
                      {overdue && <Badge tone="red">Vencido</Badge>}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => pay(t.number)}>
                    Pagado
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
