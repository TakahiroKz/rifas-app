# Contexto del proyecto: Rifas

App web low cost para gestionar números de rifas. Idioma de UI y docs: **español (Colombia)**.

## Reglas
- Alcance mínimo: solo gestión de números. Nada de pasarelas de pago ni cuentas de clientes.
- Infraestructura gratuita/barata (ver docs/PLAN.md). No añadir servicios de pago sin consultar.
- Un solo admin. La página pública no requiere login.
- La reserva de números debe ser atómica (evitar que dos personas tomen el mismo número).
- Nunca commitear secretos (`.dev.vars`, `.env`). Usar `.env.example`.
- Seguir el plan por fases en docs/PLAN.md; no implementar fases futuras sin pedirlo.
