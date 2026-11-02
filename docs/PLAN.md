# Plan: Plataforma de rifas (microSaaS)

> Estado: Fase 4 completada. Última actualización: 2026-11-02. Repo: `TakahiroKz/rifas-app`.

## 1. Visión
Plataforma para gestionar **los números de una rifa** (sin pagos en línea) y, además, **consultar resultados de loterías y sorteos** (Colombia y otros países) para anunciar ganadores.

**Principio de negocio**: la plataforma **no realiza sorteos ni capta dinero**. Solo gestiona números y anuncia al ganador con base en resultados oficiales de terceros (p. ej. [gane.com.co](https://www.gane.com.co)). Captar dinero por rifa se estudiaría a largo plazo.

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
3. Pulsa **"Apartar por WhatsApp"**: el backend aparta los números de forma **atómica** (todo o nada) y se abre el enlace de WhatsApp con la rifa y los números (ver §4.1).
4. Los datos personales (nombre, etc.) se piden **dentro de WhatsApp**, no en la web.
5. El admin cobra por fuera y en el panel marca `vendido` (+ `pagado` o `debe` con fecha).

### 4.1 Enlace de WhatsApp
Formato: `https://wa.me/<telefono_sin_+>?text=<mensaje_url_encoded>` (el teléfono va **sin** `+` ni espacios, con indicativo de país; p. ej. `57…`).
El **único parámetro** que acepta `wa.me` para prellenar datos es `text`. Todo lo demás (rifa, números) debe ir dentro de ese texto, codificado con `encodeURIComponent`.

Ejemplo de mensaje (antes de codificar):
```
Hola, quiero apartar los números 07, 23 y 85 de la rifa "Rifa de Navidad".
Código de apartado: RF-4K9P (válido 24 h).
Política de privacidad: https://turifa.capitalfinaura.com/privacidad
```
El **código de apartado** permite al admin buscar el apartado rápido en el panel. El teléfono es una configuración de la organización (no se escribe en el código).

## 5. Módulo de resultados de loterías

Objetivo: obtener resultados oficiales de loterías/sorteos, vincularlos a una rifa y **anunciar** el ganador. Nosotros no hacemos el sorteo.

### Fuentes
- **Prioridad**: Gane (gane.com.co). Hallazgos y endpoints en [`GANE-API.md`](GANE-API.md). Leo trabajó en Gane y conoce los datos; antes de integrar, **confirmar por escrito que el uso de esas APIs es permitido** y usar solo endpoints públicos/autorizados (nunca credenciales ni accesos internos).
- Si no hay API: scraping de la página oficial, citando siempre la fuente.
- Entrada manual de respaldo (marcada como manual).

### Loterías/sorteos iniciales (Fase 4)
1. **Chontico** (Noche; los domingos/festivos cambia a *Festivo Noche*)
2. **Dorado Noche** (los domingos/festivos cambia a *Dorado Festivo*)
3. **Lotería del Valle**

Fuente: endpoint público de Gane (`/consultar?fecha_especifica=`), resultado de 4 cifras + serie. El adaptador resuelve el código de sorteo según la fecha (ver `GANE-API.md`).

### Diseño
- **Adaptador por fuente**: `fetch` + `parse` → resultado normalizado. Si cambia una API o web, solo se arregla ese adaptador.
- **Ejecución**: Cron Triggers de Workers para APIs; para sitios con JavaScript, scraper en GitHub Actions (Playwright) que envía al API.
- **Trazabilidad**: fuente, URL, fecha de captura y dato crudo.
- **Alertas** al admin si un adaptador falla o devuelve datos raros.

### Premios y reglas de ganador
Una rifa puede tener **N premios** (lugares). Cada premio define su propia regla:
| Campo | Ejemplo |
|---|---|
| `place` | 1.º, 2.º, 3.º… |
| `lottery_id` | Chontico / Dorado Noche / Lotería del Valle |
| `match_type` | `last` (últimas cifras) o `first` (primeras cifras) |
| `digits` | 1, 2, 3 o 4 |

Ejemplo: 1.º lugar = **últimas 2 cifras** del resultado; 2.º lugar = **primeras 2 cifras** del resultado.
Los números de la rifa **empiezan en 00** y se muestran con ceros a la izquierda (ancho = cifras de `total_numbers - 1`; 100 números → `00–99`; 10 000 números → `0000–9999`). **Máximo 4 cifras** por número..
Al publicarse el resultado, el sistema calcula los números ganadores por premio, y el admin los **confirma y anuncia**.

**Sin ganador** (incluye que el número ganador no se haya vendido): según la política del premio que defina el admin, el premio **finaliza** o se **reprograma** (sigue `pendiente` con la nueva fecha) y se **vuelve a evaluar con el próximo sorteo** de la lotería, en la fecha que ingrese el admin, hasta el máximo de reintentos que haya fijado (o sin límite). Cada intento queda en el historial. El selector de fecha **solo habilita los días en que esa lotería sortea** (calendario derivado del histórico de Gane).

### Riesgos
- Términos de uso de cada fuente (ver Fuentes).
- Fragilidad del scraping: adaptadores aislados, pruebas con HTML/JSON guardado y entrada manual.

## 6. Datos personales y legal
- **Política de privacidad**: borrador en [`docs/PRIVACIDAD.md`](PRIVACIDAD.md) (Colombia, Ley 1581 de 2012 / habeas data). Requiere revisión de un abogado antes de publicarse.
- Los datos del comprador se recogen por WhatsApp; en la app se guardan solo los que el admin registre (nombre, teléfono, nota).
- **Verificar la normativa de rifas** (en Colombia las rifas son juegos de suerte y azar con régimen de autorización, Ley 643 de 2001, y ante la autoridad local competente). Es clave para un microSaaS: definir si la plataforma exige al organizador declarar que cuenta con el permiso. *No es asesoría legal.*

## 7. Modelo de datos (borrador, multi-tenant)
- **users**: id, email, password_hash, name, created_at
- **organizations**: id, name, slug, whatsapp_phone (en config, formato `57XXXXXXXXXX`), created_at
- **memberships**: user_id, org_id, role (`owner`/`admin`)
- **raffles**: id, org_id, slug, title, description, total_numbers (10–10000), number_start (siempre 0), number_width, ticket_price, status (`borrador`/`activa`/`cerrada`), draw_date, created_at
- **raffle_prizes**: id, org_id, raffle_id, place, description, lottery_id, match_type (`last`/`first`), digits (1 a ancho del número), draw_date (la fija el admin y se mueve al reprogramar), on_no_winner (`reprogramar`/`finalizar`), max_attempts (null = sin límite), status (`pendiente`/`anunciado`/`finalizado`)
- **prize_draw_attempts**: id, org_id, prize_id, attempt_no, draw_date, result_number, outcome (`ganador`/`sin_ganador`), created_at — historial de intentos
- **prize_winners**: prize_id, number, attempt_id, org_id, buyer_name, buyer_phone, payment_status (copia al confirmar), created_at — un premio por número vendido que coincide
- **tickets** (modelo disperso: solo filas `apartado`/`vendido`; `activo` = sin fila): raffle_id, number, org_id, status (`apartado`/`vendido`), payment_status (`pagado`/`debe`), due_date, buyer_name, buyer_phone, note, reservation_code, reserved_at, reserved_until, sold_at, updated_at — PK (raffle_id, number)
- **ticket_events**: id, org_id, raffle_id, number, action (`reserve`/`expire`/`sell`/`update_payment`/`release`), from_status, to_status, actor (`public`/`admin`/`system`), reservation_code, meta, at — historial
- **Juegos de lotería**: catálogo en código (`packages/core/src/lotteries.ts`): id, nombre, días de sorteo y hora de publicación.
- **draw_results**: id, lottery_id, draw_date, number (4 cifras), series, source (`gane`/`manual`), source_ref, org_id (null = oficial; con valor = manual de esa organización), raw, fetched_at
- Toda consulta se filtra por `org_id` (aislamiento entre organizadores).

### Tamaño: rifas de 10 a 10 000 números (máx. 4 cifras)
- **Decidido**: modelo disperso (solo `apartado`/`vendido` tienen fila). Crear una rifa de 10 000 números no escribe filas en D1.
- La cuadrícula pública debe ser ligera en móvil (virtualizada o paginada en rifas grandes); la API puede entregar solo los números **no libres**.
- Reserva atómica con transacción/`batch` de D1 y verificación de filas afectadas.

## 8. Stack (low cost, ~$0/mes al inicio)
| Capa | Opción |
|---|---|
| Hosting + API | Cloudflare Pages + Workers (Hono, TypeScript) |
| Base de datos | Cloudflare D1 (SQLite) |
| Frontend | Vite + Preact (ligero en móvil, cuadrícula virtualizada) |
| Auth | Email + contraseña con hash en WebCrypto (PBKDF2) y cookie de sesión `HttpOnly`; un solo usuario habilitado al inicio |
| Tareas programadas | Cron Triggers (expirar apartados cada pocos minutos; consultar resultados) |
| Scraping pesado | GitHub Actions + Playwright → API |
| Correo (futuro) | Cloudflare Email / Resend (free) para recuperar contraseña |

### Dominios
Sí se pueden usar **varios dominios**: Cloudflare Pages permite agregar varios dominios y subdominios personalizados al mismo proyecto (p. ej. el producto en un subdominio y otra marca en otro dominio). Para el futuro SaaS, **Cloudflare for SaaS** permite que cada cliente use su propio dominio (hay un cupo gratuito de hostnames, a verificar al momento de implementarlo). **Dominio definido**: `capitalfinaura.com`. Público en **`turifa.capitalfinaura.com`**; el admin iría en `turifa.capitalfinaura.com/admin` (o `admin.turifa…`, por decidir). Verificar que el dominio use DNS de Cloudflare (o crear un CNAME del subdominio hacia Pages).

## 9. Seguridad
- Validación en servidor (rango, máximo de números por solicitud, formato).
- Rate limiting en la ruta pública de apartado (anti-abuso: alguien podría apartar todos los números); límite de números apartados por IP/sesión.
- Cookies `Secure`/`SameSite`, protección CSRF en el panel.
- Secretos solo como variables/secrets de Cloudflare; nunca en el repositorio.
- Copias de seguridad de D1 (export programado).

## 10. Fases
1. **Fase 0 – Repo y tooling** ✅ (base D1 de producción creada y con migraciones; falta el despliegue): monorepo pnpm, TypeScript, Biome, Vitest, CI, `.env.example`, proyecto Cloudflare (Worker + D1) y dominio.
2. **Fase 1 – Núcleo** ✅: esquema D1 multi-tenant, dominio y casos de uso, reserva atómica, expiración a 24 h, historial y API pública, con 51 pruebas (incluye concurrencia y aislamiento entre organizaciones).
3. **Fase 2 – Admin** ✅: login con sesiones seguras, CRUD de rifas, tablero de números, vender como pagado o debe con fecha, venta por código de apartado, listado de deudas, historial y ajustes. 88 pruebas automáticas más verificación de punta a punta en un navegador real.
4. **Fase 3 – Público** ✅: página pública, selección, apartado + WhatsApp con código, política de privacidad (preliminar), Turnstile, límite de tasa, tope por cliente y encabezados de seguridad. 114 pruebas automáticas + flujo completo verificado en navegador.
5. **Fase 4 – Loterías** ✅: catálogo de juegos con calendario (Chontico Noche, Dorado Noche, Lotería del Valle), adaptador de Gane con muestras reales, resultados oficiales y manuales, premios por terminación (1 a ancho cifras, primeras/últimas), propuesta + confirmación atómica, reprogramación con historial, Cron de resultados y ganadores en la página pública. 168 pruebas automáticas + flujo completo verificado en navegador.
6. **Fase 5 – Pulido**: estadísticas, CSV, alertas de deuda vencida, despliegue y dominio.
7. **Fase 6 – SaaS**: registro abierto, organizaciones, límites/planes, dominios por cliente, términos y condiciones.

## 11. Arquitectura
Ver [`ARQUITECTURA.md`](ARQUITECTURA.md): monorepo modular (`apps/api`, `apps/web`, `packages/core`, `packages/lottery-sources`, `packages/contracts`), Worker único con Hono + D1, reserva atómica, expiración, política de premios y estrategia de pruebas.

## 12. Decisiones tomadas
| Tema | Decisión |
|---|---|
| Estados | `activo` / `apartado` / `vendido` |
| Apartado | Caduca solo a las 24 h; queda en historial |
| Deuda | `vendido` con `debe` + fecha de pago; basta con un **listado** (sin recordatorios) |
| Rifas | Una activa hoy; arquitectura multi-tenant |
| Números | 10 a 10 000 (máx. **4 cifras**, `0000–9999`), **empiezan en 0** con ceros a la izquierda |
| Lógica de premios | **B: terminaciones de 1–4 cifras** (primeras o últimas). Cada coincidencia es un premio entregado. Aproximaciones quedan para más adelante |
| Admin | `turifa.capitalfinaura.com/admin` |
| Ganador por premio | Un solo número por premio; si coinciden varios, se entregan varios premios (cada uno es un premio) |
| Sorteo sin ganador | **Parametrizable por premio**: `reprogramar` (próximo sorteo, fecha del admin, solo días con sorteo) o `finalizar`. Cada intento queda en historial |
| Reintentos | Los define el admin por premio (o sin límite) |
| Sorteos | No los hacemos ni captamos dinero; anunciamos ganadores con resultados de terceros |
| Ganadores | N premios; regla por premio: primeras/últimas 1–4 cifras de una lotería |
| Fuente de resultados | Gane (API/sitio), con respaldo manual |
| Loterías iniciales | Chontico, Dorado Noche, Lotería del Valle |
| WhatsApp | `wa.me/<tel>?text=…` (único parámetro: `text`); teléfono en config |
| Dominio | `capitalfinaura.com`, público en `turifa.capitalfinaura.com` |
| Datos del comprador | Se piden por WhatsApp; política de privacidad requerida |
| Infra | Cloudflare |

## 13. Preguntas abiertas
1. **Gane**: confirmar por escrito el permiso para consumir sus endpoints (ver `GANE-API.md`).
2. ¿Ya cuentas con el permiso/autorización para tus rifas? (quien organiza la rifa sí lo necesita)
3. Las variantes de domingo/festivo (*Chontico Festivo Noche*, *Dorado Festivo*): se tratan como el mismo juego (supuesto actual).
4. Respaldos: ¿alcanza una exportación diaria a R2 o prefieres otro destino?

## 14. Lista previa a publicar (lanzamiento)
Pendiente de Leo / de revisión legal antes de abrir `turifa.capitalfinaura.com` al público:
- [ ] **Turnstile**: crear el widget (Cloudflare → Turnstile, hostname `turifa.capitalfinaura.com`), poner la clave pública en `TURNSTILE_SITE_KEY` (`wrangler.jsonc`) y el secreto con `wrangler secret put TURNSTILE_SECRET`.
- [ ] **Política de privacidad**: revisión de un abogado; luego poner `PRIVACY_POLICY_REVIEWED = true` (`apps/web/src/pages/Privacy.tsx`) para quitar el aviso de «versión preliminar».
- [ ] **Permiso de las rifas** ante la autoridad competente (Ley 643 de 2001) — a cargo del organizador.
- [ ] **Gane**: autorización por escrito. Mientras no la tengas, `LOTTERY_SYNC_ENABLED` queda en `"false"` y el resultado se ingresa a mano en el panel. Al tenerla: ponerla en `"true"` en `wrangler.jsonc`.
- [ ] **Despliegue**: aplicar al remoto las migraciones nuevas (la 0004 ya está en la base de producción); agregar secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en GitHub; activar la ruta `turifa.capitalfinaura.com` en `wrangler.jsonc`; aplicar migraciones al remoto; crear el administrador con `pnpm admin:create ... --remote`.
- [ ] **R2** habilitado (respaldos, Fase 5).
- [ ] Regla de límite de tasa adicional en la zona (WAF) como segunda capa — opcional.
