import type { AdminRaffle, AdminTicket } from "@rifas/contracts";
import { useState } from "preact/hooks";
import { api } from "../api";
import { formatDateTime, formatDay, formatMoney, formatTicket, todayBogota } from "../format";
import { viewOf } from "../ticket-status";
import { Badge, Button, ErrorBox, Modal } from "../ui";
import { SaleForm } from "./SaleForm";

export function TicketDialog({
  raffle,
  number,
  ticket,
  onClose,
  onChanged,
}: {
  raffle: AdminRaffle;
  number: number;
  ticket: AdminTicket | undefined;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "sell">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const view = viewOf(ticket, now, todayBogota(now));
  const label = formatTicket(number, raffle.numberWidth);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción");
      setBusy(false);
    }
  }

  if (mode === "sell") {
    return (
      <Modal title={`Vender el ${label}`} onClose={onClose}>
        <SaleForm
          submitLabel="Marcar vendido"
          onCancel={() => setMode("view")}
          {...(ticket && view.kind !== "activo"
            ? {
                initialBuyer: {
                  ...(ticket.buyerName ? { name: ticket.buyerName } : {}),
                  ...(ticket.buyerPhone ? { phone: ticket.buyerPhone } : {}),
                  ...(ticket.note ? { note: ticket.note } : {}),
                },
              }
            : {})}
          onSubmit={async (p) => {
            await api.sellTicket(raffle.id, number, p);
            onChanged(`Número ${label} vendido`);
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={`Número ${label}`} onClose={onClose}>
      <div class="space-y-4">
        {view.kind === "activo" && (
          <>
            <p class="text-sm text-slate-600">
              <Badge>Activo</Badge> Nadie lo ha apartado ni comprado.
            </p>
            <Button class="w-full" onClick={() => setMode("sell")}>
              Marcar como vendido
            </Button>
          </>
        )}

        {view.kind === "apartado" && (
          <>
            <dl class="space-y-1 text-sm">
              <div class="flex items-center gap-2">
                <Badge tone="amber">Apartado</Badge>
              </div>
              <Row k="Código" v={view.ticket.reservationCode ?? "—"} />
              <Row
                k="Vence"
                v={view.ticket.reservedUntil ? formatDateTime(view.ticket.reservedUntil) : "—"}
              />
            </dl>
            <div class="grid grid-cols-2 gap-2">
              <Button onClick={() => setMode("sell")}>Vender</Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(() => api.releaseTicket(raffle.id, number), `Número ${label} liberado`)
                }
              >
                Liberar
              </Button>
            </div>
          </>
        )}

        {(view.kind === "pagado" || view.kind === "debe") && (
          <>
            <dl class="space-y-1 text-sm">
              <div class="flex items-center gap-2">
                {view.kind === "pagado" ? (
                  <Badge tone="green">Vendido · pagado</Badge>
                ) : (
                  <Badge tone="red">Vendido · debe</Badge>
                )}
                {view.kind === "debe" && view.overdue && <Badge tone="red">Vencido</Badge>}
              </div>
              <Row k="Comprador" v={view.ticket.buyerName ?? "—"} />
              <Row k="Teléfono" v={view.ticket.buyerPhone ?? "—"} />
              {view.ticket.note && <Row k="Nota" v={view.ticket.note} />}
              {view.kind === "debe" && view.ticket.dueDate && (
                <Row k="Fecha de pago" v={formatDay(view.ticket.dueDate)} />
              )}
              {raffle.ticketPrice !== null && <Row k="Valor" v={formatMoney(raffle.ticketPrice)} />}
              {view.ticket.reservationCode && <Row k="Código" v={view.ticket.reservationCode} />}
            </dl>
            <div class="grid grid-cols-2 gap-2">
              {view.kind === "debe" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api.setPayment(raffle.id, number, { status: "pagado" }),
                      `Número ${label} marcado como pagado`,
                    )
                  }
                >
                  Marcar pagado
                </Button>
              )}
              <Button
                variant="danger"
                class={view.kind === "pagado" ? "col-span-2" : ""}
                disabled={busy}
                onClick={() => {
                  if (confirm(`¿Liberar el número ${label}? Volverá a estar activo.`)) {
                    void run(
                      () => api.releaseTicket(raffle.id, number),
                      `Número ${label} liberado`,
                    );
                  }
                }}
              >
                Liberar número
              </Button>
            </div>
          </>
        )}
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div class="flex justify-between gap-4">
      <dt class="text-slate-500">{k}</dt>
      <dd class="text-right font-medium text-slate-900">{v}</dd>
    </div>
  );
}
