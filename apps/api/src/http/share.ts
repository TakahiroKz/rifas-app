import { getPublicRaffle } from "@rifas/core";
import type { Context } from "hono";
import type { AppEnv } from "../app";

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Etiquetas para la vista previa del enlace (WhatsApp, redes). Todo valor se escapa. */
export function shareTags(input: { title: string; description: string; url: string }): string {
  const t = escapeHtml(input.title);
  const d = escapeHtml(input.description);
  const u = escapeHtml(input.url);
  return [
    `<meta name="description" content="${d}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Tu Rifa">`,
    `<meta property="og:locale" content="es_CO">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${u}">`,
    `<meta name="twitter:card" content="summary">`,
    `<link rel="canonical" href="${u}">`,
  ].join("");
}

/**
 * Sirve el index.html de la web con título y etiquetas de vista previa propias de la rifa, para que
 * al compartir el enlace por WhatsApp se vea el nombre de la rifa. Si no existe, sirve el HTML normal.
 */
export async function serveRafflePage(c: Context<AppEnv>): Promise<Response> {
  const origin = new URL(c.req.url).origin;
  const page = await c.env.ASSETS.fetch(new Request(new URL("/index.html", origin)));
  if (!page.ok) return page;

  const org = c.req.param("org") ?? "";
  const slug = c.req.param("raffle") ?? "";
  let meta: { title: string; description: string } | null = null;
  try {
    const found = await getPublicRaffle(c.get("deps"), { orgSlug: org, raffleSlug: slug });
    if (found.ok) {
      const { organization, raffle } = found.value;
      const bits = [
        raffle.status === "cerrada" ? "Rifa cerrada" : "Elige y aparta tus números por WhatsApp",
        raffle.ticketPrice !== null
          ? `$${raffle.ticketPrice.toLocaleString("es-CO")} por número`
          : null,
        raffle.drawDate ? `Sorteo: ${raffle.drawDate}` : null,
      ].filter(Boolean);
      meta = {
        title: `${raffle.title} · ${organization.name}`,
        description: clip(
          raffle.description.trim()
            ? `${raffle.description.trim().replace(/\s+/g, " ")} — ${bits.join(" · ")}`
            : bits.join(" · "),
          200,
        ),
      };
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "vista previa sin datos",
        error: (error as Error).message,
      }),
    );
  }

  const headers = new Headers(page.headers);
  headers.delete("etag");
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=60");
  if (!meta) return new Response(page.body, { status: 200, headers });

  const tags = shareTags({
    ...meta,
    url: `${origin}/r/${encodeURIComponent(org)}/${encodeURIComponent(slug)}`,
  });
  return new HTMLRewriter()
    .on("title", { element: (e) => void e.setInnerContent(meta.title) })
    .on("head", { element: (e) => void e.append(tags, { html: true }) })
    .transform(new Response(page.body, { status: 200, headers }));
}
