# Project Brain Lite

Project Brain mantiene contexto útil para agentes sin convertirse en otra plataforma. Inspecciona hechos verificables del repositorio y deja las decisiones humanas en cuatro notas Markdown pequeñas.

## Inicio rápido

Requiere Node.js 20 o posterior.

```bash
npm install --save-dev @ruzer/project-brain
npx brain init .
```

Eso crea, sin sobrescribir archivos existentes:

```text
AGENTS.md
AI_CONTEXT/
├── CONTEXT.md
├── DECISIONS.md
├── TASKS.md
└── LEARNINGS.md
```

Ejemplo de uso cotidiano:

```bash
# Después de cambiar stack, estructura o scripts:
npx brain sync .

# Antes de confirmar cambios de contexto:
npx brain doctor .
```

## Los tres comandos

- `brain init [ruta]`: crea únicamente los cinco archivos que falten y sincroniza el inventario.
- `brain sync [ruta]`: actualiza hechos comprobables dentro del bloque generado de `CONTEXT.md`; conserva byte por byte el contenido manual restante.
- `brain doctor [ruta]`: detecta exceso de contexto, enlaces rotos, duplicados, archivos extra y posibles datos sensibles. Usa `--json` para automatización.

El escáner usa primero el inventario de Git y respeta `.gitignore`; fuera de Git hace un recorrido local seguro. No llama modelos, servicios cloud ni procesos autónomos. La huella es determinista y no incluye marcas de tiempo.

## Responsabilidades claras

- **Project Brain:** crea el contrato y actualiza únicamente el bloque verificable de `CONTEXT.md`; el contenido manual pertenece al equipo.
- **Graphify:** relaciones y grafos. Mantén su salida reconstruible en `graphify-out/`.
- **Obsidian:** navegación y edición humana de Markdown.
- **Git:** historial; no dupliques bitácoras en el contexto activo.

El escáner de Project Brain excluye `graphify-out/`, `.graphify/` y `.obsidian/` para evitar ciclos; no instala ni configura Graphify u Obsidian. No se necesita migración: adopta este contrato solo en proyectos donde decidas ejecutar `brain init`.

## Desarrollo

```bash
npm test
npm run check
```

El contrato verificable vive en [`schema/context-contract.schema.json`](schema/context-contract.schema.json).
