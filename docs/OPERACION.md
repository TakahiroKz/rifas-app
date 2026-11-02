# Operación

Tareas del día a día y qué hacer cuando algo falla.

## Respaldos
- **Qué**: cada día a las 03:00 (hora de Colombia) se exportan a R2, en `backups/AAAA-MM-DD/`, todas las tablas (menos sesiones e intentos de ingreso, que son temporales) como archivos `.ndjson` (una fila JSON por línea) y un `manifest.json` con filas, tamaño y huella SHA-256 de cada archivo.
- **Cuánto**: se conservan 30 días; las copias más viejas se borran solas.
- **Seguridad**: el bucket es privado. Las copias incluyen los hashes de contraseñas y los datos de compradores: trátalas como información sensible.
- **Una copia sin `manifest.json` está incompleta** (el manifiesto se escribe al final).
- Si R2 no está habilitado, el respaldo se omite sin error y **no hay respaldos** (ver `DESPLIEGUE.md`).

### Restaurar (siempre en una base NUEVA, nunca encima de la de producción)
1. Crea una base vacía y aplícale las migraciones:
   ```bash
   cd apps/api
   pnpm exec wrangler d1 create rifas-db-restaurada
   # pon su id en wrangler.jsonc temporalmente o usa --database-id; luego:
   pnpm exec wrangler d1 migrations apply rifas-db-restaurada --remote
   ```
2. Descarga la copia (cambia la fecha):
   ```bash
   D=2026-11-03; mkdir -p respaldo/$D
   for t in manifest.json users organizations memberships raffles tickets ticket_events draw_results raffle_prizes prize_draw_attempts prize_winners; do
     f=$t; [ "$t" != manifest.json ] && f=$t.ndjson
     pnpm exec wrangler r2 object get rifas-backups/backups/$D/$f --file respaldo/$D/$f --remote
   done
   ```
3. Verifica y carga (el script **rechaza copias dañadas o incompletas** comparando con el manifiesto):
   ```bash
   pnpm --filter @rifas/api exec tsx scripts/restore-backup.ts --dir ../../respaldo/$D --remote --yes
   ```
4. Cuando compruebes que los datos están completos, apunta `database_id` en `wrangler.jsonc` a la base restaurada y despliega.
- **Prueba la restauración al menos una vez** (con la base local sin `--remote`) antes de necesitarla.

## Cuentas
- **Contraseña olvidada**: `pnpm admin:reset-password --email tu@correo.com --remote` (la pide oculta; cierra las sesiones abiertas).
- **Otro administrador**: `pnpm admin:create … --remote` (usa el mismo `--org-slug` para unirlo a la misma organización).
- **Bloqueo por intentos**: 5 contraseñas malas por correo, o 20 por IP, en 15 minutos → espera 15 minutos o restablece la contraseña.

## Secretos y variables
| Qué | Dónde | Cómo cambiarlo |
|---|---|---|
| `TURNSTILE_SECRET` | secreto del Worker | `cd apps/api && pnpm exec wrangler secret put TURNSTILE_SECRET` |
| `TURNSTILE_SITE_KEY` | `vars` en `wrangler.jsonc` (pública) | editar y desplegar |
| `LOTTERY_SYNC_ENABLED` | `vars` en `wrangler.jsonc` | `"true"` solo con autorización de Gane; desplegar |
| `CLOUDFLARE_API_TOKEN` / `_ACCOUNT_ID` | secretos del entorno `production` en GitHub | regenerar el token en Cloudflare y actualizar |
Si sospechas que un secreto se filtró: genera uno nuevo en Cloudflare, cámbialo y revoca el anterior.

## Monitoreo
- *Cloudflare → Workers & Pages → rifas-app → Logs* (observabilidad activada). Los errores salen como JSON (`"level":"error"`).
- *Workers & Pages → rifas-app → Metrics*: peticiones y errores. *D1 → rifas-db → Metrics*: filas leídas/escritas.
- Tareas programadas: cada 10 minutos (apartados vencidos, resultados, limpieza) y el respaldo diario. Si falla una, aparece en los logs y se reintenta en la siguiente.

## Cuando algo falla
| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Apartar da «Verificación no disponible» (503) | Falta `TURNSTILE_SECRET` o `TURNSTILE_SITE_KEY`, o Cloudflare no respondió | Revisar el paso 2 de `DESPLIEGUE.md`; mirar los logs |
| «Confirma que no eres un robot» (400/403) | El widget no cargó (bloqueador de anuncios) o el token venció | Reintentar; probar sin bloqueadores |
| Muchos 429 | Límite por IP (20/min) o por cliente (30 números apartados) | Esperar; si es una red compartida, es normal que se alcance antes |
| Iniciar sesión falla con error 1102 / «Exceeded CPU» | Plan gratis de Workers (10 ms) | Pasar a Workers Paid (`DESPLIEGUE.md`, paso 0) |
| Todo falla con «exceeded D1's free tier daily row…» | Se agotó la cuota diaria de D1 del plan gratis (se renueva a las 00:00 UTC) | Workers Paid, o esperar |
| «Consultar resultado ahora» responde 502 | Gane no respondió (tiene fallos propios) | Reintentar luego o ingresar el resultado a mano |
| No hay respaldos en R2 | R2 sin habilitar, bucket sin crear o binding comentado | `DESPLIEGUE.md`, paso 1 |
| El enlace en WhatsApp no muestra vista previa | WhatsApp guarda la previa en caché | Pega el enlace con `?v=2` al final para forzarla |

## Límites a vigilar (plan gratis → pago)
- Peticiones al API: 100 000/día en gratis. Con la pestaña visible, cada visitante consulta cada 45 s; las pestañas ocultas no consultan.
- D1: 5 M filas leídas/día y 100 000 escritas/día en gratis; 5 GB en total.
- 5 tareas programadas por cuenta en gratis (aquí se usan 2).
