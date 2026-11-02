# Despliegue a producción

Guía para publicar la app en `https://turifa.capitalfinaura.com`. Lo que ya está hecho y lo que falta, en orden.

## Ya está hecho
- Base de datos D1 `rifas-db` creada en tu cuenta de Cloudflare, con las 4 migraciones aplicadas.
- La zona `capitalfinaura.com` está activa en Cloudflare, y `turifa` está libre (no choca con `app.capitalfinaura.com`, que es de otro Worker).
- El Worker está configurado para salir **solo** por `turifa.capitalfinaura.com` (sin URL `*.workers.dev`).
- Flujo de GitHub «Deploy» listo (manual, con confirmación).

## 0. Plan de Workers: **Workers Paid (5 USD/mes)** — requisito
El plan gratis limita el CPU a **10 ms por petición y por tarea programada**. Medido en este proyecto:

| Operación | CPU aproximada | ¿Cabe en 10 ms? |
|---|---|---|
| Hash de contraseña (PBKDF2, 100 000 iteraciones) en cada **inicio de sesión** | ~54 ms | **No** |
| Respaldo diario (miles de filas, JSON y hash) | decenas de ms | Probablemente no |
| Apartar, listar, vender | pocos ms | Sí |

Bajar las iteraciones para que quepa (≈15 000) debilitaría las contraseñas, así que **no se recomienda**. Con Workers Paid (5 USD/mes) el límite es de 30 s por petición, los 10 millones de peticiones mensuales incluidos alcanzan de sobra y D1 sube sus topes. Actívalo en *Workers & Pages → Plans*.
Además, en el plan gratis: 100 000 peticiones al día al API (una rifa muy comentada las gastaría) y D1 limita a 100 000 filas escritas/día desde el 1 de septiembre de 2026.

## 1. R2 para los respaldos (opcional pero recomendado)
1. Activa R2 en el panel de Cloudflare (*R2 Object Storage*; puede pedir un método de pago, el uso pequeño es gratis).
2. Crea el bucket: `cd apps/api && pnpm exec wrangler r2 bucket create rifas-backups`.
3. En `apps/api/wrangler.jsonc` descomenta el bloque `r2_buckets` (binding `BACKUPS`).
Sin esto la app funciona igual, pero **no hay respaldos**.

## 2. Turnstile (anti-robots al apartar)
1. Cloudflare → *Turnstile* → **Add widget**. Nombre `Tu Rifa`, hostname `turifa.capitalfinaura.com`, modo *Managed*.
2. Copia la **Site Key** (pública) y la **Secret Key**.
3. Pon la Site Key en `apps/api/wrangler.jsonc`, en `vars.TURNSTILE_SITE_KEY`.
4. La Secret Key se guarda como secreto del Worker (después del primer despliegue): `cd apps/api && pnpm exec wrangler secret put TURNSTILE_SECRET`.
Mientras falte alguna, apartar responde **503** a propósito (falla cerrado: nunca se aparta sin verificar).

## 3. Token de API y secretos de GitHub
1. Cloudflare → *My Profile → API Tokens → Create Token* (de cuenta). Permisos:
   - **Workers** a nivel *Admin* (el primer despliegue crea el Worker; luego basta *Editor*).
   - **D1** → *Edit*.
   - **Zone → Workers Routes → Write**, limitado a la zona `capitalfinaura.com` (para crear el dominio personalizado).
   - *(Solo si vas a crear el bucket con este token)* **R2** → *Edit*.
2. En GitHub: *Settings → Environments → New environment* `production` (puedes exigir aprobación de revisores). Dentro, *Secrets*:
   - `CLOUDFLARE_API_TOKEN` = el token.
   - `CLOUDFLARE_ACCOUNT_ID` = el ID de tu cuenta (está en la URL del panel de Cloudflare).
No pegues el token en el chat ni lo guardes en el repositorio.

## 4. Desplegar
GitHub → *Actions → Deploy → Run workflow*, escribe `DESPLEGAR`. El flujo: revisa secretos → lint, tipos y pruebas → compila la web → **aplica migraciones pendientes** → despliega → comprueba `/api/v1/health` (hasta 10 min la primera vez, por el certificado del dominio).

## 5. Después del primer despliegue
1. `wrangler secret put TURNSTILE_SECRET` (paso 2.4).
2. Crea tu usuario administrador **en producción** (la contraseña se pide oculta):
   `pnpm admin:create --email tu@correo.com --name "Tu Nombre" --org-slug finaura --org-name "Capital Finaura" --whatsapp 573045235606 --remote`
3. Entra a `https://turifa.capitalfinaura.com/admin`, crea la rifa y márcala **activa**. Copia su enlace público.

## 6. Verificación (haz esto antes de compartir el enlace)
- [ ] `https://turifa.capitalfinaura.com/api/v1/health` responde `{"status":"ok"…}`.
- [ ] El enlace de la rifa carga, muestra los números y, al pegarlo en WhatsApp, la vista previa trae el nombre de la rifa.
- [ ] Apartas un número desde tu celular: se abre WhatsApp con el mensaje y el código; en el panel aparece apartado.
- [ ] Sin conexión a Turnstile bloqueada (prueba en ventana privada) no deja apartar sin verificar.
- [ ] Inicias sesión en `/admin` (si falla con «Exceeded CPU», revisa el paso 0).
- [ ] Libera ese número de prueba.
- [ ] Al día siguiente existe `backups/AAAA-MM-DD/manifest.json` en el bucket (si activaste R2).

## 7. Antes de abrir al público (no técnico)
- Revisión legal de la política de privacidad y cambiar `PRIVACY_POLICY_REVIEWED` a `true` (`apps/web/src/pages/Privacy.tsx`).
- Permiso de la rifa ante la autoridad competente (Ley 643 de 2001) — a cargo del organizador.
- Autorización de Gane por escrito antes de poner `LOTTERY_SYNC_ENABLED` en `"true"`.

## Volver atrás
- **Código**: `cd apps/api && pnpm exec wrangler rollback` deja la versión anterior del Worker. O vuelve a ejecutar *Deploy* sobre un commit anterior.
- **Base de datos**: las migraciones son solo hacia adelante. Si algo salió mal con los datos, restaura un respaldo en una base nueva (ver [`OPERACION.md`](OPERACION.md)).
