# Instrucciones del repositorio

Empieza por [AI_CONTEXT/CONTEXT.md](AI_CONTEXT/CONTEXT.md). Consulta decisiones, tareas o aprendizajes solo cuando sean relevantes para el trabajo actual.

Al cambiar vocabulario, ownership o la frontera con Project Memory Hub, consulta el [glosario y la matriz de autoridad](README.md#modelo-de-dominio-031).

## Contexto mínimo

- [Contexto técnico](AI_CONTEXT/CONTEXT.md): propósito, proyección derivada y restricciones del repositorio.
- [Decisiones](AI_CONTEXT/DECISIONS.md): elecciones técnicas; sólo una decisión aceptada es normativa.
- [Tareas](AI_CONTEXT/TASKS.md): trabajo activo; no es un historial.
- [Aprendizajes](AI_CONTEXT/LEARNINGS.md): hallazgos reutilizables y confirmados.

## Responsabilidades de las herramientas

- El **Repository** es la autoridad factual y conserva `RepositoryOwnedContent`.
- **Project Brain** regenera únicamente `GeneratedProjection` dentro de los marcadores de `CONTEXT.md`.
- Lee la proyección distinguiendo observaciones verificadas, detecciones heurísticas y comandos candidatos no ejecutados.
- **Project Memory Hub**, cuando se usa, conserva owners, fechas, riesgos, milestones y estado de gestión.
- **Graphify** deriva relaciones y visualizaciones a partir del repositorio; `graphify-out/` es reconstruible y no es contexto fuente.
- **Obsidian** navega y permite editar estos mismos archivos Markdown; ninguna función depende de wikilinks ni de plugins.

## Reglas de trabajo

- Distingue `ObservedFact` de `Detection`, propuesta o supuesto.
- No edites el bloque generado de `CONTEXT.md`; usa `brain sync .`.
- `RepositoryOwnedContent` debe preservarse byte por byte fuera de los marcadores generados.
- Actualiza únicamente el archivo cuyo propósito corresponda al cambio.
- Usa el historial de Git para el pasado; evita duplicar bitácoras o reportes.
- No guardes credenciales, tokens, llaves privadas ni evidencia restringida.
- No borres datos, publiques ramas ni despliegues sin autorización explícita.

## Validación

Ejecuta `brain sync .` y después `brain doctor .` cuando cambie el estado observable del repositorio.
