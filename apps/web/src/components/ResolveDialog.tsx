import type { AdminPrize, AdminRaffle, Proposal } from "@rifas/contracts";
import { useState } from "preact/hooks";
import { api } from "../api";
import { formatDay, formatDayLong, formatTicket, plural, ruleLabel, todayBogota } from "../format";
import { Badge, Button, ErrorBox, Field, inputClass, Modal, useAsync } from "../ui";

/** Muestra el resultado, quién gana según la regla, y deja confirmar, reprogramar o ingresar el resultado a mano. */
export function ResolveDialog({
  raffle,
  prize,
  syncEnabled,
  onClose,
  onDone,
}: {
  raffle: AdminRaffle;
  prize: AdminPrize;
  syncEnabled: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const proposal = useAsync(() => api.getProposal(raffle.id, prize.id), [raffle.id, prize.id]);
  const label = (n: number) => formatTicket(n, raffle.numberWidth);
  const title = `Premio ${prize.place}: ${prize.description}`;

  return (
    <Modal title={title} onClose={onClose}>
      <div class="space-y-4">
        <p class="text-sm text-slate-600">
          {prize.lotteryName} · {formatDay(prize.drawDate)} ·{" "}
          {ruleLabel(prize.matchType, prize.digits)}
        </p>
        <ErrorBox message={proposal.error} />
        {proposal.loading && !proposal.data && <p class="text-sm text-slate-500">Calculando…</p>}
        {proposal.data && (
          <Body
            raffle={raffle}
            prize={prize}
            proposal={proposal.data}
            syncEnabled={syncEnabled}
            label={label}
            reload={proposal.reload}
            onDone={onDone}
          />
        )}
      </div>
    </Modal>
  );
}

function Body({
  raffle,
  prize,
  proposal,
  syncEnabled,
  label,
  reload,
  onDone,
}: {
  raffle: AdminRaffle;
  prize: AdminPrize;
  proposal: Proposal;
  syncEnabled: boolean;
  label: (n: number) => string;
  reload: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [next, setNext] = useState("");
  const calendar = useAsync(
    () =>
      proposal.canReprogram
        ? api.getCalendar(prize.lotteryId, prize.drawDate)
        : Promise.resolve([]),
    [prize.id, proposal.canReprogram],
  );
  const nextDays = (calendar.data ?? []).filter((d) => d > prize.drawDate);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (done) onDone(done);
      else reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción");
    } finally {
      setBusy(false);
    }
  }

  // ───── Todavía no hay resultado ─────
  if (proposal.outcome === "sin_resultado") {
    const reached = prize.drawDate <= todayBogota();
    return (
      <div class="space-y-4">
        <p class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {reached
            ? "Aún no tenemos el resultado de este sorteo."
            : `El sorteo es el ${formatDayLong(prize.drawDate)}; todavía no se puede confirmar.`}
        </p>
        {reached && (
          <>
            {syncEnabled ? (
              <Button
                variant="secondary"
                class="w-full"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api.fetchResult(prize.lotteryId, prize.drawDate);
                    if (!r.found)
                      throw new Error(
                        "La fuente todavía no publica este resultado. Inténtalo más tarde.",
                      );
                  })
                }
              >
                Consultar resultado ahora
              </Button>
            ) : (
              <p class="text-xs text-slate-500">
                La consulta automática no está activada. Ingresa el resultado a mano.
              </p>
            )}
            <form
              class="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api.enterResult(prize.lotteryId, prize.drawDate, manual));
              }}
            >
              <Field
                label="Ingresar el resultado a mano"
                hint="Número ganador del sorteo, 4 cifras (con ceros a la izquierda)."
              >
                <input
                  class={`${inputClass} font-mono tracking-widest`}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="0000"
                  value={manual}
                  onInput={(e) =>
                    setManual((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 4))
                  }
                />
              </Field>
              <Button type="submit" disabled={busy || manual.length !== 4}>
                Guardar resultado
              </Button>
            </form>
          </>
        )}
        <ErrorBox message={error} />
      </div>
    );
  }

  const result = proposal.result;
  return (
    <div class="space-y-4">
      {result && (
        <div class="rounded-lg bg-slate-50 p-3 text-center">
          <p class="text-xs text-slate-500">
            Resultado {result.source === "manual" ? "(ingresado a mano)" : "oficial"}
            {result.series ? ` · serie ${result.series}` : ""}
          </p>
          <p class="mt-1 font-mono text-3xl font-bold tracking-widest text-slate-900">
            {proposal.term !== null &&
              (prize.matchType === "first" ? (
                <>
                  <mark class="rounded bg-emerald-200 px-1">
                    {result.number.slice(0, prize.digits)}
                  </mark>
                  {result.number.slice(prize.digits)}
                </>
              ) : (
                <>
                  {result.number.slice(0, 4 - prize.digits)}
                  <mark class="rounded bg-emerald-200 px-1">
                    {result.number.slice(4 - prize.digits)}
                  </mark>
                </>
              ))}
          </p>
          <p class="mt-1 text-xs text-slate-500">
            Cuentan {ruleLabel(prize.matchType, prize.digits).toLowerCase()}: <b>{proposal.term}</b>
          </p>
        </div>
      )}

      {proposal.outcome === "ganador" && (
        <>
          <p class="text-sm font-medium text-emerald-800">
            {proposal.winners.length} {plural(proposal.winners.length, "ganador", "ganadores")}
            {proposal.winners.length > 1 ? " (se entrega un premio por cada número)" : ""}:
          </p>
          <ul class="divide-y divide-slate-200 rounded-lg ring-1 ring-slate-200">
            {proposal.winners.map((w) => (
              <li key={w.number} class="flex items-center justify-between gap-3 p-3 text-sm">
                <span>
                  <b class="tabular-nums">{label(w.number)}</b> · {w.buyerName ?? "Sin nombre"}
                  {w.buyerPhone ? <span class="text-slate-500"> · {w.buyerPhone}</span> : null}
                </span>
                {w.paymentStatus === "debe" ? (
                  <Badge tone="red">Debe</Badge>
                ) : (
                  <Badge tone="green">Pagado</Badge>
                )}
              </li>
            ))}
          </ul>
          {proposal.winners.some((w) => w.paymentStatus === "debe") && (
            <p class="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">
              Hay ganadores que aún deben su número. Revísalo antes de anunciar.
            </p>
          )}
          {proposal.unsoldMatches > 0 && (
            <p class="text-xs text-slate-500">
              {proposal.unsoldMatches}{" "}
              {plural(proposal.unsoldMatches, "número coincide", "números coinciden")} pero no está
              vendido, así que no gana.
            </p>
          )}
          <ErrorBox message={error} />
          <Button
            class="w-full"
            disabled={busy}
            onClick={() => run(() => api.resolvePrize(raffle.id, prize.id), "Ganadores anunciados")}
          >
            {busy ? "Guardando…" : "Confirmar y anunciar ganadores"}
          </Button>
        </>
      )}

      {proposal.outcome === "sin_ganador" && (
        <>
          <p class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Ningún número vendido coincide
            {proposal.unsoldMatches > 0
              ? ` (${proposal.unsoldMatches} ${plural(proposal.unsoldMatches, "número coincide", "números coinciden")} pero no ${plural(proposal.unsoldMatches, "está vendido", "están vendidos")})`
              : ""}
            . Este es el intento {proposal.attemptNo}
            {prize.maxAttempts !== null ? ` de ${prize.maxAttempts}` : ""}.
          </p>
          {proposal.canReprogram ? (
            <>
              <Field
                label="Fecha del próximo sorteo"
                hint="Solo aparecen días en que esta lotería sortea."
              >
                <select
                  class={inputClass}
                  value={next}
                  onChange={(e) => setNext((e.target as HTMLSelectElement).value)}
                >
                  <option value="">{calendar.loading ? "Cargando…" : "Elige una fecha"}</option>
                  {nextDays.map((d) => (
                    <option key={d} value={d}>
                      {formatDayLong(d)}
                    </option>
                  ))}
                </select>
              </Field>
              <ErrorBox message={error} />
              <Button
                class="w-full"
                disabled={busy || !next}
                onClick={() =>
                  run(() => api.resolvePrize(raffle.id, prize.id, next), "Premio reprogramado")
                }
              >
                {busy ? "Guardando…" : "Reprogramar premio"}
              </Button>
            </>
          ) : (
            <>
              <p class="text-sm text-slate-600">
                {prize.onNoWinner === "finalizar"
                  ? "Según la política del premio, termina sin ganador."
                  : "Se alcanzó el máximo de intentos: el premio termina sin ganador."}
              </p>
              <ErrorBox message={error} />
              <Button
                variant="danger"
                class="w-full"
                disabled={busy}
                onClick={() =>
                  run(() => api.resolvePrize(raffle.id, prize.id), "Premio finalizado")
                }
              >
                {busy ? "Guardando…" : "Finalizar premio sin ganador"}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
