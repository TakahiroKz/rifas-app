import { useState } from "preact/hooks";
import { useLocation } from "wouter-preact";
import { api } from "../api";
import { formatTicket, slugify } from "../format";
import { Button, ErrorBox, Field, inputClass, useToast } from "../ui";

export function RaffleNew() {
  const [, navigate] = useLocation();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [total, setTotal] = useState("100");
  const [price, setPrice] = useState("");
  const [drawDate, setDrawDate] = useState("");
  const [status, setStatus] = useState<"borrador" | "activa">("borrador");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalNumber = Number(total);
  const validTotal = Number.isInteger(totalNumber) && totalNumber >= 10 && totalNumber <= 10000;
  const width = validTotal ? String(totalNumber - 1).length : 0;

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const raffle = await api.createRaffle({
        title,
        slug: slug || slugify(title),
        totalNumbers: totalNumber,
        ticketPrice: price.trim() === "" ? null : Number(price),
        drawDate: drawDate || null,
        status,
      });
      toast("Rifa creada");
      navigate(`/admin/raffles/${raffle.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la rifa");
      setBusy(false);
    }
  }

  return (
    <div class="mx-auto max-w-lg space-y-4">
      <h1 class="text-xl font-bold text-slate-900">Nueva rifa</h1>
      <form
        onSubmit={submit}
        class="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
      >
        <Field label="Título">
          <input
            class={inputClass}
            required
            minLength={3}
            maxLength={120}
            value={title}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setTitle(v);
              if (!slugEdited) setSlug(slugify(v));
            }}
          />
        </Field>
        <Field
          label="Identificador en el enlace"
          hint="Minúsculas, números y guiones. No se puede cambiar después."
        >
          <input
            class={inputClass}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={3}
            maxLength={60}
            value={slug}
            onInput={(e) => {
              setSlugEdited(true);
              setSlug((e.target as HTMLInputElement).value);
            }}
          />
        </Field>
        <Field
          label="Cantidad de números"
          hint={
            validTotal
              ? `De ${formatTicket(0, width)} a ${formatTicket(totalNumber - 1, width)} (${width} cifras). No se puede cambiar después.`
              : "Entre 10 y 10.000"
          }
        >
          <input
            class={inputClass}
            type="number"
            inputMode="numeric"
            min={10}
            max={10000}
            required
            value={total}
            onInput={(e) => setTotal((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Field
          label="Valor de cada número (COP)"
          hint="Opcional. Se usa para calcular lo vendido y lo que se debe."
        >
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
        <Field label="Fecha del sorteo" hint="Opcional.">
          <input
            class={inputClass}
            type="date"
            value={drawDate}
            onInput={(e) => setDrawDate((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Field label="Estado" hint="Solo las rifas activas aparecen en la página pública.">
          <select
            class={inputClass}
            value={status}
            onChange={(e) =>
              setStatus((e.target as HTMLSelectElement).value as "borrador" | "activa")
            }
          >
            <option value="borrador">Borrador</option>
            <option value="activa">Activa</option>
          </select>
        </Field>
        <ErrorBox message={error} />
        <Button type="submit" class="w-full" disabled={busy || !validTotal}>
          {busy ? "Creando…" : "Crear rifa"}
        </Button>
      </form>
    </div>
  );
}
