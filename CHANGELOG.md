# Changelog

## 1.1.0

Fecha: 2026-10-28.

Esta versión amplía el catálogo de **29 a 34 herramientas MCP**. Incorpora
cinco auditorías bajo demanda, historial local opcional y nuevas consultas
de Search Analytics. Conserva los nombres anteriores y el acceso a Google
de solo lectura por defecto.

### Nuevas herramientas

#### `gsc_page_audit`: evidencia de una página

- Analiza entre una y cinco URLs de una propiedad autorizada.
- Combina el HTML recibido por HTTP con métricas y consultas de Search
  Console filtradas por la URL exacta.
- Examina títulos, descripciones, H1, canonical, directivas de robots y
  coincidencias literales entre consultas y texto observado.
- Mantiene separadas las observaciones, los errores y los candidatos de
  mejora. No interpreta coincidencias como equivalencia semántica ni
  modifica el contenido del sitio.

#### `gsc_indexing_audit`: descubrimiento e inspección de una muestra

- Acepta URLs explícitas o sitemaps de la propiedad; si no se especifican,
  consulta los sitemaps registrados en Search Console.
- Lee sitemaps XML y comprimidos, incluidos sus hijos, y permite seleccionar
  por orden del sitemap o por `lastmod` reciente.
- Inspecciona hasta diez URLs por llamada y conserva resultados individuales
  cuando parte de la muestra falla.
- Informa del estado conocido por el índice de Google. No equivale a una
  prueba en vivo, no representa la indexación completa del sitio y no envía
  solicitudes de indexación.

#### `gsc_internal_link_audit`: grafo de enlaces internos

- Construye un grafo HTML desde las URLs iniciales y el inventario permitido.
  El límite predeterminado es de 100 páginas, ampliable hasta 500.
- Devuelve enlaces entrantes observados, profundidad desde las semillas,
  problemas de enlaces comprobados y métricas disponibles de Search Console.
- Genera sugerencias a partir de texto literal, encabezados y consultas
  observadas, con fragmentos que permiten revisar la evidencia.
- Respeta robots.txt durante el recorrido automático. Un grafo parcial o la
  ausencia de enlaces observados no demuestran que una página sea huérfana.

#### `gsc_change_impact`: comparación de cambios e historial

- Añade acciones explícitas `record`, `list`, `analyze` y `delete`.
- Permite analizar un cambio transitorio sin escribir archivos, o trabajar
  con un registro guardado y solicitar una instantánea con `saveSnapshot`.
- Compara métricas y consultas antes y después del cambio. Por defecto usa
  28 días anteriores, siete días de transición que incluyen el día del
  cambio y 28 días posteriores.
- Admite hasta tres URLs de control distintas de las modificadas. Las
  diferencias relativas son descriptivas y no prueban causalidad.
- Identifica las ventanas todavía preliminares y no extrapola tráfico ni
  inventa filas posteriores que aún no están disponibles.

#### `gsc_migration_audit`: revisión de una migración declarada

- Acepta hasta 500 pares explícitos `oldUrl`/`newUrl`, con fecha de
  migración y propiedades de origen y destino autorizadas.
- Revisa respuestas HTTP, cadenas de redirección, destino efectivo,
  canonical, robots, estado del índice y rendimiento por URL.
- Admite cambios de rutas y de dominio. Cuando varias URLs antiguas apuntan
  al mismo destino, evita sumar repetidamente las métricas de ese destino.
- Conserva la distinción entre HTTP actual y evidencia del índice de Google,
  que puede corresponder a un rastreo anterior.
- No cambia redirecciones, no envía URLs a Google y no certifica recuperación
  de tráfico ni éxito global de la migración.

### Search Analytics y canibalización

- `gsc_search_analytics` admite la dimensión `hour` junto con
  `dataState=hourly_all`; ambas opciones deben utilizarse conjuntamente.
  Google limita esta información horaria a los últimos diez días.
- Conserva los offsets de las horas y los campos
  `metadata.first_incomplete_date` y `metadata.first_incomplete_hour`
  cuando el proveedor los devuelve, para identificar datos provisionales.
- Añade `searchAppearance`: primero se consulta como única dimensión y
  después se usa un valor devuelto como filtro `equals` en otra consulta.
- Mantiene el nombre público `searchType`, pero ambos adaptadores y la
  consulta de ejemplo del setup envían a Google el campo `type`.
- Expone `aggregationType` y valida combinaciones incompatibles antes de
  consultar Google. `byProperty` no admite agrupación ni filtro por página,
  Discover ni Google News. `byNewsShowcasePanel` exige el tipo y filtro
  `NEWS_SHOWCASE` correspondientes, sin página como dimensión ni filtro.
