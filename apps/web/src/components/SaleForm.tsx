import type { PaymentInput } from "@rifas/contracts";
import { useState } from "preact/hooks";
import type { Buyer } from "../api";
import { todayBogota } from "../format";
import { Button, ErrorBox, Field, inputClass } from "../ui";

export interface SalePayload {
  payment: PaymentInput;
  buyer: Buyer;
}

/** Formulario para marcar números como vendidos: pagado, o debe con fecha de pago. */
export function SaleForm({
  submitLabel,
  onSubmit,
  onCancel,
  initialBuyer,
}: {
  submitLabel: string;
  onSubmit: (payload: SalePayload) => Promise<void>;
  onCancel?: () => void;
  initialBuyer?: Buyer;
}) {
  const [status, setStatus] = useState<"pagado" | "debe">("pagado");
  const [dueDate, setDueDate] = useState("");
  const [name, setName] = useState(initialBuyer?.name ?? "");
  const [phone, setPhone] = useState(initialBuyer?.phone ?? "");
  const [note, setNote] = useState(initialBuyer?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (status === "debe" && !dueDate) {
      setError("Indica la fecha en la que se pagará");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        payment: status === "debe" ? { status, dueDate } : { status },
        buyer: {
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} class="space-y-4">
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-slate-700">Pago</legend>
        <div class="grid grid-cols-2 gap-2">
          {(["pagado", "debe"] as const).map((value) => (
            <label
              key={value}
              class={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium ${
                status === value
                  ? "border-indigo-600 bg-indigo-50 text-indigo-800"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              <input
                type="radio"
                name="payment"
                class="sr-only"
                checked={status === value}
                onChange={() => setStatus(value)}
              />
              {value === "pagado" ? "Pagado" : "Debe"}
            </label>
          ))}
        </div>
      </fieldset>
      {status === "debe" && (
        <Field label="Fecha de pago" hint="Día en que quedó de pagar">
          <input
            class={inputClass}
            type="date"
            min={todayBogota()}
            required
            value={dueDate}
            onInput={(e) => setDueDate((e.target as HTMLInputElement).value)}
          />
        </Field>
      )}
      <Field label="Nombre del comprador">
        <input
          class={inputClass}
          value={name}
          maxLength={80}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Teléfono">
        <input
          class={inputClass}
          type="tel"
          value={phone}
          maxLength={20}
          onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Nota">
        <input
          class={inputClass}
          value={note}
          maxLength={300}
          onInput={(e) => setNote((e.target as HTMLInputElement).value)}
        />
      </Field>
      <ErrorBox message={error} />
      <div class="flex gap-2">
        {onCancel && (
          <Button variant="secondary" class="flex-1" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        )}
        <Button type="submit" class="flex-1" disabled={busy}>
          {busy ? "Guardando…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
