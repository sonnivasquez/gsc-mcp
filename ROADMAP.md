# Roadmap

Este documento describe prioridades de mantenimiento, no compromisos de fecha.
El catálogo disponible se documenta en [docs/tools.md](docs/tools.md).

## Base de 1.0.0

- CLI local con instalación npm o Bun, configuración de clientes MCP y `doctor`.
- 29 herramientas MCP, con acceso de solo lectura por defecto, allowlist de
  propiedades y controles explícitos para escritura y exportación local.
- Quick Connect mediante OAuth Desktop compartido de solo lectura. También
  se admiten OAuth propio y cuentas de servicio.
- Documentación de instalación, acceso y privacidad en el paquete.

La versión 1.0.0 conserva el comportamiento de 0.1.0. No añade capacidades
nuevas contra Google ni exige migrar la configuración existente.

## Próximas revisiones

- Automatizar la preparación y publicación de releases con validación del
  tarball exacto, detección de datos privados y comprobaciones de versiones.
- Ampliar la validación de la experiencia de instalación dentro de clientes
  MCP reales, además de las pruebas de protocolo y CLI.
- Revisar las dependencias obsoletas y mantener la matriz Node, Bun y Windows.
- Mantener separadas las comprobaciones de OAuth funcional y cualquier
  verificación de marca de Google. Este documento no afirma aprobación de Google.
- Completar la revisión del historial y los assets antiguos antes de cambiar
  la visibilidad del repositorio. Un paquete saneado no elimina copias anteriores.

Las funciones futuras se evaluarán por su utilidad y por los datos que Google
realmente proporciona. No se prometen garantías de indexación, ranking ni
cobertura completa de Search Console.

## Licencia y procedencia

Se mantienen Apache-2.0 y la atribución del proyecto base en [NOTICE](NOTICE).