- Distingue la pestaña News de búsqueda (`news`), que admite consultas, del
  informe Google News (`googleNews`), que no las admite. Discover rechaza
  las dimensiones o filtros `query` y `device`.
- Conserva la agregación comunicada por Google como
  `upstreamAggregationType`, separada del campo de compatibilidad de la
  respuesta existente.
- `gsc_detect_cannibalization` añade `includeTimeline` opcional,
  `timelineQueryLimit` y `minDailyImpressions`. La línea temporal analiza
  hasta diez consultas seleccionadas; por defecto analiza cinco.
- El resumen temporal necesita siete días observados y un cambio sostenido
  requiere tres días naturales consecutivos. Los empates son indeterminados
  y las ausencias no se convierten en ceros ni completan secuencias.
- Los resultados siguen siendo candidatos. Compartir tráfico diario entre
  URLs no demuestra presencia simultánea en una SERP ni perjuicio SEO.

### Historial local, cursores y evidencia completa

- `GSC_HISTORY=1` habilita registros y lecturas persistentes, eliminación de
  cambios e instantáneas. Es independiente de `GSC_EXPORTS=1` y no añade
  permisos de Google. El análisis transitorio no necesita ninguna bandera.
- El historial queda aislado por perfil y propiedad, con escrituras
  atómicas, claves de idempotencia y un límite acumulado de 100 MiB.
  No hay purga automática.
- Las auditorías usan sesiones en memoria y continuación explícita mediante
  `nextCursor` como entrada `cursor`. Caducan tras quince minutos de
  inactividad o al reiniciar el proceso y están limitadas por capacidad.
- Las vistas previas señalan sus recortes y permiten recuperar la evidencia
  recuperada mediante `gsc_get_dataset`, sin repetir consultas a Google.
  Los datasets duran quince minutos desde su creación y pueden expulsarse
  por capacidad; no constituyen un archivo permanente ni cobertura exhaustiva.
- Los fragmentos de auditoría usan `index`, `part`, `parts` y
  `evidence`; la evidencia temporal usa `evidenceBase64`. Se documenta
  cómo reconstruir cada formato, incluido el resumen de la auditoría.
- Las instantáneas grandes se recuperan con bloques `snapshotChunk` de
  hasta 24 KiB, en base64, y su propio cursor persistente. Se concatenan los
  bytes por instantánea y offset antes de interpretar UTF-8 y JSON.
- La eliminación afecta únicamente al historial local. Si se cancela después
  de haber empezado a borrar archivos, puede quedar parcialmente aplicada;
  cerrar sesión no borra automáticamente los registros ni las instantáneas.
- `complete` indica que terminó el trabajo acotado, no que la cobertura
  sea exhaustiva. Se mantienen `status`, advertencias, fallos individuales
  y motivos de cobertura incompleta.

### Límites operativos y correcciones

- Cada llamada de auditoría tiene hasta 60 segundos y doce intentos contra
  Google. Las lecturas web tienen timeout de recurso, límites de tamaño y
  redirecciones comprobadas; el HTML se limita a 2 MiB.
- El descubrimiento procesa hasta diez archivos sitemap por llamada, con un
  presupuesto de 50 MiB descomprimidos y hasta 10.000 URLs descubiertas.
- Alcanzar el límite de descubrimiento termina con cobertura limitada en
  lugar de generar una continuación que no puede avanzar.
- Un sitemap que exceda los bytes restantes de una llamada puede retomarse
  en la siguiente. Los recursos que excedan el límite total se rechazan de
  forma explícita; un hijo fuera de alcance no descarta a sus hermanos válidos.
- Las redirecciones se atribuyen a la URL HTTP efectiva: se deduplican alias,
  enlaces entrantes y fuentes sugeridas, y se evitan sugerencias hacia la
  propia página efectiva.
- Las directivas de robots se interpretan por token y alcance de crawler.
  Un valor como `max-image-preview:none` no se confunde con `noindex`.
  También se evalúan las cabeceras de respuestas que no son HTML.
- Los fallos observados en lotes anteriores conservan el estado parcial al
  continuar; una pausa debida solo al presupuesto no queda como fallo permanente.
- La cancelación detiene trabajo pendiente y se comprueba antes de efectos
  sobre el historial. Los proveedores DNS u OAuth sin respuesta también
  quedan acotados por el plazo global.
- Se limita el tamaño de las vistas previas temporales, se conserva su
  evidencia recuperable y se contabiliza la capacidad del dataset en bytes UTF-8.

### Documentación, distribución y compatibilidad

- El catálogo, los esquemas MCP, las capacidades, los metadatos del registro
  y las comprobaciones de instalación reconocen las 34 herramientas.
  Se conserva la fixture histórica de 29 y una captura independiente del
  contrato actual.
