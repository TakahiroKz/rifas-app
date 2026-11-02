# Plan: Plataforma de rifas (microSaaS)

> Estado: planificación. Última actualización: 2026-11-02.

## 1. Visión
Plataforma para gestionar **los números de una rifa** (sin pagos en línea) y, además, **consultar resultados de loterías y sorteos** (Colombia y otros países) para definir ganadores.

- **Hoy**: un solo organizador (Leo) y una rifa activa a la vez.
- **Mañana**: microSaaS multiusuario; cualquier persona se registra y gestiona sus propias rifas.
- Por eso el diseño es **multi-tenant desde el día 1**, aunque la interfaz inicial exponga solo un admin.

**Fuera de alcance (por ahora)**: pagos en línea, cuentas de compradores, cobro de suscripciones.

## 2. Actores
| Rol | Acceso | Qué hace |
|---|---|---|
| Admin / organizador | Panel con login | Crea rifas, gestiona números, registra ventas y deudas, ve historial |
| Público | Página sin login | Ve números, elige uno o varios, abre WhatsApp |
| Sistema | Tareas programadas | Expira apartados a las 24 h, obtiene resultados de loterías |

## 3. Estados de un número
| Estado | Significado | Quién lo cambia |
|---|---|---|
| `activo` | Libre, nadie lo ha pagado ni apartado | — |
| `apartado` | Alguien lo apartó por WhatsApp. **Caduca a las 24 h** y vuelve a `activo` | Público (al pulsar el botón); el sistema lo expira |
| `vendido` | El admin lo bloqueó a mano | Admin |

**Deuda**: un número `vendido` tiene además `payment_status`: `pagado` o `debe`. Si `debe`, lleva una **fecha de pago programada** (`due_date`) y se puede listar/alertar lo vencido.

```
activo ──(público, WhatsApp)──▶ apartado ──(24 h sin gestión)──▶ activo
   ▲                               │
   │                               └──(admin)──▶ vendido [pagado | debe + fecha]
   └──────────────(admin libera)───────────────────────┘
```

**Historial**: toda transición se guarda en una tabla de eventos (apartados caducados incluidos), visible solo para el admin.

## 4. Flujo público
1. `/<org>/<rifa>` muestra la cuadrícula (activo / apartado / vendido). No se muestran datos de compradores.
2. El cliente elige uno o varios números `activo`.
3. Pulsa **"Apartar por WhatsApp"**: el backend aparta los números de forma **atómica** (todo o nada) y se abre `https://wa.me/<tel>?text=<mensaje>` con la rifa y los números.
4. Los datos personales (nombre, etc.) se piden **dentro de WhatsApp**, no en la web.
5. El admin cobra por fuera y en el panel marca `vendido` (+ `pagado` o `debe` con fecha).

## 5. Módulo de resultados de loterías (scraping)
Objetivo: tener resultados oficiales de loterías/sorteos para vincularlos a una rifa y determinar el número ganador.

### Diseño
- **Adaptadores por fuente**: cada lotería/sorteo tiene un adaptador aislado (`fetch` + `parse` → resultado normalizado). Si una web cambia, solo se arregla ese adaptador.
- **Ejecución programada**: Cron Triggers de Workers o un scraper en GitHub Actions (gratis) que envía resultados al API. Para sitios que requieren JavaScript, usar Playwright en Actions antes que pagar un navegador remoto.
- **Entrada manual de respaldo**: el admin puede digitar un resultado si falla el scraping (y queda marcado como manual).
- **Trazabilidad**: se guarda fuente, URL, fecha de captura y el dato crudo, para poder auditar un ganador.
- **Alertas**: si un adaptador falla o devuelve datos raros, se notifica al admin.

### Alcance gradual
1. Colombia: loterías regionales (Bogotá, Medellín, Cundinamarca, Boyacá, Valle, Cauca, Huila, Manizales, Meta, Risaralda, Santander, Tolima, Quindío), Baloto/Revancha y chances.
2. Otros países (México, España, Argentina, etc.) según demanda.

### Vinculación con una rifa
La rifa define: lotería, fecha del sorteo y **regla del número ganador** (p. ej. últimas *k* cifras del resultado, con *k* = cifras del total de números). Al publicarse el resultado, el sistema propone el ganador y el admin lo confirma.

### Riesgos a validar
- **Términos de uso / robots.txt** de cada fuente; preferir fuentes oficiales o APIs. Citar la fuente siempre.
- **Fragilidad** del scraping: por eso adaptadores aislados, pruebas con HTML guardado y entrada manual de respaldo.

## 6. Datos personales y legal
- **Política de privacidad**: borrador en [`docs/PRIVACIDAD.md`](PRIVACIDAD.md) (Colombia, Ley 1581 de 2012 / habeas data). Requiere revisión de un abogado antes de publicarse.
- Los datos del comprador se recogen por WhatsApp; en la app se guardan solo los que el admin registre (nombre, teléfono, nota).
- **Verificar la normativa de rifas** (en Colombia las rifas son juegos de suerte y azar con régimen de autorización, Ley 643 de 2001, y ante la autoridad local competente). Es clave para un microSaaS: definir si la plataforma exige al organizador declarar que cuenta con el permiso. *No es asesoría legal.*

