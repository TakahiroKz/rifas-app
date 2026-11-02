import type { PublicRaffleResponse, ReserveResponse } from "@rifas/contracts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Link } from "wouter-preact";
import { ApiError } from "../api";
import { TurnstileWidget } from "../components/Turnstile";
import { formatDateTime, formatDay, formatMoney, formatTicket, plural } from "../format";
import { publicApi } from "../public-api";
import {
  dropTaken,
  MAX_PER_RESERVATION,
  pickRandomAvailable,
  type Taken,
  toggleNumber,
  visibleNumbers,
} from "../selection";
import { Button, ErrorBox, inputClass, useAsync } from "../ui";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "../whatsapp";

const PAGE_SIZE = 200;
const REFRESH_MS = 30_000;

export function PublicRaffle({ org, raffle: slug }: { org: string; raffle: string }) {
  const info = useAsync(() => publicApi.getRaffle(org, slug), [org, slug]);

  if (info.loading) return <Shell>Cargando…</Shell>;
  if (info.error || !info.data) {
    return (
      <Shell>
        <div class="space-y-2 text-center">
          <h1 class="text-xl font-bold text-slate-900">Esta rifa no está disponible</h1>
          <p class="text-sm text-slate-600">
            Revisa el enlace que te compartieron o escribe a quien organiza la rifa.
          </p>
        </div>
      </Shell>
    );
  }
  return <RaffleView org={org} slug={slug} data={info.data} />;
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return (
    <main class="mx-auto flex min-h-screen max-w-md items-center justify-center p-6 text-slate-600">
      {children}
    </main>
  );
}

