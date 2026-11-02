import { Link } from "wouter-preact";
import { publicApi } from "../public-api";
import { useAsync } from "../ui";

/**
 * Mientras esto sea `false`, la página muestra un aviso de "versión preliminar".
 * Cambiar a `true` solo cuando un abogado haya revisado el texto (ver docs/PRIVACIDAD.md).
 */
export const PRIVACY_POLICY_REVIEWED = false;

const UPDATED = "2 de noviembre de 2026";

export function Privacy({ org, raffle }: { org: string; raffle: string }) {
  const info = useAsync(() => publicApi.getRaffle(org, raffle), [org, raffle]);
  const name = info.data?.organization.name ?? "el organizador de la rifa";
  const phone = info.data?.organization.whatsappPhone;

  return (
    <div class="min-h-screen bg-slate-50">
      <main class="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-6 text-slate-700">
        <Link href={`/r/${org}/${raffle}`} class="text-slate-500 hover:text-slate-800">
          ← Volver a la rifa
        </Link>
        <h1 class="text-2xl font-bold text-slate-900">Política de privacidad</h1>
        <p class="text-xs text-slate-500">Última actualización: {UPDATED}</p>
        {!PRIVACY_POLICY_REVIEWED && (
          <p role="note" class="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
            Versión preliminar, pendiente de revisión legal.
          </p>
        )}

        <Section title="1. Quién trata tus datos">
          <p>
            El responsable del tratamiento es <b>{name}</b>, organizador de la rifa.
            {phone ? (
              <>
                {" "}
                Puedes contactarlo por WhatsApp al <b>+{phone}</b>.
              </>
            ) : null}{" "}
            Esta página es solo el medio técnico para elegir y apartar números.
          </p>
        </Section>

        <Section title="2. Qué datos tratamos">
          <ul class="list-disc space-y-1 pl-5">
            <li>
              <b>En esta página no te pedimos datos personales.</b> No necesitas registrarte.
            </li>
            <li>
              <b>Por WhatsApp</b> compartes voluntariamente tu nombre, tu teléfono y los números que
              apartaste. Quien organiza la rifa los registra para gestionar tu apartado y tu pago.
            </li>
            <li>
              <b>Seguridad:</b> para evitar abusos guardamos, mientras dura el apartado, una huella
              irreversible de tu conexión (no tu dirección IP). Cloudflare, nuestro proveedor de
              infraestructura, procesa tu conexión para verificar que eres una persona.
            </li>
          </ul>
        </Section>

        <Section title="3. Para qué los usamos">
          <p>
            Gestionar el apartado, la venta y el pago de tus números; contactarte sobre ellos y
            sobre los resultados; anunciar a los ganadores con base en resultados oficiales de
            terceros; y proteger el servicio contra fraude y abuso. Esta plataforma no realiza
            sorteos ni cobra en línea.
          </p>
        </Section>

        <Section title="4. Tu autorización">
          <p>
            Al enviar por WhatsApp el mensaje con tu código de apartado, y compartir tus datos,
            autorizas su tratamiento conforme a esta política. Solo pueden participar mayores de 18
            años.
          </p>
        </Section>

        <Section title="5. Tus derechos">
          <p>
            Puedes conocer, actualizar y rectificar tus datos, pedir prueba de tu autorización,
            saber cómo se usan, revocar tu autorización y pedir que los eliminemos, y presentar
            quejas ante la Superintendencia de Industria y Comercio. Escribe al contacto del punto
            1. Atendemos consultas en máximo 10 días hábiles y reclamos en máximo 15 días hábiles
            (Ley 1581 de 2012).
          </p>
        </Section>

        <Section title="6. Cuánto tiempo los conservamos">
          <p>
            Mientras dure la rifa y el tiempo necesario para atender reclamos y obligaciones
            legales. Después se eliminan o se anonimizan. Los apartados que caducan sin pago se
            conservan solo en un historial interno del organizador.
          </p>
        </Section>

        <Section title="7. Terceros">
          <p>
            No vendemos tus datos. Usamos Cloudflare para alojar el servicio y WhatsApp (Meta) para
            la conversación; cada uno se rige por sus propias políticas y puede procesar datos fuera
            de Colombia con medidas de seguridad adecuadas.
          </p>
        </Section>

        <Section title="8. Cambios">
          <p>Publicaremos cualquier cambio en esta página, con su fecha de actualización.</p>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="space-y-1.5">
      <h2 class="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