- Se corrigen las referencias a herramientas de imagen retiradas y los
  indicadores de capacidades para análisis de imágenes y consultas GenAI.
- La skill incluida pasa a 1.1.0. README, catálogo completo, guías en inglés
  y español y privacidad documentan ejemplos, permisos, cursores y límites.
- La documentación web incorpora referencias de herramientas, auditorías,
  historial y Analytics, con navegación, metadatos canónicos y sitemap de
  trece URLs. Sus ejemplos se contrastan con los esquemas del SDK MCP.
- La CLI, el paquete, el manifiesto de distribución, el registro MCP y la
  versión mostrada por la web quedan alineados en 1.1.0.
- Se mantienen Node.js 22 o posterior y Bun, las tres herramientas de escritura
  de Google con activación explícita y el consentimiento separado para
  exportar o guardar historial.
- La verificación incluye Node y Bun, configuración regional en español,
  Windows con Node 22 y 26, y pruebas del tarball instalado en Linux y Windows.
- Se mantienen los módulos de Search Analytics, OAuth, indexación, sitemaps,
  imágenes y consultas GenAI con los nombres y entradas obligatorias anteriores.
- La imagen Docker basada en Node 22 permite iniciar el servidor stdio y listar
  herramientas sin credenciales; el contexto de build excluye secretos y estado local.
- CI distingue cambios MCP, web y compartidos. El catálogo canónico es una
  dependencia compartida; las rutas desconocidas o diffs incompletos activan
  una comprobación conservadora en ambos grupos.
- El `lastmod` del sitemap procede de las fechas Git de los archivos que
  construyen cada página, con historial completo en CI y dependencias
  explícitas para el catálogo y los ejemplos compartidos.
- El preflight de release exige los jobs Node, Bun y ambas matrices Windows
  correctos para el SHA y el intento exactos. La distribución se audita y
  prueba instalada antes de publicar; la finalización contrasta los bytes
  del registro npm con el candidato y verifica el tag y los assets de GitHub.

### Actualización y alcance

```sh
npm install -g @sonnivasquez/gsc-mcp@1.1.0
```

También puede usarse `gsc update`. Comprueba `gsc --version` y reinicia el
cliente MCP para que deje de ejecutar el servidor anterior. La actualización
del paquete conserva tokens, perfiles y configuración del cliente.

Las auditorías solo trabajan cuando se invocan. No se instala un scheduler,
daemon, monitorización permanente ni servicio de notificaciones.
`gsc_check_alerts` conserva su evaluación bajo demanda. El análisis usa HTML
recibido por HTTP; el contenido y los enlaces generados por JavaScript
permanecen desconocidos. No se prometen garantías de indexación ni ranking.


## 1.0.0

Primera versión estable. Mantiene el catálogo y el comportamiento de 0.1.0;
el cambio de versión no introduce operaciones adicionales contra Google.

- CLI `gsc` y alias `gsc-mcp`, compatibles con Node.js 22 o posterior y Bun.
- 29 herramientas MCP: 24 herramientas canónicas `gsc_*` y 5 heredadas.
- Acceso de solo lectura por defecto. Las operaciones de escritura requieren
  activación explícita y credenciales con los permisos correspondientes.
- Quick Connect con OAuth compartido de solo lectura; OAuth propio y cuentas
  de servicio disponibles para configuraciones administradas por el usuario.
- Configuración de clientes MCP, diagnóstico con `doctor` y selección explícita
  de propiedades autorizadas.
- Documentación de distribución saneada: se retiran del changelog las evidencias
  operativas, las identidades de propiedades y las métricas de cuentas reales.
- Versión unificada en la CLI, los metadatos MCP y los mensajes de configuración.
- Actualización asistida: `gsc update` reinstala la última versión publicada
  (npm o Bun, según el runtime) y verifica la versión en disco; `gsc update
  --check` solo compara. `doctor --online` añade un chequeo de versión que
  nunca falla y avisa cuando existe una versión más reciente.

### Actualización

```sh
npm install -g @sonnivasquez/gsc-mcp@1.0.0
```

También puedes usar `gsc update` para actualizar a la última versión publicada
de forma asistida, o `gsc update --check` para comparar sin instalar.

No se requiere migrar la configuración por este cambio de versión. Las
restricciones de acceso y permisos de Google se mantienen. Actualizar no
modifica ni elimina paquetes anteriores o copias ya descargadas.

## 0.1.0 — 2026-10-11

Primera publicación en npm, con instalación global, autenticación OAuth,
diagnóstico y catálogo MCP. Esta entrada resume el release sin reproducir
los registros internos usados durante su validación.