function RaffleView({
  org,
  slug,
  data,
}: {
  org: string;
  slug: string;
  data: PublicRaffleResponse;
}) {
  const { raffle, organization, turnstileSiteKey } = data;
  const width = raffle.numberWidth;
  const label = (n: number) => formatTicket(n, width);

  const [taken, setTaken] = useState<Taken>(new Map());
  const [selected, setSelected] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [jump, setJump] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [done, setDone] = useState<{ result: ReserveResponse; url: string } | null>(null);

  async function refresh() {
    try {
      const tickets = await publicApi.getTickets(org, slug);
      const next: Taken = new Map(tickets.map((t) => [t.number, t.status]));
      setTaken(next);
      setSelected((s) => dropTaken(s, next));
    } catch {
      /* si falla un refresco, se conserva lo último que se vio */
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [org, slug]);

  const list = useMemo(
    () => visibleNumbers(raffle.totalNumbers, taken, onlyAvailable),
    [raffle.totalNumbers, taken, onlyAvailable],
  );
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const shown = list.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const available = raffle.totalNumbers - taken.size;
  const total = raffle.ticketPrice === null ? null : raffle.ticketPrice * selected.length;

  function toggle(n: number) {
    if (taken.has(n)) return;
    const r = toggleNumber(selected, n);
    setSelected(r.selected);
    setError(null);
    setNotice(
      r.limitReached ? `Puedes elegir hasta ${MAX_PER_RESERVATION} números a la vez` : null,
    );
  }

  function goTo(e: Event) {
    e.preventDefault();
    const n = Number(jump);
    if (jump.trim() === "" || !Number.isInteger(n) || n < 0 || n >= raffle.totalNumbers) return;
    const idx = list.indexOf(n);
    if (idx === -1) {
      setNotice(`El ${label(n)} ya no está disponible`);
      return;
    }
    setPage(Math.floor(idx / PAGE_SIZE));
    toggle(n);
    setJump("");
  }

  function random() {
    const n = pickRandomAvailable(raffle.totalNumbers, taken, selected);
    if (n === null) return setNotice("No quedan números disponibles");
    toggle(n);
    setPage(Math.floor(list.indexOf(n) / PAGE_SIZE));
  }

  async function reserve() {
    if (selected.length === 0 || busy) return;
    if (turnstileSiteKey && !token) {
      setError("Estamos verificando que eres una persona. Inténtalo de nuevo en un momento");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await publicApi.reserve(org, slug, selected, token ?? undefined);
      const privacyUrl = `${location.origin}/r/${org}/${slug}/privacidad`;
      const url = buildWhatsAppUrl(
        organization.whatsappPhone,
        buildWhatsAppMessage({
          raffleTitle: raffle.title,
          numbers: result.numbers.map(label),
          code: result.code,
          reservedUntil: result.reservedUntil,
          privacyUrl,
        }),
      );
      setDone({ result, url });
      setSelected([]);
      void refresh();
      window.open(url, "_blank", "noopener");
    } catch (e) {
      if (e instanceof ApiError && e.code === "numbers_unavailable") {
        const gone = (e.details?.unavailable as number[] | undefined) ?? [];
        setError(
          `${gone.length === 1 ? "El número" : "Los números"} ${gone.map(label).join(", ")} ya ${gone.length === 1 ? "no está disponible" : "no están disponibles"}. Elige otros.`,
        );
        void refresh();
      } else {
        setError(e instanceof Error ? e.message : "No se pudo apartar. Inténtalo de nuevo");
      }
    } finally {
      setBusy(false);
      // Cada token de Turnstile sirve una sola vez.
      if (turnstileSiteKey) setResetKey((k) => k + 1);
    }
  }

  return (
    <div class="min-h-screen bg-slate-50 pb-40">
      <header class="bg-white shadow-sm">
        <div class="mx-auto max-w-3xl space-y-3 px-4 py-6">
          <p class="text-sm font-medium text-indigo-700">{organization.name}</p>
          <h1 class="text-2xl font-bold text-slate-900">{raffle.title}</h1>
          {raffle.description && (
            <p class="whitespace-pre-line text-sm text-slate-600">{raffle.description}</p>
          )}
          <ul class="flex flex-wrap gap-2 text-sm">
            {raffle.ticketPrice !== null && (
              <Chip>{formatMoney(raffle.ticketPrice)} por número</Chip>
            )}
            {raffle.drawDate && <Chip>Sorteo: {formatDay(raffle.drawDate)}</Chip>}
            <Chip>
              {available.toLocaleString("es-CO")} {plural(available, "disponible", "disponibles")}{" "}
              de {raffle.totalNumbers.toLocaleString("es-CO")}
            </Chip>
          </ul>
        </div>
      </header>

      <main class="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {done ? (
          <Success done={done} label={label} onClose={() => setDone(null)} />
        ) : (
          <ol class="grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
            <li>
              <b class="text-slate-900">1.</b> Elige tus números.
            </li>
            <li>
              <b class="text-slate-900">2.</b> Apártalos: se abre WhatsApp con tu mensaje.
            </li>
            <li>
              <b class="text-slate-900">3.</b> Coordina el pago allí. Tu apartado dura 24 horas.
            </li>
          </ol>
        )}

        <div class="flex flex-wrap items-center justify-between gap-3">
          <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <Key cls="border-slate-300 bg-white">Disponible</Key>
            <Key cls="border-indigo-600 bg-indigo-600">Elegido</Key>
            <Key cls="border-amber-400 bg-amber-100">Apartado</Key>
            <Key cls="border-slate-300 bg-slate-200">Vendido</Key>
          </ul>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(e) => {
                setOnlyAvailable((e.target as HTMLInputElement).checked);
                setPage(0);
              }}
            />
            Solo disponibles
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <form onSubmit={goTo} class="flex gap-2">
            <input
              class={`${inputClass} w-28`}
              inputMode="numeric"
              placeholder="Buscar nº"
              aria-label="Buscar un número"
              value={jump}
              onInput={(e) =>
                setJump((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, width))
              }
            />
            <Button type="submit" variant="secondary">
              Elegir
            </Button>
          </form>
          <Button variant="secondary" onClick={random}>
            🎲 Al azar
          </Button>
        </div>

        {pages > 1 && (
          <div class="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              aria-label="Anterior"
            >
              ←
            </Button>
            <select
              class={`${inputClass} flex-1`}
              aria-label="Rango de números"
              value={safePage}
              onChange={(e) => setPage(Number((e.target as HTMLSelectElement).value))}
            >
              {Array.from({ length: pages }, (_, p) => {
                const from = list[p * PAGE_SIZE];
                const to = list[Math.min((p + 1) * PAGE_SIZE, list.length) - 1];
                return (
                  <option key={p} value={p}>
                    {from === undefined || to === undefined ? "—" : `${label(from)} – ${label(to)}`}
                  </option>
                );
              })}
            </select>
            <Button
              variant="secondary"
              disabled={safePage >= pages - 1}
              onClick={() => setPage(safePage + 1)}
              aria-label="Siguiente"
            >
              →
            </Button>
          </div>
        )}

        {shown.length === 0 && (
          <p class="rounded-xl bg-white p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">
            No quedan números disponibles.
          </p>
        )}

        <div class="grid grid-cols-5 gap-1.5 sm:grid-cols-8 md:grid-cols-10">
          {shown.map((n) => {
            const status = taken.get(n);
            const isSel = selected.includes(n);
            const cls = isSel
              ? "border-indigo-600 bg-indigo-600 text-white"
              : status === "apartado"
                ? "border-amber-400 bg-amber-100 text-amber-900"
                : status === "vendido"
                  ? "border-slate-300 bg-slate-200 text-slate-400 line-through"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
            const state = isSel ? "elegido" : (status ?? "disponible");
            return (
              <button
                key={n}
                type="button"
                data-number={n}
                data-state={state}
                disabled={status !== undefined}
                aria-pressed={isSel}
                aria-label={`Número ${label(n)}, ${state}`}
                onClick={() => toggle(n)}
                class={`rounded-md border py-2 text-sm font-semibold tabular-nums transition-colors disabled:cursor-not-allowed ${cls}`}
              >
                {label(n)}
              </button>
            );
          })}
        </div>

        <p class="pt-4 text-center text-xs text-slate-500">
          Los datos que compartas por WhatsApp se tratan según la{" "}
          <Link href={`/r/${org}/${slug}/privacidad`} class="underline">
            política de privacidad
          </Link>
          .
        </p>
      </main>

      {turnstileSiteKey && (
        <div class="mx-auto max-w-3xl px-4">
          <TurnstileWidget siteKey={turnstileSiteKey} resetKey={resetKey} onToken={setToken} />
        </div>
      )}

      {selected.length > 0 && (
        <div class="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <div class="mx-auto max-w-3xl space-y-2">
            <ErrorBox message={error} />
            {notice && (
              <p role="status" class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {notice}
              </p>
            )}
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div class="min-w-0 text-sm">
                <p class="break-words font-semibold text-slate-900">
                  {selected.length} {plural(selected.length, "número", "números")}:{" "}
                  {selected.map(label).join(", ")}
                </p>
                {total !== null && (
                  <p class="text-slate-600">
                    Total: <b>{formatMoney(total)}</b>
                  </p>
                )}
              </div>
              <div class="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => setSelected([])} disabled={busy}>
                  Limpiar
                </Button>
                <Button class="flex-1 sm:flex-none" onClick={reserve} disabled={busy}>
                  {busy ? "Apartando…" : "Apartar por WhatsApp"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {selected.length === 0 && (error || notice) && (
        <div class="fixed inset-x-0 bottom-0 z-40 p-3">
          <div class="mx-auto max-w-3xl space-y-2">
            <ErrorBox message={error} />
            {notice && (
              <p
                role="status"
                class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow"
              >
                {notice}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: preact.ComponentChildren }) {
  return <li class="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{children}</li>;
}

function Key({ cls, children }: { cls: string; children: preact.ComponentChildren }) {
  return (
    <li class="flex items-center gap-1.5">
      <span class={`inline-block h-3 w-3 rounded border ${cls}`} />
      {children}
    </li>
  );
}

function Success({
  done,
  label,
  onClose,
}: {
  done: { result: ReserveResponse; url: string };
  label: (n: number) => string;
  onClose: () => void;
}) {
  const { result, url } = done;
  return (
    <section
      class="space-y-3 rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-200"
      aria-live="polite"
    >
      <h2 class="text-lg font-bold text-emerald-900">¡Apartado! Falta un paso</h2>
      <p class="text-sm text-emerald-900">
        {result.numbers.length === 1 ? "El número" : "Los números"}{" "}
        <b>{result.numbers.map(label).join(", ")}</b>{" "}
        {result.numbers.length === 1 ? "quedó apartado" : "quedaron apartados"}. Tu código es{" "}
        <b class="font-mono">{result.code}</b>.
        <br />
        Vigente hasta: <b>{formatDateTime(result.reservedUntil)}</b>
      </p>
      <p class="text-sm text-emerald-900">
        Envía el mensaje por WhatsApp para confirmar y coordinar el pago. Si no se abrió solo, usa
        este botón:
      </p>
      <div class="flex flex-wrap gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Abrir WhatsApp
        </a>
        <Button variant="secondary" onClick={onClose}>
          Apartar otros números
        </Button>
      </div>
    </section>
  );
}
