# Tools canónicos

## Política de catálogo

- Un único catálogo actual de 34 `gsc_*`, incluidos los 29 anteriores y
  cinco auditorías nuevas. Los 24 nombres legacy equivalentes están retirados;
  sus capacidades viven en los canónicos (ver `compatibility-manifest.json`).
- Una herramienta nueva solo entra si aporta una capacidad diferente:
  no otra versión del mismo análisis por tipo de búsqueda, país,
  dispositivo o filtro. Esas variantes son parámetros, no tools.
- Clases (`kind` en `gsc_capabilities`): `read` (23), `write`
  (`gsc_submit_*`, mutan Google), `fetch` (auditorías web, incluidas `gsc_image_page_audit`,
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
| `gsc_search_analytics` | Query flexible: dimensiones `date,page,query,country,device,hour,searchAppearance`; `hour` requiere `hourly_all`, appearance agrupa solo. `searchType` (`web,image,video,news,discover,googleNews`) se envía como `type`. Admite `aggregationType`. Ordena el dataset recuperado (`sortAppliedTo`); devuelve `datasetId`. |
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

## Auditorías bajo demanda (ampliación local, pendiente de release)

El catálogo actual del código contiene **34 herramientas**: 23 `read`, tres
`write`, cinco `fetch` y tres `local`. Se conservan los 29 nombres anteriores.
Las cinco herramientas siguientes no modifican Google ni el sitio.

| Tool | Entrada principal | Resultado |
|---|---|---|
| `gsc_page_audit` | `siteUrl`, `urls` (1–5), periodo | HTML HTTP actual, title/description/H1/canonical/robots, agregados y consultas exactas, coincidencias textuales y candidatos de CTR. |
| `gsc_indexing_audit` | `siteUrl`, `urls` o `sitemapUrls`; sin ambos usa sitemaps registrados | Descubrimiento XML/gzip e inspección de hasta diez URLs por llamada. `selection=sitemap_order` o `recent_lastmod`. |
| `gsc_internal_link_audit` | `siteUrl`, `startUrls`, `sitemapUrls` opcionales | Grafo HTML acotado, enlaces entrantes observados, profundidad desde semillas, problemas comprobados y sugerencias con fragmentos. |
| `gsc_change_impact` | `siteUrl`, `action=record\|list\|analyze\|delete` | Registro explícito y comparación antes/después; historial local opcional. |
| `gsc_migration_audit` | `sourceSiteUrl`, `targetSiteUrl`, `migrationDate`, `mappings` | HTTP/redirecciones actuales, canonical/robots e información del índice y rendimiento por URL. |

### Periodos y ejecución

Página y enlaces usan `last_28_days` por defecto. Admiten los presets existentes
o `startDate/endDate`; las fechas son días de Search Console en PT.
Solo se analiza HTML recibido: JavaScript, enlaces generados en cliente y
contenido renderizado quedan desconocidos. Las coincidencias son literales,
normalizadas, no equivalencia semántica ni prueba de intención.

Ninguna auditoría se ejecuta al iniciar el servidor ni después de devolver una
respuesta. No hay programador, notificaciones ni servicio permanente.
`gsc_check_alerts` conserva su evaluación bajo demanda, sin historial.

Cada llamada tiene 60 segundos, hasta doce intentos Google compartidos,
15 segundos por recurso, 2 MiB por HTML y cinco redirecciones por recurso.
Los recorridos automáticos respetan robots.txt, también en redirecciones.
La lectura de robots se limita al origen de la URL autorizada.

Sitemaps: hasta diez archivos por llamada, 50 MiB descomprimidos acumulados y
10.000 URLs descubiertas. XML con DTD/entidades externas se rechaza.
Un sitemap individual con más de 10.000 entradas requiere proporcionar
sitemaps hijos más pequeños o URLs explícitas; el fallo queda registrado.

Enlaces: `maxPages=100` (máximo 500), `batchSize=20` (máximo 50).
Migraciones: hasta 500 pares por sesión, `batchSize=2` (máximo cinco).
Los límites de tiempo e intentos pueden reducir el lote efectivamente completado.
Los resultados parciales conservan los pasos ya terminados y sus errores:
un fallo de un lote anterior mantiene `status=partial` al finalizar. Al terminar el
rastreo, enlaces consulta hasta cinco páginas prioritarias para sugerencias
basadas también en sus consultas observadas (hasta cinco consultas por página,
con diez impresiones mínimas). La cobertura figura en contextQueryPages.

### Continuación y evidencia completa

`data.complete` indica que terminó el trabajo programado dentro de sus límites;
la cobertura de descubrimiento/grafo puede seguir siendo incompleta.
Los resultados individuales pueden fallar aunque el lote haya terminado.
`status=partial` declara fallos o trabajo pendiente; consulta las advertencias.

Si `data.nextCursor` no es null, llama otra vez a **la misma herramienta** con
el cursor y los parámetros originales sin cambios. También se puede enviar
solo los identificadores de propiedad y el cursor; se recuperan los parámetros
originales. No continuarán solicitudes después de devolver la respuesta.

Al llegar al límite de descubrimiento, la auditoría termina con cobertura
limitada; un sitemap que solo exceda los bytes restantes de la llamada queda
pendiente para otra llamada. Los hijos fuera de alcance se aíslan sin descartar
sus hermanos válidos. El grafo atribuye enlaces a la URL HTTP efectiva y
deduplica alias de redirección; conserva la URL solicitada como evidencia.

Las sesiones están en memoria, aisladas por perfil, propiedades y allowlist.
Caducan tras quince minutos sin uso o al reiniciar el proceso. El almacén admite
hasta cien sesiones y 64 MiB; puede expulsar sesiones inactivas por capacidad.
Un cursor caducado devuelve `DATASET_EXPIRED`; se debe iniciar otra auditoría.
No se persisten sesiones de rastreo en el historial.

La respuesta muestra una vista previa: hasta veinte elementos por array y
2.000 caracteres por texto; `evidencePreview` describe este recorte.
La evidencia completa se recupera usando `meta.datasetId` con
`gsc_get_dataset`, sin nuevas solicitudes a Google. Cada fila incluye
`index`, `part`, `parts`, `evidence`: agrupa por `index`, ordena por `part`,
concatena `evidence` y aplica JSON.parse. No interpretes cada fragmento como
un JSON independiente. El índice indicado por `summaryEvidenceIndex` contiene
el resumen completo (`kind=audit_summary`), incluida su cobertura y fallos.
La paginación puede devolver menos filas que `limit`
para respetar el presupuesto de bytes; sigue `nextCursor`.

### Historial y evaluación de cambios

Activa `GSC_HISTORY=1` en el entorno del servidor y reinicia el cliente MCP.
Es independiente de `GSC_EXPORTS` y no amplía los scopes de Google.

- `record`: `change={date,label?,description?,urls}`, hasta cien URLs;
  `idempotencyKey` opcional evita duplicar un registro idéntico.
- `list`: registros del perfil/propiedad actuales. Con `changeId`, devuelve
  el registro y sus mediciones guardadas cuando suman hasta 1 MiB. Historiales
  mayores se leen con `snapshotChunk` y `nextCursor`, sin cargarlos en el dataset.
- `analyze`: `changeId` guardado o `change` transitorio, mutuamente exclusivos.
  `saveSnapshot=false` por defecto; guardarlo requiere `changeId` e historial.
  `batchSize=1`, máximo tres URLs por lote, y hasta tres `controlUrls` explícitas.
- `delete`: elimina el registro indicado y sus mediciones. Requiere `changeId`.

El análisis transitorio no necesita historial ni escribe archivos.
Las ventanas por defecto son 28 días anteriores, siete días de transición
(incluido el día del cambio) y los siguientes 28 días. `before` y `after`
permiten rangos explícitos. Una ventana posterior todavía incompleta es
preliminar; no se extrapola ni se inventan filas. Se comparan tasas diarias
cuando las duraciones difieren. Base cero produce porcentaje null.
Los controles muestran la media simple de variaciones porcentuales válidas y
su diferencia descriptiva con la URL evaluada; no es atribución causal.

Las páginas de historial grande contienen `change={id}`, `changeDetails`,
`snapshotsTotal`, `snapshotChunk={snapshotId,offset,totalBytes,encoding,data,validation}`
y `nextCursor`. Cada bloque contiene hasta 24 KiB de bytes JSON codificados
como base64. Agrupa por snapshotId, decodifica cada bloque, concatena los bytes
en orden de offset y luego decodifica UTF-8 y aplica JSON.parse. No interpretes
cada bloque como JSON ni decodifiques UTF-8 antes de reunir sus bytes.
`validation=raw_json_bytes_not_validated` indica que el servidor transmite los
bytes locales sin validar el JSON de esa instantánea grande. Para recuperar
el registro completo del cambio, usa `list` sin changeId y su dataset.

Continúa con `action=list`, el mismo `siteUrl/changeId` y el cursor devuelto.
Estos cursores pertenecen al historial persistente, no a las sesiones de
quince minutos. Se rechazan si cambia el perfil/propiedad/cambio o si el archivo
referenciado cambia o desaparece. `snapshotsTotal` refleja los archivos presentes
en cada llamada. La creación de nuevas instantáneas requiere una llamada explícita.

Las operaciones de historial comprueban cancelación y plazo antes de efectos
persistentes y después de esperas de E/S. Una cancelación previa no guarda ni
borra registros. Si se cancela una eliminación después de borrar algún archivo,
puede quedar parcialmente aplicada: no se promete rollback de efectos terminados.

Los archivos viven en `<GSC_DATA_DIR>/history` (o `~/.gsc-mcp/history`), con
subdirectorios derivados del perfil y propiedad, esquemas versionados,
permisos 0700/0600 y escrituras atómicas. Límite acumulado: 100 MiB.
No hay purga automática. Se rechazan enlaces simbólicos en el historial.
Las escrituras simultáneas se bloquean de forma explícita: reintenta después.
Si un proceso se interrumpe durante la escritura puede quedar
`history/.write-lock`; verifica que no haya otro escritor antes de quitarlo
manualmente. No se elimina por temporizador.

Las mediciones guardan métricas, consultas observadas, parámetros y cobertura;
no tokens, credenciales ni HTML completo. Registrar hoy un cambio pasado no
crea una captura anterior al cambio. Los datos están sujetos a la retención
que Search Console tenga disponible al solicitarlos.

### Migraciones

Cada par es `{oldUrl,newUrl}` y debe pertenecer a su propiedad declarada.
Se permiten muchas URLs antiguas hacia un destino, pero no una URL antigua
con destinos contradictorios. El mapa se envía como datos MCP; no se importan
archivos CSV. Las métricas del destino se reutilizan y no se suman por par.
Se distinguen redirecciones permanentes/temporales, cadenas, bucles,
destinos inesperados, antigua con 200, noindex y canonicals discrepantes.
El estado HTTP es actual; Google puede conservar un estado de índice anterior.
No se certifica recuperación de tráfico ni éxito global por una redirección.

### Nuevos parámetros de consultas y canibalización

`gsc_search_analytics` añade `hour`, `searchAppearance` y `hourly_all`.
`hour` requiere `hourly_all` y viceversa. Las horas mantienen sus offsets.
Los campos `metadata.first_incomplete_date/first_incomplete_hour` señalan datos
provisionales. `upstreamAggregationType` conserva la agregación comunicada
por Google; `responseAggregationType=by_row` se mantiene por compatibilidad.
El parámetro público `searchType` sigue existiendo; al proveedor se envía `type`.

`searchAppearance` se consulta como única dimensión. Para desglosar un tipo,
haz una segunda llamada filtrando ese valor y agrupando por page/query/etc.
El filtro `searchAppearance` requiere `equals`. Discover no admite query ni
device; Google News no admite query. La pestaña News (`news`) sí admite query.
`aggregationType` acepta `auto`, `byPage`, `byProperty` y
`byNewsShowcasePanel`: `byProperty` excluye agrupación/filtro por page y los
tipos Discover/Google News; Showcase requiere esos tipos, filtro `equals`
`NEWS_SHOWCASE` y ninguna agrupación/filtro por page.
Las herramientas con ventanas diarias conservan sus contratos anteriores.

`gsc_detect_cannibalization` admite `includeTimeline=false`,
`timelineQueryLimit=5` (1–10) y `minDailyImpressions=10`.
El análisis opt-in consulta date/page por consulta exacta. La dominancia se
ordena por clics, después impresiones; un empate total es indeterminado.
Se necesitan siete días observados para el resumen y tres días naturales
consecutivos para un cambio sostenido. Ausencias no completan secuencias.
La coexistencia diaria no demuestra simultaneidad en una SERP ni perjuicio.
Los candidatos sin analizar conservan estado `pending`; el presupuesto se
comparte con la consulta agregada. `verdict` sigue siendo `candidate`.

La vista previa de canibalización temporal se limita por el tamaño del mensaje
MCP completo, conserva `meta.coverage` y expone `meta.datasetId` con todos los
candidatos recuperados. Sus filas usan `index,part,parts,evidenceBase64`: agrupa
por index, concatena evidenceBase64 por part, decodifica base64 a UTF-8 y aplica
JSON.parse. Este formato es distinto de los fragmentos `evidence` de auditorías.
Los filtros, la superficie de búsqueda y el estado de datos se conservan al
consultar cada línea temporal. `PREVIEW_TRIMMED` señala un recorte recuperable.
