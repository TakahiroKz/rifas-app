import type { AdminPrize, CreatePrizeRequest, LotteriesResponse } from "@rifas/contracts";
import { useState } from "preact/hooks";
import { api } from "../api";
import { formatDayLong, ruleLabel } from "../format";
import { Button, ErrorBox, Field, inputClass, useAsync } from "../ui";

/** Alta y edición de un premio. Las fechas disponibles son solo días en que la lotería sortea. */
export function PrizeForm({
  raffleId,
  numberWidth,
  lotteries,
  prize,
  hasAttempts,
  onSaved,
  onCancel,
}: {
  raffleId: string;
  numberWidth: number;
  lotteries: LotteriesResponse["lotteries"];
  prize?: AdminPrize;
  /** Con intentos previos la regla (lotería, tipo y cifras) no se puede cambiar. */
  hasAttempts?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(prize?.description ?? "");
  const [lotteryId, setLotteryId] = useState(prize?.lotteryId ?? lotteries[0]?.id ?? "");
  const [matchType, setMatchType] = useState<"first" | "last">(prize?.matchType ?? "last");
  const [digits, setDigits] = useState(prize?.digits ?? Math.min(2, numberWidth));
  const [drawDate, setDrawDate] = useState(prize?.drawDate ?? "");
  const [onNoWinner, setOnNoWinner] = useState<"reprogramar" | "finalizar">(
    prize?.onNoWinner ?? "finalizar",
  );
  const [unlimited, setUnlimited] = useState(prize ? prize.maxAttempts === null : true);
  const [maxAttempts, setMaxAttempts] = useState(String(prize?.maxAttempts ?? 3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calendar = useAsync(() => api.getCalendar(lotteryId), [lotteryId]);
  const days = calendar.data ?? [];
  // En edición, la fecha actual puede ser anterior a hoy y no estar en el calendario.
  const options = drawDate && !days.includes(drawDate) ? [drawDate, ...days] : days;
  const locked = hasAttempts === true;

  async function submit(e: Event) {
    e.preventDefault();
    if (!drawDate) {
      setError("Elige la fecha del sorteo");
      return;
    }
    setBusy(true);
    setError(null);
    const attempts = onNoWinner === "reprogramar" && !unlimited ? Number(maxAttempts) : null;
    try {
      if (prize) {
        await api.updatePrize(raffleId, prize.id, {
          description,
          drawDate,
          onNoWinner,
          maxAttempts: attempts,
          ...(locked ? {} : { lotteryId, matchType, digits }),
        });
      } else {
        const body: CreatePrizeRequest = {
          description,
          lotteryId,
          matchType,
          digits,
          drawDate,
          onNoWinner,
          maxAttempts: attempts,
        };
        await api.createPrize(raffleId, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el premio");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} class="space-y-4">
      <Field label="Premio">
        <input
          class={inputClass}
          required
          maxLength={120}
          placeholder="Moto 0 km"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
        />
      </Field>

      <Field label="Lotería">
        <select
          class={inputClass}
          disabled={locked}
          value={lotteryId}
          onChange={(e) => {
            setLotteryId((e.target as HTMLSelectElement).value);
            setDrawDate("");
          }}
        >
          {lotteries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>

      <fieldset class="space-y-2" disabled={locked}>
        <legend class="text-sm font-medium text-slate-700">Cifras del resultado que ganan</legend>
        <div class="grid grid-cols-2 gap-2">
          {(["last", "first"] as const).map((m) => (
            <label
              key={m}
              class={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium ${matchType === m ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-300 text-slate-700"}`}
            >
              <input
                type="radio"
                name="matchType"
                class="sr-only"
                checked={matchType === m}
                onChange={() => setMatchType(m)}
              />
              {m === "last" ? "Las últimas" : "Las primeras"}
            </label>
          ))}
        </div>
        <select
          class={inputClass}
          aria-label="Cantidad de cifras"
          value={digits}
          onChange={(e) => setDigits(Number((e.target as HTMLSelectElement).value))}
        >
          {Array.from({ length: numberWidth }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {ruleLabel(matchType, n)}
            </option>
          ))}
        </select>
        <p class="text-xs text-slate-500">
          Con menos cifras que el número de la rifa ({numberWidth}) pueden ganar varios números;
          cada número vendido que coincida recibe un premio.
        </p>
      </fieldset>

      <Field label="Fecha del sorteo" hint="Solo aparecen los días en que esta lotería sortea.">
        <select
          class={inputClass}
          required
          value={drawDate}
          onChange={(e) => setDrawDate((e.target as HTMLSelectElement).value)}
        >
          <option value="">{calendar.loading ? "Cargando…" : "Elige una fecha"}</option>
          {options.map((d) => (
            <option key={d} value={d}>
              {formatDayLong(d)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Si no hay ganador">
        <select
          class={inputClass}
          value={onNoWinner}
          onChange={(e) =>
            setOnNoWinner((e.target as HTMLSelectElement).value as "reprogramar" | "finalizar")
          }
        >
          <option value="finalizar">El premio termina</option>
          <option value="reprogramar">Reprogramar al próximo sorteo</option>
        </select>
      </Field>

      {onNoWinner === "reprogramar" && (
        <div class="space-y-2 rounded-lg bg-slate-50 p-3">
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(e) => setUnlimited((e.target as HTMLInputElement).checked)}
            />
            Sin límite de intentos
          </label>
          {!unlimited && (
            <Field
              label="Máximo de intentos"
              hint="Al llegar a este número, el premio termina aunque no haya ganador."
            >
              <input
                class={inputClass}
                type="number"
                min={1}
                max={50}
                required
                value={maxAttempts}
                onInput={(e) => setMaxAttempts((e.target as HTMLInputElement).value)}
              />
            </Field>
          )}
        </div>
      )}

      <ErrorBox message={error} />
      <div class="flex gap-2">
        <Button variant="secondary" class="flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" class="flex-1" disabled={busy}>
          {busy ? "Guardando…" : prize ? "Guardar cambios" : "Crear premio"}
        </Button>
      </div>
    </form>
  );
}
