# Instrucciones del repositorio

Empieza por [AI_CONTEXT/CONTEXT.md](AI_CONTEXT/CONTEXT.md). Consulta decisiones, tareas o aprendizajes solo cuando sean relevantes para el trabajo actual.

## Contexto mínimo

- [Contexto verificable](AI_CONTEXT/CONTEXT.md): propósito, stack e inventario comprobable.
- [Decisiones](AI_CONTEXT/DECISIONS.md): decisiones vigentes y su motivo.
- [Tareas](AI_CONTEXT/TASKS.md): trabajo activo; no es un historial.
- [Aprendizajes](AI_CONTEXT/LEARNINGS.md): hallazgos reutilizables y confirmados.

## Responsabilidades de las herramientas

- **Project Brain** actualiza únicamente los hechos verificables dentro del bloque generado de `CONTEXT.md`.
- **Graphify** deriva relaciones y visualizaciones a partir del repositorio; `graphify-out/` es reconstruible y no es contexto fuente.
- **Obsidian** navega y permite editar estos mismos archivos Markdown; ninguna función depende de wikilinks ni de plugins.

## Reglas de trabajo

- Distingue hechos observados de propuestas o supuestos.
- No edites el bloque generado de `CONTEXT.md`; usa `brain sync .`.
- Conserva el contenido manual fuera de los marcadores generados.
- Actualiza únicamente el archivo cuyo propósito corresponda al cambio.
- Usa el historial de Git para el pasado; evita duplicar bitácoras o reportes.
- No guardes credenciales, tokens, llaves privadas ni evidencia restringida.
- No borres datos, publiques ramas ni despliegues sin autorización explícita.

## Validación

Ejecuta `brain sync .` y después `brain doctor .` cuando cambien hechos verificables del repositorio.
