# Rifas

Plataforma web low cost para gestionar **los números de una rifa** (sin pagos en línea) y consultar **resultados de loterías** de Colombia y otros países. Nace para un solo organizador y está pensada para crecer a microSaaS multiusuario.

- **Página pública**: el cliente ve los números, elige uno o varios y se abre WhatsApp con un mensaje prellenado. El número queda *apartado* 24 h.
- **Panel admin**: el organizador crea rifas, marca números como *vendido* (*pagado* o *debe* con fecha) y consulta el historial.
- **Loterías y premios**: cada premio usa las primeras o últimas cifras del resultado de una lotería (Chontico Noche, Dorado Noche, Lotería del Valle). Se confirma el ganador y se reprograma si no hay. La plataforma no hace sorteos ni capta dinero.

> Estado: **Fase 4 completada** (loterías y premios). Falta pulir (Fase 5) y publicar: ver la lista previa en [`docs/PLAN.md`](docs/PLAN.md#14-lista-previa-a-publicar-lanzamiento). Ver [`docs/PLAN.md`](docs/PLAN.md).

## Requisitos
- Node.js 22 (`.nvmrc`) y [pnpm](https://pnpm.io) 10.

## Comandos
```bash
pnpm install       # instalar dependencias
pnpm dev           # API (wrangler, :8787) + web (vite, :5173)
pnpm check         # lint + typecheck + pruebas
pnpm build         # compila la web y valida el Worker (dry-run)
```
Base de datos local (D1 simulada) y datos de ejemplo:
```bash
cd apps/api && pnpm exec wrangler d1 migrations apply rifas-db --local
```
Crear el primer administrador (no hay registro abierto; la contraseña se pide oculta):
```bash
pnpm admin:create --email tu@correo.com --name "Tu Nombre" --org-slug finaura --org-name "Capital Finaura" --whatsapp 573001112233
```
Agrega `--remote` para crearlo en la base de producción. Luego abre `http://localhost:5173/admin` tras `pnpm dev`.

Para desarrollo local, copia `.dev.vars.example` a `apps/api/.dev.vars` (no se versiona): desactiva Turnstile en local. Enlace público de una rifa: `/r/<organización>/<rifa>`.

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
