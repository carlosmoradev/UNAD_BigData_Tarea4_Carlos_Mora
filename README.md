# Tarea 4 – MongoDB: logs e incidentes de una plataforma cloud

Caso de uso: registro de logs de servicios (APIs, workers e infraestructura) e incidentes
asociados. Base de datos `platform_observability` en MongoDB 7.0 ejecutado con Docker.

## Estructura del repositorio

| Ruta | Descripción |
|---|---|
| `generate_data.py` | Genera los datos de prueba (semilla fija, el resultado es siempre el mismo). |
| `data/*.jsonl` | Datos generados: 12 servicios, 170 eventos y 25 incidentes (207 documentos). |
| `queries/00_load.sh` | Carga los datos en el contenedor (borra las colecciones existentes). |
| `queries/01_indexes.js` | Creación de índices. |
| `queries/02_crud.js` | Inserción, selección, actualización y eliminación. |
| `queries/03_filters_joins.js` | Filtros con operadores y joins con `$lookup`. |
| `queries/04_aggregations.js` | Agregaciones: conteo, suma, promedio, mínimo, máximo, `$bucket`, percentil 95, `$facet`. |
| `queries/05_explain_and_validation.js` | Evidencia de optimización (`explain`) y validación de esquema (`$jsonSchema`). |
| `queries/run.sh` | Ejecuta un script, o todos en orden. |

## Modelo de datos

- `services` (12): `_id`, `team`, `tier`, `env`, `region`, `owner{name, oncall}`, `dependencies[]`.
- `log_events` (170): `service_id`, `ts`, `level`, `message`, `latency_ms`, `tags[]`, `http{method, path, status}`
  y `meta{...}`. Los campos `http`, `meta`, `latency_ms` y `query_ms` varían según el tipo de servicio.
- `incidents` (25): `_id`, `service_id`, `severity`, `status`, `opened_at`, `resolved_at`, `root_cause`,
  `timeline[]` (embebido) y `affected_events[]` (referencias a `log_events`).

Decisiones de diseño: la línea de tiempo se **embebe** porque siempre se consulta junto con el incidente;
los servicios se **referencian** con `service_id` para no duplicarlos y se unen con `$lookup`.

## Requisitos

- Docker.
- Python 3 (solo si se quiere regenerar los datos; los archivos de `data/` ya están incluidos).

## Ejecución

Desde esta carpeta:

```bash
# 1. Levantar MongoDB (solo accesible desde localhost) con los datos montados en /seed
docker run -d --name tarea4-mongo -p 127.0.0.1:27017:27017 -v "$PWD/data:/seed:ro" mongo:7.0

# 2. Cargar los datos
./queries/00_load.sh

# 3. Ejecutar todos los scripts, o uno en particular
./queries/run.sh
./queries/run.sh 03_filters_joins.js

# Salida compacta: un documento por línea (mismas consultas, solo cambia el formato)
COMPACT=1 ./queries/run.sh 04_aggregations.js
```

Para regenerar los datos: `python3 generate_data.py` (escribe en `data/`).

## Notas

- `02_crud.js` solo modifica documentos que crea él mismo, así que se puede repetir sin recargar los datos.
- `05_explain_and_validation.js` instala los validadores. Si se ejecuta `00_load.sh` de nuevo, las colecciones
  se recrean sin validador hasta volver a correr el script `05`.
- El conjunto de datos es pequeño: la diferencia entre `IXSCAN` y `COLLSCAN` se observa en los documentos
  examinados (por ejemplo 8 frente a 170), no en el tiempo de ejecución.
- Los scripts se probaron en MongoDB 7.0. Las agregaciones usan `$dateDiff` y `$sortArray`, que requieren MongoDB 5.2 o superior; no funcionan en la imagen `mongo:4.4`.
