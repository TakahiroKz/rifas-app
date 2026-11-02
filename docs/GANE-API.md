# Fuente de resultados: Gane (hallazgos)

> Hallazgos del 2026-11-02 leyendo el **frontend público** de gane.com.co. Son endpoints **sin documentación oficial** que usa la propia web; pueden cambiar sin aviso.
> **Pendiente antes de producción**: confirmar por escrito con Gane que podemos consumirlos (frecuencia, atribución, límites). No usar tokens ni accesos internos.

## Endpoints públicos (sin autenticación)
Base: `https://8r0pwu3qoj.execute-api.us-east-1.amazonaws.com/api/resultados_chance/chance`

| Endpoint | Uso |
|---|---|
| `GET /loterias` | Catálogo de loterías/chances (`codigo`, `nombre`, `nombre_corto`). 44 al momento de la prueba |
| `GET /consultar?fecha_especifica=YYYY-MM-DD` | Resultados de **todos** los sorteos de esa fecha |

Respuesta de `/consultar` (resumida):
```json
{ "exito": true, "total_registros": 12, "fecha_inicio": "2026-11-01", "fecha_fin": "2026-11-01",
  "resultados": [ { "CODIGO": 65, "FECHA_SORTEO": "2026-11-01T00:00:00", "RESULTADO": "7215",
    "HORA": "18:50:00", "SERIE_RESULTADO": "--5", "NUMERO_SORTEO": 951,
    "NOMBRE": "DORADO FESTIVO", "NOMBRE_CORTO": "DONFE" } ] }
```
Notas: `RESULTADO` es el número de 4 cifras (string, conserva ceros a la izquierda); tardó ~3 s en responder → cachear.

Otros juegos (Baloto, Revancha, MiLoto) usan otro servicio (`…/api/utilidades/resultados_onj`), fuera del alcance inicial.

## Juegos soportados y su calendario (verificado con 5 semanas de histórico)
Un «juego» agrupa las variantes que Gane publica según el día. Los resultados son siempre de **4 cifras** (texto, con ceros a la izquierda) más una serie.

| Juego | Variantes (código · día · hora de Colombia) | Sortea |
|---|---|---|
| Chontico Noche | 62 (lun–vie, 18:50) · 89 (sábado, 21:50) · 63 (domingo y festivos, 19:50) | todos los días |
| Dorado Noche | 46 (lun–sáb, 21:50) · 65 (domingo y festivos, 18:50) | todos los días |
| Lotería del Valle | 17 (miércoles, 21:50) | solo miércoles |

Los demás códigos (Chontico Festivo Día 99, Millonario 1, Dorado Mañana/Tarde, etc.) se ignoran. El adaptador (`packages/lottery-sources`) los mapea así y descarta cualquier fila cuya fecha no coincida con la consultada.

## Comportamiento real del servicio (observado)
- **Aún no hay resultados** → responde `404` con `{"detail":"No se encontraron resultados…"}`. No es un error: se reintenta luego.
- **Fallos internos** → `500` con un mensaje que incluye detalles de su base de datos (visto en 2 fechas). Nunca se propaga ese texto; se reintenta luego.
- **Lentitud** → algunas consultas tardan más de 15 s. El adaptador corta a los 15 s y lo trata como transitorio.
- Por eso: el Cron consulta **una vez por fecha** (la respuesta trae todos los juegos), solo después de la hora de publicación del juego, y se detiene en cuanto hay resultado oficial.

## Activación
La consulta automática está **desactivada por defecto** (`LOTTERY_SYNC_ENABLED = "false"` en `wrangler.jsonc`) hasta tener la **autorización de Gane por escrito**. Mientras tanto el administrador ingresa el resultado a mano en el panel (queda marcado como manual y es solo de su organización). Para activarla: poner la variable en `"true"` y desplegar.

## Implicaciones de diseño
- **Calendario de sorteos**: el admin solo puede elegir fechas en las que la lotería realmente sortea. Se usa el patrón semanal de cada juego (tabla de arriba). Si un día excepcional no hay sorteo, el premio queda esperando y el admin puede ingresar el resultado a mano o editar la fecha.
- Cachear resultados ya publicados (son inmutables) y no consultar más de lo necesario.
- Guardar siempre el JSON crudo, la fecha de captura y el `NUMERO_SORTEO` como trazabilidad.
- Si el endpoint falla o cambia: alerta al admin y **entrada manual** de respaldo.
- Hay un token de un CMS expuesto en la configuración pública de la web de Gane. **No se usa ni se guarda** en este proyecto; avisar a Gane es lo correcto.
