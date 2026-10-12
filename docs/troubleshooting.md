# Troubleshooting

## La configuración (setup) termina en silencio

Es lo normal: `gsc setup` muestra el título, una línea por paso y una de
resultado. Para ver el detalle (entradas JSON, rutas, verificación de
7 secciones), usa `--verbose`; para previsualizar sin iniciar sesión ni
escribir, usa `--dry-run`.

## Elegir todas las propiedades pide doble confirmación

Elegir `[0]` o `all` cubre las propiedades actuales y futuras, avisa del
alcance y pide confirmación explícita. Si no la confirmas, no se cambia
nada: vuelve a ejecutar setup y elige propiedades explícitas o confirma
explícitamente. Pulsa Enter para quedarte con la primera propiedad.

## El cliente no ve los tools

Las apps gráficas no heredan tu `PATH`. Usa `config print` (rutas absolutas)
y reinicia el cliente tras cambiar su config.

## `AUTH_REQUIRED` / `REAUTH_REQUIRED`

Ejecuta en terminal: `gsc-mcp auth login`. El servidor MCP nunca abre
navegadores por sí solo. Si el refresh falla (revocado, app en Testing con
más de 7 días), el error lo dice y pide reconectar.

## `PROPERTY_NOT_ALLOWED`

La propiedad no está en la allowlist de la instancia. Opciones explícitas:
servir con `--profile` que la incluya o añadirla a `GSC_SITE_URLS`.
Los argumentos de un tool jamás amplían la allowlist.

## `PROPERTY_PERMISSION_DENIED` vs `API_DISABLED` vs `QUOTA_EXCEEDED`

Son distintos a propósito: revisa permisos de la cuenta, habilitación de la
Search Console API en tu proyecto Google, o reduce carga y reintenta.
`status --online` distingue los tres.

## `REQUEST_BUDGET_EXCEEDED` / respuestas parciales

Reduce `maxFetchRows`, `resultLimit` o el número de URLs. Los parciales
conservan los éxitos; reintenta solo lo pendiente.

## `DATASET_EXPIRED`

Los datasets viven 15 min y no cruzan perfiles. Re-ejecuta la consulta
origen; el nuevo `datasetId` viene en `meta`.

## OAuth: app en Testing

Google puede caducar refresh tokens a los 7 días en apps externas en estado
Testing con scopes no-identidad. Es una causa posible, nunca el diagnóstico
automático: `doctor` y `auth status` la mencionan sin asegurarla.

## Actualicé y el cliente sigue con la versión anterior

El servidor MCP anterior sigue corriendo hasta que reinicies el cliente.
Confirma la versión instalada con `gsc --version`, compara con el registro con
`gsc update --check` y reinicia el cliente MCP. La actualización nunca toca
tokens, perfiles ni la configuración de clientes.

## Soporte

Abre un issue con la salida saneada de `doctor` + el `code` de error.
Nunca pegues tokens, claves ni `~/.gsc-mcp/`.
