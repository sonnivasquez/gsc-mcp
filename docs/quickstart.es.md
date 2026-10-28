# Guía rápida

Conecta tu asistente de IA con Google Search Console en tres pasos: instala el MCP, inicia sesión en Google y elige una propiedad y un cliente.

For English, see the [English quickstart](quickstart.md).

## 1. Instala

Necesitas **Node.js 22 o superior**. El instalador usa npm de forma predeterminada. También puedes usar Bun como gestor de paquetes, pero Node sigue siendo necesario para ejecutar el comando `gsc`.

### curl

Instala la última versión de forma global y abre la configuración:

```bash
curl -fsSL https://gscmcp.dev/install.sh | sh
```

Para instalar con Bun en vez de npm:

```bash
curl -fsSL https://gscmcp.dev/install.sh | sh -s -- --manager bun
```

### npm

```bash
npm install -g @sonnivasquez/gsc-mcp && gsc setup
```

### Bun

```bash
bun install -g @sonnivasquez/gsc-mcp && gsc setup
```

Ambos comandos instalan la última versión de forma global. `gsc` seguirá disponible al cerrar la terminal o borrar la caché del gestor.

## 2. Conecta Google y tu cliente MCP

La configuración es silenciosa por defecto; añade `--verbose` para ver el detalle completo o
`--dry-run` para previsualizar sin cambios. Te guía en tres pasos:

1. Inicia sesión: elige `Quick Connect (recomendado, solo lectura, sin indexación)` e inicia
   sesión en Google desde el navegador. Para acceso completo, usa `Custom OAuth (acceso completo,
   indexación)` o `Service Account (acceso completo, indexación)` con acceso
   `Completo (datos + indexación)` en vez de `Solo lectura (solo datos)`. El acceso completo pide
   una confirmación separada antes de habilitar escrituras.
2. Selecciona la propiedad de Search Console: pulsa Enter para la primera, elige números para una
   lista explícita, o elige `[0]` (o `all`) para todas las actuales y futuras, lo que avisa y pide
   una segunda confirmación.
3. Elige tu cliente MCP (`desktop`, `code`, `cursor`, `codex`, `opencode`, `pi` o `Formato JSON`).
   Revisa la vista previa y aprueba los cambios de configuración cuando se te solicite. La
   configuración conserva los demás servidores MCP. OpenCode y Pi solo se configuran de forma global.

Solo lectura es el valor predeterminado. `--yes` acepta los valores predeterminados, así que nunca
activa las operaciones de escritura, la consulta de muestra ni la instalación de la skill de agente
(ambas estrictamente opt-in).

Copia este prompt en un agente que pueda ejecutar comandos de terminal y configurar servidores MCP. El prompt está en inglés; completa tú el inicio de sesión de Google en el navegador.

```text
Install @sonnivasquez/gsc-mcp globally with npm (or Bun if I prefer), then run gsc setup.
Use read-only Quick Connect. Help me sign in to Google, choose my Search Console property,
and connect this MCP to my client without removing other MCP servers. Never ask me to paste
credentials or tokens into chat. Verify with gsc doctor and tell me if I need to restart
my client. Do not run a Search Console query until I ask.
```

Quick Connect no requiere configurar Google Cloud y solo da acceso de lectura. Para usar tu propio cliente OAuth, una cuenta de servicio o acceso completo, consulta la [guía de credenciales](https://gscmcp.dev/docs/credentials). Para configurar un cliente específico, consulta [clientes compatibles](https://gscmcp.dev/docs/clients).

## 3. Comprueba la conexión

```bash
gsc doctor
gsc auth status
```

`gsc doctor` comprueba el tiempo de ejecución y la configuración local. `gsc auth status` muestra el estado de la sesión guardada. Para validar el acceso con una solicitud mínima a Google, ejecuta:

```bash
gsc auth status --online
```

Si tu cliente no muestra las herramientas MCP al terminar la configuración, reinícialo. El servidor ofrece **34 herramientas** para rendimiento de Search Console, comparaciones, indexación, sitemaps e informes. Consulta el [catálogo de herramientas](tools.md).

Para probar una auditoría, pide una auditoría de página bajo demanda para
una URL autorizada. Se lee el HTML HTTP sin ejecutar JavaScript: revisa estado,
cobertura y advertencias. Continúa con el cursor devuelto cuando lo solicites.
El historial persistente es opcional y requiere `GSC_HISTORY=1`, independiente
de las exportaciones. Consulta [entradas, límites y ejemplos](tools.md#auditorías-bajo-demanda-110).
Comprueba la versión con `gsc --version` y `gsc_capabilities` tras reiniciar
el cliente; 1.0.0 no incluye estas cinco auditorías.

## Actualiza o desinstala

El actualizador conserva tus tokens de Google, perfiles y configuraciones de clientes. Revisa las notas de la versión por si necesita pasos específicos y reinicia tu cliente MCP después de actualizar.

La vía asistida comprueba el registro, reinstala y verifica:

```bash
gsc update
```

Para comparar la versión instalada con la última del registro sin instalar nada, ejecuta `gsc update --check`. `gsc doctor --online` muestra la misma comparación.

Vuelve a instalar con tu gestor preferido para actualizar:

```bash
npm install -g @sonnivasquez/gsc-mcp
```

Con Bun, ejecuta `bun install -g @sonnivasquez/gsc-mcp`. Después de actualizar, comprueba con `gsc --version` y **reinicia tu cliente MCP**: el servidor anterior sigue corriendo hasta que lo reinicies.

Para quedarte en una versión concreta o volver atrás, indica la versión:

```bash
npm install -g @sonnivasquez/gsc-mcp@1.0.0
```

Actualizar, fijar o revertir versión no toca tus tokens de Google, tus perfiles ni la configuración de tus clientes. Para quitar el CLI, usa `npm uninstall -g @sonnivasquez/gsc-mcp` o `bun remove -g @sonnivasquez/gsc-mcp`. Quitar el paquete tampoco elimina tus tokens locales de Google. Consulta la [guía de desinstalación](https://gscmcp.dev/docs/uninstall) si también quieres borrar los datos locales o revocar el acceso.

## Más ayuda

- [Referencia de comandos CLI](https://gscmcp.dev/docs/commands)
- [Solución de problemas](https://gscmcp.dev/docs/troubleshooting)
- [Privacidad y manejo de datos](../PRIVACY.md)
