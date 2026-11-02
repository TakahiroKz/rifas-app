import type { AdminRaffle, ReservationLookup } from "@rifas/contracts";
import { useState } from "preact/hooks";
import { api } from "../api";
import { formatDateTime, formatTicket } from "../format";
import { Button, ErrorBox, inputClass, Modal } from "../ui";
import { SaleForm } from "./SaleForm";

/** Busca un apartado por el código que el cliente envía por WhatsApp y vende todos sus números. */
export function ReservationSearch({
  raffle,
  onSold,
}: {
  raffle: AdminRaffle;
  onSold: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<ReservationLookup | null>(null);
  const [selling, setSelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      setFound(await api.findReservation(raffle.id, code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo buscar");
    } finally {
      setBusy(false);
    }
  }

  const label = (n: number) => formatTicket(n, raffle.numberWidth);

  return (
    <section class="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 class="text-sm font-semibold text-slate-800">Buscar apartado por código</h3>
      <form onSubmit={search} class="flex gap-2">
        <input
          class={`${inputClass} uppercase`}
          placeholder="RF-XXXXXX"
          aria-label="Código de apartado"
          value={code}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
        />
        <Button type="submit" variant="secondary" disabled={busy || code.trim() === ""}>
          Buscar
        </Button>
      </form>
      <ErrorBox message={error} />
      {found && (
        <div class="space-y-2 rounded-lg bg-amber-50 p-3 text-sm">
          <p>
            Números: <strong>{found.numbers.map(label).join(", ")}</strong>
          </p>
          {found.reservedUntil && (
            <p class="text-slate-600">Vence {formatDateTime(found.reservedUntil)}</p>
          )}
          <Button onClick={() => setSelling(true)}>
            Vender estos {found.numbers.length} números
          </Button>
        </div>
      )}
      {selling && found && (
        <Modal
          title={`Vender ${found.numbers.map(label).join(", ")}`}
          onClose={() => setSelling(false)}
        >
          <SaleForm
            submitLabel="Marcar vendidos"
            onCancel={() => setSelling(false)}
            onSubmit={async (p) => {
              await api.sellReservation(raffle.id, code, p);
              setSelling(false);
              setFound(null);
              setCode("");
              onSold(`${found.numbers.length} números vendidos`);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
