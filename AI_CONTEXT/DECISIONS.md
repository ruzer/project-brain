---
project_brain: 1
role: decisions
---

# Decisiones

## Núcleo ligero

- **Estado:** aceptada
- **Decisión:** Project Brain solo administra contexto verificable con `init`, `sync` y `doctor`.
- **Motivo:** el uso real requiere orden y continuidad, no otra plataforma multiagente.
- **Consecuencia:** Graphify posee relaciones, Obsidian navega Markdown y Git conserva el historial.

## Adopción explícita

- **Estado:** aceptada
- **Decisión:** no incluir migraciones automáticas desde formatos anteriores.
- **Motivo:** cada repositorio conserva necesidades y datos con distinto nivel de sensibilidad.
- **Consecuencia:** `brain init` se ejecuta únicamente donde se autorice adoptar el contrato.

## Separación entre contexto técnico y gestión

- **Estado:** aceptada
- **Decisión:** Project Brain conserva el contexto técnico del repositorio y Project Memory Hub conserva la memoria de gestión y genera la vista global.
- **Motivo:** evitar fuentes de verdad duplicadas, mantener un núcleo técnico ligero y permitir que ambos productos funcionen de forma independiente.
- **Consecuencia:** la integración usa enlaces y referencias con procedencia; ninguno copia los registros canónicos del otro y sus archivos `AI_CONTEXT` no se fusionan.

Consulta primero el [Contexto](CONTEXT.md).
