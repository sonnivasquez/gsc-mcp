# Tools canónicos

## Política de catálogo (1.0.0)

- Un único catálogo público de 29 `gsc_*`: 24 canónicos + 5 puntuales
  (escritura y P2). Los 24 nombres legacy equivalentes están retirados;
  sus capacidades viven en los canónicos (ver `compatibility-manifest.json`).
- Una herramienta nueva solo entra si aporta una capacidad diferente:
  no otra versión del mismo análisis por tipo de búsqueda, país,
  dispositivo o filtro. Esas variantes son parámetros, no tools.
- Clases (`kind` en `gsc_capabilities`): `read` (23), `write`
  (`gsc_submit_*`, mutan Google), `fetch` (`gsc_image_page_audit`,
  descarga tus páginas/imágenes), `local` (`gsc_export_dataset`,
  `gsc_generate_report`, escriben en tu máquina con opt-in).
- Escritura: `GSC_ACCESS_MODE=full` habilita los tres envíos. Readonly los
  bloquea antes de llamar a Google; `doctor` informa `write_ops`. Sin la variable
  nueva se conserva el control legacy: `GSC_SCOPES=full` y `GSC_ENABLE_WRITE=1`.

`status`: `ok` | `partial` (lote con fallos) | `error` (fallo total).

## Fechas y rangos

- `preset`: `last_7_days`, `last_28_days`, `last_90_days`. Terminan en
  hoy-PT menos 3 días (`conservative_lag`: default de producto, no garantía).
- O rango explícito `startDate/endDate` (`YYYY-MM-DD`, inclusivas).
- `baseline`: `previous_period` (defecto en comparaciones), `previous_year`
  o rango explícito. Ventanas de distinta duración avisan (usa tasas diarias).

## Métricas y unidades

`clicks`, `impressions`: enteros. `ctr`: fracción 0..1 (solo agregados:
`sum(clicks)/sum(impressions)`). `position`: media ponderada por impresiones.
Deltas: `deltaX = actual − base`; `%` solo con base positiva
(`ZERO_BASELINE` si base = 0); `positionImprovement = base − actual`
(positivo = mejora).

## Catálogo

| Tool | Hace |
|---|---|
| `gsc_capabilities` | Tools, auth, límites, allowlist. Sin red ni credenciales. |
| `gsc_list_sites` | Propiedades visibles para esta instancia (filtra por allowlist). |
| `gsc_search_analytics` | Query flexible: dimensiones `date,page,query,country,device`; tipos `web,image,video,news,discover,googleNews`; `dataState` `final` (defecto) o `all`. Ordena el dataset recuperado (`sortAppliedTo`). Devuelve `datasetId`. |
| `gsc_performance_overview` | Totales de la fila agregada + serie `date` + comparación opcional. Nunca suma tops. |
| `gsc_compare_periods` | Join completo por clave: `compared`, `not_observed_in_current`, `not_observed_in_baseline`. Ausencia ≠ cero. |
| `gsc_page_queries` | Queries observadas para una URL exacta (filtro `page equals`). |
| `gsc_query_pages` | Páginas observadas para una query exacta. Dos URLs ≠ canibalización probada. |
| `gsc_inspect_urls` | 1–10 URLs, concurrencia 3, orden estable, parcial con éxitos. Inspección de índice, no live. |
| `gsc_list_sitemaps` | Sitemaps registrados. Lectura; jamás envía. |
| `gsc_get_dataset` | Pagina un resultado previo (cero llamadas Google). TTL 15 min, por perfil. |
| `gsc_check_update_impact` | Ventana de caída vs updates confirmados de ranking (core/spam/reviews) del Search Status Dashboard. Coincidencia temporal, nunca causalidad. Historial desde dic-2022. |

## Errores (códigos estables)

`AUTH_REQUIRED`, `AUTH_EXPIRED`/`REAUTH_REQUIRED` (→ `auth login`),
`MISSING_SCOPE`, `API_DISABLED`, `PROPERTY_NOT_ALLOWED` (allowlist local),
`PROPERTY_PERMISSION_DENIED`, `INVALID_ARGUMENT`, `RATE_LIMITED`,
`QUOTA_EXCEEDED`, `REQUEST_BUDGET_EXCEEDED`, `UPSTREAM_TIMEOUT`,
`UPSTREAM_SCHEMA_CHANGED`, `DATASET_EXPIRED`/`DATASET_NOT_FOUND`,
`INSUFFICIENT_DATA`, `CANCELLED`. Cada uno trae `retryable` y acción sugerida.
