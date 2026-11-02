import type { AdminPrize, AdminRaffle } from "@rifas/contracts";
import { useState } from "preact/hooks";
import { api } from "../api";
import { formatDay, formatTicket, policyLabel, ruleLabel } from "../format";
import { Badge, Button, ErrorBox, Modal, useAsync, useToast } from "../ui";
import { PrizeForm } from "./PrizeForm";
import { ResolveDialog } from "./ResolveDialog";

const statusTone = { pendiente: "amber", anunciado: "green", finalizado: "slate" } as const;
const statusText = {
  pendiente: "Pendiente",
  anunciado: "Anunciado",
  finalizado: "Finalizado sin ganador",
} as const;

export function PrizesTab({ raffle }: { raffle: AdminRaffle }) {
  const toast = useToast();
  const prizes = useAsync(() => api.listPrizes(raffle.id), [raffle.id]);
  const lotteries = useAsync(() => api.listLotteries(), []);
  const [form, setForm] = useState<{ prize?: AdminPrize } | null>(null);
  const [resolving, setResolving] = useState<AdminPrize | null>(null);
  const label = (n: number) => formatTicket(n, raffle.numberWidth);

  async function remove(p: AdminPrize) {
    if (!confirm(`¿Borrar el premio ${p.place} (${p.description})?`)) return;
    try {
      await api.deletePrize(raffle.id, p.id);
      toast("Premio borrado");
      prizes.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo borrar");
    }
  }

  return (
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-3">
        <p class="text-sm text-slate-600">
          Cada premio se define con una lotería y las cifras de su resultado. Nosotros no hacemos el
          sorteo: anunciamos al ganador según el resultado oficial.
        </p>
        <Button onClick={() => setForm({})} disabled={!lotteries.data}>
          Agregar premio
        </Button>
      </div>

      <ErrorBox message={prizes.error ?? lotteries.error} />
      {prizes.loading && !prizes.data && <p class="text-sm text-slate-500">Cargando…</p>}
      {prizes.data && prizes.data.length === 0 && (
        <p class="rounded-xl bg-white p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">
          Aún no hay premios. Agrega el primero.
        </p>
      )}

      <ul class="space-y-3">
        {prizes.data?.map((p) => (
          <li
            key={p.id}
            class="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
            data-prize={p.place}
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="font-semibold text-slate-900">
                  Premio {p.place}: {p.description}
                </h3>
                <p class="text-xs text-slate-500">
                  {p.lotteryName} · {formatDay(p.drawDate)} · {ruleLabel(p.matchType, p.digits)}
                </p>
              </div>
              <Badge tone={statusTone[p.status]}>{statusText[p.status]}</Badge>
            </div>
            <p class="text-xs text-slate-500">{policyLabel(p.onNoWinner, p.maxAttempts)}</p>

            {p.attempts.length > 0 && (
              <ol class="space-y-1 text-xs text-slate-600">
                {p.attempts.map((a) => (
                  <li key={a.attemptNo}>
                    Intento {a.attemptNo} · {formatDay(a.drawDate)} · resultado{" "}
                    <b class="font-mono">{a.resultNumber}</b> ·{" "}
                    {a.outcome === "ganador" ? "con ganador" : "sin ganador"}
                  </li>
                ))}
              </ol>
            )}

            {p.winners.length > 0 && (
              <ul class="divide-y divide-slate-100 rounded-lg bg-emerald-50 text-sm">
                {p.winners.map((w) => (
                  <li key={w.number} class="flex items-center justify-between gap-2 px-3 py-2">
                    <span>
                      🏆 <b class="tabular-nums">{label(w.number)}</b> ·{" "}
                      {w.buyerName ?? "Sin nombre"}
                      {w.buyerPhone ? <span class="text-slate-500"> · {w.buyerPhone}</span> : null}
                    </span>
                    {w.paymentStatus === "debe" ? <Badge tone="red">Debe</Badge> : null}
                  </li>
                ))}
              </ul>
            )}

            {p.status === "pendiente" && (
              <div class="flex flex-wrap gap-2">
                <Button onClick={() => setResolving(p)}>Ver resultado</Button>
                <Button variant="secondary" onClick={() => setForm({ prize: p })}>
                  Editar
                </Button>
                {p.attempts.length === 0 && (
                  <Button variant="ghost" onClick={() => remove(p)}>
                    Borrar
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {form && lotteries.data && (
        <Modal
          title={form.prize ? `Editar premio ${form.prize.place}` : "Nuevo premio"}
          onClose={() => setForm(null)}
        >
          <PrizeForm
            raffleId={raffle.id}
            numberWidth={raffle.numberWidth}
            lotteries={lotteries.data.lotteries}
            {...(form.prize
              ? { prize: form.prize, hasAttempts: form.prize.attempts.length > 0 }
              : {})}
            onCancel={() => setForm(null)}
            onSaved={() => {
              setForm(null);
              toast("Premio guardado");
              prizes.reload();
            }}
          />
        </Modal>
      )}

      {resolving && lotteries.data && (
        <ResolveDialog
          raffle={raffle}
          prize={resolving}
          syncEnabled={lotteries.data.syncEnabled}
          onClose={() => setResolving(null)}
          onDone={(message) => {
            toast(message);
            setResolving(null);
            prizes.reload();
          }}
        />
      )}
    </div>
  );
}
