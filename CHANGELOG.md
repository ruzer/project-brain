# Changelog

## 0.3.1 - 2026-09-02

### Endurecimiento compatible

- Preserva byte por byte `RepositoryOwnedContent`, rechaza UTF-8 inválido y falla cerrado ante cambios concurrentes de contenido o identidad.
- Separa observaciones verificadas, detecciones heurísticas y comandos candidatos dentro de `GeneratedProjection`.
- Añade warnings compatibles para roles, frontmatter, frescura e `IntegrationReference`, manteniendo `ok: true` cuando sólo existen warnings.
- Formaliza los resultados públicos, la semántica de `Diagnostic` y el modo aditivo de inventario de `RepositoryObservation`.
- Define el modelo de dominio y la frontera de autoridad con Project Memory Hub sin introducir conectores ni sincronización.
- Añade cobertura black-box del proceso real y validación del paquete desde un consumidor temporal offline.

## 0.3.0 - 2026-08-26

### Cambios incompatibles

- Renombra el paquete de `project-brain` a `@ruzer/project-brain`.
- Retira el ejecutable `project-brain` y conserva únicamente `brain`.
- Elimina análisis autónomo, agentes, swarm, governance, grafos internos y reportes; `v0.2.5` conserva el producto anterior como legado.
- No migra automáticamente estructuras ni salidas 0.2.x.

### Núcleo ligero

- Reduce el producto a `brain init`, `brain sync` y `brain doctor`.
- Define un contrato de cinco archivos Markdown compatible con Obsidian.
- Conserva contexto manual y actualiza solo hechos verificables.
- Excluye salidas de Graphify y elimina grafos, agentes y runtimes duplicados.
- Añade validaciones de tamaño, enlaces, duplicados y datos sensibles.
