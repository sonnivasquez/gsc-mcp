# PRIVACY

## Dónde viven tus datos

| Qué | Dónde | Quién lo ve |
|---|---|---|
| Sesión OAuth | `~/.gsc-mcp/` o `GSC_DATA_DIR`; se intentan aplicar permisos `0700` al directorio y `0600` al archivo | Tu proceso local; los tokens se envían a Google para autenticar |
| Credenciales aportadas por el usuario | Archivo en la ruta que configures; tú administras sus permisos | Tu proceso local, que las usa para autenticarse con Google |
| Perfiles (allowlists) | Mismo directorio, sin secretos | Solo tu máquina |
| Respuestas de tools | Proceso MCP → tu cliente MCP | **Tu cliente y su proveedor de IA** |
| Caché/datasets | Memoria del proceso (15 min datasets) | El proceso local |

## Lo que "local" NO significa

"Local" significa: sin backend nuestro, sin telemetría, sin cuentas.
NO significa que las respuestas se queden en tu máquina: tu cliente MCP las
envía a su proveedor de IA para redactar la respuesta. Lee la política de tu
cliente antes de consultar propiedades sensibles.

## Limpieza

- `auth logout`: borra la sesión OAuth local (no revoca en Google).
- `auth revoke --yes`: revoca en Google y borra lo local.
- Borrar el directorio de datos activo elimina la sesión y los perfiles guardados allí. Si configuraste `GSC_DATA_DIR`, ese es el directorio a revisar, no necesariamente `~/.gsc-mcp/`.
- Las exportaciones y los reportes guardados con opt-in son archivos tuyos; no se borran solos. Tampoco se eliminan las credenciales que aportaste desde otras rutas.

## Permisos mínimos

Quick Connect usa el cliente OAuth compartido y solo admite lectura en 1.0.0.
La escritura requiere OAuth propio o service account con permisos adecuados.
Scope único `webmasters.readonly` por defecto. Con esos modos, `GSC_ACCESS_MODE=full` solicita
además `webmasters` e `indexing` y habilita envíos de sitemaps y notificaciones
de URL. No solicita Gmail, Drive ni Analytics. Sin la variable nueva, la
configuración legacy conserva sus scopes y su control separado de escritura.

## Uso de APIs de Google

GSC MCP llama a las APIs de Search Console e Indexing directamente desde tu
máquina. Sin servidores del desarrollador, sin telemetría, sin cuentas, sin
uso publicitario. Las lecturas analizan tus propias propiedades cuando lo
pides; las escrituras solo ocurren con acceso `full` y acción explícita tuya
(sitemaps, notificaciones de URL). Las auditorías de imagen además descargan
páginas de tu propio sitio, no de Google. Las respuestas van al cliente MCP y
a su proveedor de IA; su retención sigue la política de tu cliente. Antes de
conectar, revisa las condiciones y ajustes de retención, entrenamiento y
revisión humana de ambos. GSC MCP no controla esos servicios ni garantiza
que excluyan tus datos del entrenamiento.
Reglas de datos de Google: https://developers.google.com/terms/api-services-user-data-policy
Esta página no afirma estado de verificación o aprobación.

## Contacto

Mantenedor: Sonni Vasquez — https://sonnivasquez.com — https://github.com/sonnivasquez
No se publica otro correo de soporte en esta página.
