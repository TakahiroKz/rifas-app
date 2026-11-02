# Plan: App de rifas

## 1. Objetivo y alcance
Gestionar los números de una rifa. **Fuera de alcance**: pagos en línea, cuentas de clientes, sorteo automático (se puede evaluar después).

### Usuarios
| Rol | Acceso | Qué hace |
|---|---|---|
| Admin (Leo) | Panel protegido | Crea rifas, ve números, cambia estados, marca pagos/deudas |
| Público | Página sin login | Ve números, elige uno o varios, abre WhatsApp con el mensaje |

## 2. Flujo principal
1. El cliente entra a `/r/<slug>` y ve la cuadrícula de números (libre / apartado / pagado).
2. Selecciona uno o varios números libres y opcionalmente escribe su nombre.
3. Pulsa **"Apartar por WhatsApp"**: el backend **aparta** esos números (atómico) y el navegador abre `https://wa.me/<telefono>?text=<mensaje>` con los números elegidos.
4. El admin recibe el WhatsApp, cobra por fuera y en el panel marca el/los números como **pagado** (o **debe** si quedó pendiente).
5. Si un apartado no se paga, el admin lo libera manualmente (opcional: expiración automática, ver preguntas abiertas).

## 3. Estados de un número
`disponible` → `apartado` → `pagado`
- `debe`: apartado/entregado con saldo pendiente (ver pregunta abierta sobre abonos).
- El admin puede mover cualquier número a cualquier estado y liberarlo.

## 4. Modelo de datos (borrador)
- **raffles**: id, slug, title, description, prize, total_numbers, number_start (0 o 1), ticket_price, whatsapp_phone, status (borrador/activa/cerrada), draw_date, created_at
- **tickets**: raffle_id, number, status, buyer_name, buyer_phone, note, reserved_at, paid_at, updated_at — PK (raffle_id, number)
- Reserva atómica con `UPDATE tickets SET status='apartado' WHERE raffle_id=? AND number IN (...) AND status='disponible'` y verificar filas afectadas (todo o nada).

## 5. Pantallas
**Pública**: `/r/<slug>` cuadrícula, resumen de selección, botón WhatsApp, premio/precio/fecha.
**Admin**: login, lista de rifas, crear/editar rifa, tablero de números (filtros por estado, edición rápida, selección múltiple), resumen (vendidos, recaudado, pendiente), exportar CSV.

## 6. Stack propuesto (low cost, ~$0/mes)
| Capa | Opción | Por qué |
|---|---|---|
| Hosting + API | **Cloudflare Pages + Workers** (Hono, TypeScript) | Plan gratuito generoso, sin "dormirse" |
| Base de datos | **Cloudflare D1** (SQLite) | Gratis, suficiente para miles de números |
| Frontend | Vite + Preact (o HTML + JS ligero) | Bundle pequeño, rápido en móvil |
| Auth admin | Contraseña única + cookie firmada (secreto en variable de entorno) o Cloudflare Access | Un solo admin, sin complejidad |
| Dominio | Subdominio `*.pages.dev` gratis; dominio propio opcional | |

**Alternativa**: FastAPI + SQLite en un VPS barato (~$4-5/mes), más cercano a tu experiencia en Python pero con costo y mantenimiento. Otra: Supabase free (Postgres + auth), con el inconveniente de que pausa proyectos inactivos.

## 7. Seguridad y robustez
- Validar en servidor todo (números dentro de rango, máximo de números por solicitud).
- Rate limiting básico en la ruta pública de reservas (anti-abuso).
- Admin con cookie `HttpOnly`/`Secure`/`SameSite`, protección CSRF en acciones.
- Sin datos personales sensibles: solo nombre/teléfono opcionales.

## 8. Fases
1. **Fase 0 – Repo y tooling**: estructura, lint/format, CI básico, `.env.example`.
2. **Fase 1 – Núcleo**: esquema D1, API de rifas y números, reserva atómica, tests.
3. **Fase 2 – Admin**: login, CRUD de rifas, tablero de números.
4. **Fase 3 – Público**: cuadrícula, selección, redirección a WhatsApp.
5. **Fase 4 – Pulido**: resumen/estadísticas, CSV, expiración de apartados, despliegue y dominio.

## 9. Estructura de carpetas propuesta
```
rifas/
├─ apps/web/        # frontend (público + admin)
├─ apps/api/        # Workers + Hono + D1
├─ migrations/      # SQL de D1
├─ docs/
└─ README.md
```

## 10. Preguntas abiertas
1. ¿Se aparta el número al pulsar el botón de WhatsApp, o solo se manda el mensaje y tú lo bloqueas manualmente? (Recomendado: apartar al pulsar, para evitar que dos personas elijan el mismo.)
2. ¿Los apartados caducan solos (p. ej. 24 h) o los liberas tú?
3. ¿"Debe" significa abonos parciales (con monto) o solo una marca de pendiente?
4. ¿Una sola rifa activa a la vez o varias simultáneas?
5. ¿Cantidad típica de números (100, 1000, 10000)? Define la UI de la cuadrícula.
6. ¿Se muestra públicamente el nombre del comprador o solo "vendido"?
7. ¿Quieres sorteo dentro de la app o solo gestión?
