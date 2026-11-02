import type { AdminRaffle } from "@rifas/contracts";
import { useState } from "preact/hooks";
import { api } from "../api";
import { Button, ErrorBox, Field, inputClass, useToast } from "../ui";

export function SettingsTab({ raffle, onSaved }: { raffle: AdminRaffle; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(raffle.title);
  const [description, setDescription] = useState(raffle.description);
  const [price, setPrice] = useState(raffle.ticketPrice === null ? "" : String(raffle.ticketPrice));
  const [drawDate, setDrawDate] = useState(raffle.drawDate ?? "");
  const [status, setStatus] = useState(raffle.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateRaffle(raffle.id, {
        title,
        description,
        ticketPrice: price.trim() === "" ? null : Number(price),
        drawDate: drawDate || null,
        status,
      });
      toast("Cambios guardados");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      class="max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <Field label="Título">
        <input
          class={inputClass}
          required
          minLength={3}
          maxLength={120}
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Descripción">
        <textarea
          class={inputClass}
          rows={3}
          maxLength={2000}
          value={description}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
        />
      </Field>
      <Field label="Valor de cada número (COP)">
        <input
          class={inputClass}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={price}
          onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Fecha del sorteo">
        <input
          class={inputClass}
          type="date"
          value={drawDate}
          onInput={(e) => setDrawDate((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field
        label="Estado"
        hint="Solo las rifas activas aparecen en la página pública y permiten apartar."
      >
        <select
          class={inputClass}
          value={status}
          onChange={(e) =>
            setStatus((e.target as HTMLSelectElement).value as AdminRaffle["status"])
          }
        >
          <option value="borrador">Borrador</option>
          <option value="activa">Activa</option>
          <option value="cerrada">Cerrada</option>
        </select>
      </Field>
      <dl class="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <div class="flex justify-between">
          <dt>Identificador</dt>
          <dd class="font-mono">{raffle.slug}</dd>
        </div>
        <div class="flex justify-between">
          <dt>Cantidad de números</dt>
          <dd>{raffle.totalNumbers.toLocaleString("es-CO")}</dd>
        </div>
      </dl>
      <ErrorBox message={error} />
      <Button type="submit" class="w-full" disabled={busy}>
        {busy ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