## 7. Modelo de datos (borrador, multi-tenant)
- **users**: id, email, password_hash, name, created_at
- **organizations**: id, name, slug, whatsapp_phone, created_at
- **memberships**: user_id, org_id, role (`owner`/`admin`)
- **raffles**: id, org_id, slug, title, description, prize, total_numbers (10–100000), number_start (0|1), ticket_price, status (`borrador`/`activa`/`cerrada`), lottery_id, draw_date, winning_rule, created_at
- **tickets**: raffle_id, number, status (`activo`/`apartado`/`vendido`), payment_status (`pagado`/`debe`/null), due_date, buyer_name, buyer_phone, note, reserved_at, reserved_until, sold_at, updated_at — PK (raffle_id, number)
- **ticket_events**: id, raffle_id, number, from_status, to_status, actor (`public`/`admin`/`system`), at, meta — historial
- **lotteries**: id, country, name, schedule, source_adapter
- **draw_results**: id, lottery_id, draw_date, winning_number, series, source_url, raw, fetched_at, is_manual
- Toda consulta se filtra por `org_id` (aislamiento entre organizadores).

### Tamaño: rifas de hasta 100 000 números
- No materializar filas para números `activo`: solo guardar filas de `apartado`/`vendido`; el resto se infiere por rango. Evita insertar 100 000 filas por rifa en D1.
- La cuadrícula pública debe virtualizarse o paginarse; la API entrega solo los números **no libres** y el cliente deduce los libres.
- Reserva atómica con transacción/`batch` de D1 y verificación de filas afectadas.

## 8. Stack (low cost, ~$0/mes al inicio)
| Capa | Opción |
|---|---|
| Hosting + API | Cloudflare Pages + Workers (Hono, TypeScript) |
| Base de datos | Cloudflare D1 (SQLite) |
| Frontend | Vite + Preact (ligero en móvil, cuadrícula virtualizada) |
| Auth | Email + contraseña con hash en WebCrypto (PBKDF2) y cookie de sesión `HttpOnly`; un solo usuario habilitado al inicio |
| Tareas programadas | Cron Triggers (expirar apartados cada pocos minutos; resultados) |
| Scraping pesado | GitHub Actions + Playwright → API |
| Correo (futuro) | Cloudflare Email / Resend (free) para recuperar contraseña |

### Dominios
Sí se pueden usar **varios dominios**: Cloudflare Pages permite agregar varios dominios y subdominios personalizados al mismo proyecto (p. ej. `rifas.tudominio.com` para el producto y otro dominio para otra marca). Para el futuro SaaS, **Cloudflare for SaaS** permite que cada cliente use su propio dominio (hay un cupo gratuito de hostnames, a verificar al momento de implementarlo). Para organizarlo: `app.` (admin), `<org>.` o `/<org>/` (público).

## 9. Seguridad
- Validación en servidor (rango, máximo de números por solicitud, formato).
- Rate limiting en la ruta pública de apartado (anti-abuso: alguien podría apartar todos los números); límite de números apartados por IP/sesión.
- Cookies `Secure`/`SameSite`, protección CSRF en el panel.
- Secretos solo como variables/secrets de Cloudflare; nunca en el repositorio.
- Copias de seguridad de D1 (export programado).

## 10. Fases
1. **Fase 0 – Repo y tooling**: estructura, TypeScript, lint/format, CI, `.env.example`, proyecto Cloudflare.
2. **Fase 1 – Núcleo**: esquema D1 multi-tenant, API de rifas y números, reserva atómica, expiración a 24 h, historial, pruebas.
3. **Fase 2 – Admin**: login, CRUD de rifas, tablero de números, vendido/pagado/debe con fecha, historial.
4. **Fase 3 – Público**: cuadrícula, selección, apartado + WhatsApp, política de privacidad enlazada.
5. **Fase 4 – Loterías**: modelo de resultados, 2–3 adaptadores de Colombia, entrada manual, vinculación a rifa y sugerencia de ganador.
6. **Fase 5 – Pulido**: estadísticas, CSV, alertas de deuda vencida, despliegue y dominio.
7. **Fase 6 – SaaS**: registro abierto, organizaciones, límites/planes, dominios por cliente, términos y condiciones.

## 11. Estructura propuesta
```
rifas/
├─ apps/web/         # frontend público + admin
├─ apps/api/         # Workers + Hono + D1
├─ packages/scrapers # adaptadores de loterías
├─ migrations/       # SQL de D1
├─ docs/
└─ README.md
```

## 12. Decisiones tomadas
| Tema | Decisión |
|---|---|
| Estados | `activo` / `apartado` / `vendido` |
| Apartado | Caduca solo a las 24 h; queda en historial |
| Deuda | Número `vendido` con `debe` + fecha de pago programada |
| Rifas | Una activa hoy; arquitectura multi-tenant |
| Cantidad de números | 10 a 100 000 |
| Datos del comprador | Se piden por WhatsApp; política de privacidad requerida |
| Loterías | Scraping de Colombia y otros países + entrada manual |
| Infra | Cloudflare (con dominio propio) |

## 13. Preguntas abiertas
1. **Regla del ganador** cuando el total no es potencia de 10 (50, 200, 300): ¿últimas 2 o 3 cifras y se repite el sorteo si cae fuera de rango, o módulo del total?
2. ¿Numeración desde 0 (00–99) o desde 1? Afecta la cantidad de cifras.
3. ¿Quieres **un teléfono de WhatsApp por organización** o por rifa?
4. ¿El admin necesita **recordatorios** de deudas por vencer (email/WhatsApp/notificación) o basta con un listado?
5. ¿Cuál es el dominio que usarás y qué subdominio quieres para el panel y para lo público?
6. Prioridad de loterías para la Fase 4: ¿cuáles son las 2 o 3 que más usas para tus rifas?
7. ¿Ya cuentas con el permiso/autorización para tus rifas? Define si la plataforma debe pedirlo a futuros usuarios.
