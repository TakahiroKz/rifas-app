import type { SessionResponse } from "@rifas/contracts";
import { useState } from "preact/hooks";
import { api } from "../api";
import { Button, ErrorBox, Field, inputClass } from "../ui";

export function Login({ onLogin }: { onLogin: (s: SessionResponse) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 class="text-center text-2xl font-bold text-slate-900">Tu Rifa</h1>
      <p class="mb-6 text-center text-sm text-slate-500">Panel de administración</p>
      <form
        onSubmit={submit}
        class="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
      >
        <Field label="Correo">
          <input
            class={inputClass}
            type="email"
            autocomplete="username"
            required
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Field label="Contraseña">
          <input
            class={inputClass}
            type="password"
            autocomplete="current-password"
            required
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </Field>
        <ErrorBox message={error} />
        <Button type="submit" class="w-full" disabled={busy}>
          {busy ? "Ingresando…" : "Ingresar"}
        </Button>
      </form>
    </main>
  );
}
