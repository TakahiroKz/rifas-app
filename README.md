# Rifas

Plataforma web low cost para gestionar **los números de una rifa** (sin pagos en línea) y consultar **resultados de loterías** de Colombia y otros países. Nace para un solo organizador y está pensada para crecer a microSaaS multiusuario.

- **Página pública**: el cliente ve los números, elige uno o varios y se abre WhatsApp con un mensaje prellenado. El número queda *apartado* 24 h.
- **Panel admin**: el organizador crea rifas, marca números como *vendido* (*pagado* o *debe* con fecha) y consulta el historial.
- **Loterías**: resultados de Gane (API/scraping) para anunciar el ganador. La plataforma no hace sorteos ni capta dinero.

> Estado: **Fase 0 completada** (estructura y herramientas). La lógica de negocio llega en la Fase 1. Ver [`docs/PLAN.md`](docs/PLAN.md).

## Requisitos
- Node.js 22 (`.nvmrc`) y [pnpm](https://pnpm.io) 10.

## Comandos
```bash
pnpm install       # instalar dependencias
pnpm dev           # API (wrangler, :8787) + web (vite, :5173)
pnpm check         # lint + typecheck + pruebas
pnpm build         # compila la web y valida el Worker (dry-run)
```
Para desarrollo local con secretos, copia `.dev.vars.example` a `apps/api/.dev.vars` (no se versiona).

## Estructura
```
apps/api               Worker (Hono): API y tareas programadas
apps/web               SPA (Vite + Preact + Tailwind)
packages/core          Dominio y casos de uso (sin I/O)
packages/lottery-sources  Fuentes de resultados (Gane)
packages/contracts     Esquemas zod compartidos API ↔ web
migrations/            SQL de D1
```

## Documentación
- [Plan del proyecto](docs/PLAN.md): alcance, estados, stack, modelo de datos, fases.
- [Política de privacidad (borrador)](docs/PRIVACIDAD.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Fuente de resultados: Gane](docs/GANE-API.md)
