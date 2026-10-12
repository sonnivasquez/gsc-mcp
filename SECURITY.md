# SECURITY

## Reportar

Abre un issue privado al responsable del producto con: versión (`--version`),
runtime (`doctor`), `code` de error y pasos. Nunca incluyas tokens, claves,
`client_secret`, ni contenido de `~/.gsc-mcp/`.

## Modelo de amenazas (resumen)

- Cliente/modelo malicioso: los argumentos se tratan como datos; schemas
  estrictos; sin SQL/shell/fetch arbitrario; SSRF fuera de la allowlist de
  endpoints Google.
- Exfiltración de tokens: bearer solo en cabecera a hosts Google;
  errores saneados (sin payloads crudos al modelo).
- Confusión entre cuentas: perfil fijo por proceso + allowlist + datasets
  por perfil.
- DoS local: budgets, timeouts, topes de filas/bytes/lotes.

## Lo que NO prometemos

- Protección ante máquina comprometida (root/admin local).
- Cifrado en reposo: permisos `0600`, no vault (almacén del sistema en P1).
- Cuota global: el contador local no conoce otras apps del mismo proyecto.

## Dependencias

Lockfiles (`bun.lock`, `package-lock.json`) fijan versiones. `npm audit`
antes de cada release; `test:package` verifica el tarball limpio.
