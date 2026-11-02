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

## Códigos de las loterías iniciales
| Juego | Variantes (código) |
|---|---|
| Chontico | Noche (62), Noche Sábado (89), Festivo Noche (63), Festivo Día (99), Millonario (1), Superchontico Millonario Noche (95) |
| Dorado | Noche (46), Mañana (3), Tarde (51), Festivo (65) |
| Lotería del Valle | Valle (17) |

**Importante**: el mismo "juego" cambia de código según el día (p. ej. domingos/festivos aparece *Chontico Festivo Noche* o *Dorado Festivo* en vez de *Noche*). El adaptador debe resolver, para una fecha dada, **qué código corresponde** a la lotería elegida por el admin.

## Implicaciones de diseño
- **Calendario de sorteos**: el admin solo puede elegir fechas en las que la lotería realmente sortea. Se deriva del histórico (`/consultar` por fecha) y se cachea; para los días futuros se usa el patrón semanal + festivos.
- Cachear resultados ya publicados (son inmutables) y no consultar más de lo necesario.
- Guardar siempre el JSON crudo, la fecha de captura y el `NUMERO_SORTEO` como trazabilidad.
- Si el endpoint falla o cambia: alerta al admin y **entrada manual** de respaldo.
- Hay un token de un CMS expuesto en la configuración pública de la web de Gane. **No se usa ni se guarda** en este proyecto; avisar a Gane es lo correcto.
