# Plan: Plataforma de rifas (microSaaS)

> Estado: planificación. Última actualización: 2026-11-02. Repo: `TakahiroKz/rifas-app`.

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
- **Prioridad**: Gane (gane.com.co) y sus APIs. Leo trabajó en Gane y conoce los datos; antes de integrar, **confirmar por escrito que el uso de esas APIs es permitido** y usar solo endpoints públicos/autorizados (nunca credenciales ni accesos internos).
- Si no hay API: scraping de la página oficial, citando siempre la fuente.
- Entrada manual de respaldo (marcada como manual).

### Loterías/sorteos iniciales (Fase 4)
1. **Chontico**
2. **Dorado Noche**
3. **Lotería del Valle**

(Confirmar para cada uno la fuente y el formato de resultado: número principal, serie, hora.)

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
Los números de la rifa **empiezan en 00** y se muestran con ceros a la izquierda (ancho = cifras de `total_numbers - 1`; 100 números → `00–99`).
Al publicarse el resultado, el sistema calcula los números ganadores por premio, y el admin los **confirma y anuncia**.

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
- **raffles**: id, org_id, slug, title, description, total_numbers (10–100000), number_start (siempre 0), number_width, ticket_price, status (`borrador`/`activa`/`cerrada`), draw_date, created_at
- **raffle_prizes**: id, raffle_id, place, description, lottery_id, match_type (`last`/`first`), digits (1–4)
- **raffle_winners**: raffle_prize_id, number, draw_result_id, confirmed_at
- **tickets**: raffle_id, number, status (`activo`/`apartado`/`vendido`), payment_status (`pagado`/`debe`/null), due_date, buyer_name, buyer_phone, note, reserved_at, reserved_until, sold_at, updated_at — PK (raffle_id, number)
- **ticket_events**: id, raffle_id, number, from_status, to_status, actor (`public`/`admin`/`system`), at, meta — historial
- **lotteries**: id, country, name, schedule, source_adapter (Gane u otra)
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
| Deuda | `vendido` con `debe` + fecha de pago; basta con un **listado** (sin recordatorios) |
| Rifas | Una activa hoy; arquitectura multi-tenant |
| Números | 10 a 100 000, **empiezan en 00** (con ceros a la izquierda) |
| Sorteos | No los hacemos ni captamos dinero; anunciamos ganadores con resultados de terceros |
| Ganadores | N premios; regla por premio: primeras/últimas 1–4 cifras de una lotería |
| Fuente de resultados | Gane (API/sitio), con respaldo manual |
| Loterías iniciales | Chontico, Dorado Noche, Lotería del Valle |
| WhatsApp | `wa.me/<tel>?text=…` (único parámetro: `text`); teléfono en config |
| Dominio | `capitalfinaura.com`, público en `turifa.capitalfinaura.com` |
| Datos del comprador | Se piden por WhatsApp; política de privacidad requerida |
| Infra | Cloudflare |

## 13. Preguntas abiertas
1. **Cifras vs. ancho del número**: con regla de 1–4 cifras, ¿qué pasa si hay menos cifras que el ancho (p. ej. 1 cifra en una rifa 00–99 coincidirían ~10 números)? ¿Se permite varios ganadores por premio o la regla debe igualar el ancho?
2. **Rifas de 100 000 números** (ancho 5): ¿se permiten reglas de 5 cifras o el máximo sigue en 4?
3. **Resultado fuera de rango** (p. ej. rifa 00–49 y resultado termina en 73): ¿el premio queda desierto, se espera al siguiente sorteo o se usa otro resultado?
4. ¿El admin va en `turifa.capitalfinaura.com/admin` o en un subdominio aparte?
5. **Gane**: ¿qué API/endpoints concretos usaremos y tienes autorización por escrito para su uso en este proyecto?
6. ¿Un premio puede usar una lotería distinta a la de otro premio de la misma rifa? (el modelo lo permite)
7. ¿Ya cuentas con el permiso/autorización para tus rifas? (aunque no hagamos el sorteo, quien organiza la rifa sí lo necesita)
