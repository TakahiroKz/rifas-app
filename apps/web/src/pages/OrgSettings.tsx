import { useState } from "preact/hooks";
import { api } from "../api";
import { useSession } from "../session";
import { Button, ErrorBox, Field, inputClass, useToast } from "../ui";

export function OrgSettings() {
  const { session, setSession } = useSession();
  const toast = useToast();
  const [name, setName] = useState(session.organization.name);
  const [phone, setPhone] = useState(session.organization.whatsappPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api.updateOrganization({ name, whatsappPhone: phone }));
      toast("Cambios guardados");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="mx-auto max-w-lg space-y-4">
      <h1 class="text-xl font-bold text-slate-900">Ajustes</h1>
      <form
        onSubmit={save}
        class="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
      >
        <Field label="Nombre">
          <input
            class={inputClass}
            required
            minLength={2}
            maxLength={80}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Field
          label="WhatsApp para recibir los apartados"
          hint="Con indicativo del país y sin '+', por ejemplo 573001112233."
        >
          <input
            class={inputClass}
            inputMode="numeric"
            required
            pattern="\d{10,15}"
            value={phone}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
          />
        </Field>
        <ErrorBox message={error} />
        <Button type="submit" class="w-full" disabled={busy}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </Button>
      </form>
    </div>
  );
}
