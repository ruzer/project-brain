# Changelog

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
