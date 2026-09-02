---
project_brain: 1
role: decisions
---

# Decisiones

Registra únicamente decisiones técnicas del repositorio. Estos registros son `RepositoryOwnedContent` y no se generan, aceptan ni migran automáticamente.

## Estados

- propuesta (`proposed`): candidata no autoritativa; no condiciona el trabajo.
- aceptada (`accepted`): único estado normativo y elección técnica vigente.
- reemplazada (`replaced`): deja de ser normativa y conserva una referencia breve a su sucesora aceptada. Git conserva el historial detallado.

## Plantilla

### Título breve

- **Estado:** propuesta | aceptada | reemplazada
- **Decisión:** qué se decidió.
- **Motivo:** evidencia o restricción que la justifica.
- **Consecuencia:** qué cambia al trabajar en el repositorio.
- **Sucesora:** para una decisión reemplazada, usa una referencia interna como `[Decisión sucesora](#decision-sucesora)`; omite este campo en los otros estados.

Consulta primero el [Contexto](CONTEXT.md).
