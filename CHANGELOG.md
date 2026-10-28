# Changelog

## 1.1.0

- Fix capped audit termination, resumable sitemap byte budgets, isolated sitemap children, effective-URL graph deduplication and persistent partial status.
- Respect cancellation before history effects; stream large saved snapshots through bounded scoped cursors.
- Parse robots directives by token and crawler scope; bound temporal MCP previews with fully recoverable evidence.

- Add five bounded, on-demand website/indexing/link/change/migration audits.
- Add independently gated local history (GSC_HISTORY=1), resumable in-memory audit batches and recoverable evidence previews.
- Support hourly and search-appearance analytics, provider aggregation and incomplete-data metadata; use the provider type parameter.
- Add opt-in temporal cannibalization evidence and correct capability gates.
- No scheduler, daemon or notification service.
- Centralize Search Analytics request rules and expose optional aggregation; distinguish the News search tab from Google News and map the public searchType input to Google's type field in both clients and setup.
- Replace retired image-tool references, validate all registered tool mappings, and show the live Glama score badge.
- Align the website, agent skill, registry environment variables and installed-release checks with the complete 34-tool catalog.

- Rewrote the Search Analytics, OAuth, indexing, sitemap, image-audit,
  and GenAI query modules in this repository. Tool names, input schemas,
  outputs, error codes, environment variables, and the read-only default
  stay the same. `compatibility-manifest.json` now records this package
  at 1.0.0.
- Copyright notices credit Sonni Vasquez. Public pages, NOTICE, and the
  license appendix no longer attribute the project to another author.
- `Dockerfile` builds the stdio MCP server from this repo on Node 22 so Glama
  can start it with no Google credentials. `.dockerignore` keeps secrets and
  local state out of the build context.
- CI routes by changed areas via `scripts/ci-changed.mjs` (`mcp_changed` /
  `web_changed`). Shared inputs (site facts, installer, version metadata,
  design tokens, workflows, classifier) run both; other `web/**` runs Web
  only and MCP areas run Node/Bun/Windows only. `README.md` and `PRIVACY.md`
  are package docs the site does not render, so they run MCP only.
- CI classifier correction: unknown top-level paths run both pipelines (only
  explicit root MCP build files `bun.lock`, `tsconfig.json`,
  `compatibility-manifest.json`, `.mcpbignore`, and `server.json` stay
  MCP-only), and truncated or mis-scored `git diff --name-status -z` output
  falls back to both instead of routing on partial data.
- Sitemap `lastmod` is the latest `git log -1 --format=%cs` date of the
  source files for that URL. The web CI checkout uses `fetch-depth: 0`.
- Release preflight now requires the actual attempt-scoped jobs: one
  successful `Node` and `Bun` for `ci.yml`, plus both
  `Windows Node 22 and Bun 1.4.2` and `Windows Node 26 and Bun 1.4.2` for
  the Windows workflow, with a post-jobs run reread against rerun races.

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
