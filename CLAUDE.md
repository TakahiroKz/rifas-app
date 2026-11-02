# Contexto del proyecto: Rifas

App web low cost (microSaaS a futuro, multi-tenant) para gestionar números de rifas y consultar resultados de loterías. Idioma de UI y docs: **español (Colombia)**.

## Reglas
- Alcance: gestión de números + resultados de loterías (scraping). Sin pasarelas de pago ni cuentas de compradores.
- Infraestructura gratuita/barata (ver docs/PLAN.md). No añadir servicios de pago sin consultar.
- Hoy un solo admin y una rifa activa, pero el modelo de datos es multi-tenant (org_id en todo).
- La reserva de números debe ser atómica (evitar que dos personas tomen el mismo número).
- Nunca commitear secretos (`.dev.vars`, `.env`). Usar `.env.example`.
- Seguir el plan por fases en docs/PLAN.md; no implementar fases futuras sin pedirlo.
- Estados de número: `activo` / `apartado` (caduca a las 24 h, con historial) / `vendido` (pagado o debe + fecha).
- Los datos personales del comprador se piden por WhatsApp, no en la web pública.
- Scraping: un adaptador aislado por fuente, con entrada manual de respaldo y trazabilidad de la fuente.
- No realizamos sorteos ni captamos dinero: solo gestionamos números y anunciamos ganadores con resultados de terceros (Gane).
- Números desde 00, con ceros a la izquierda (ancho = cifras de total-1). Premios con regla `first`/`last` + 1–4 cifras.
- WhatsApp: `https://wa.me/<tel sin +>?text=<mensaje url-encoded>`; el único parámetro es `text`.
- Dominio: turifa.capitalfinaura.com (Cloudflare).
