# Project Brain Lite

Project Brain mantiene contexto útil para agentes sin convertirse en otra plataforma. Inspecciona hechos verificables del repositorio y deja las decisiones humanas en cuatro notas Markdown pequeñas.

## Inicio rápido

Requiere Node.js 20 o posterior.

```bash
npm install --save-dev github:ruzer/project-brain#v0.3.0
npx brain init .
```

`@ruzer/project-brain` todavía no está publicado en el registro público de npm. Hasta que exista una publicación separadamente autorizada, instala el tag de GitHub o usa un clon local con `npm install --save-dev /ruta/al/project-brain`.

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

- **Project Brain:** mantiene el contexto técnico local del repositorio: stack, estructura, comandos verificables y notas técnicas. Crea el contrato y actualiza únicamente el bloque verificable de `CONTEXT.md`; el contenido manual pertenece al equipo.
- **Project Memory Hub (opcional):** conserva y presenta la memoria de gestión: responsables, fechas, hitos, riesgos, decisiones, fuentes, roadmap y estado global.
- **Graphify:** relaciones y grafos. Mantén su salida reconstruible en `graphify-out/`.
- **Obsidian:** navegación y edición humana de Markdown.
- **Git:** historial; no dupliques bitácoras en el contexto activo.

Cuando Project Brain y Project Memory Hub conviven, funcionan como repositorios hermanos e independientes. Se enlazan sus fuentes canónicas mediante referencias con procedencia; Project Brain no copia ni sincroniza la memoria de gestión del hub, y sus respectivos archivos `AI_CONTEXT` no se fusionan.

El escáner de Project Brain excluye `graphify-out/`, `.graphify/` y `.obsidian/` para evitar ciclos; no instala ni configura Graphify u Obsidian. No se necesita migración: adopta este contrato solo en proyectos donde decidas ejecutar `brain init`.

## Migración desde 0.2.x

La versión 0.3.0 reemplaza deliberadamente el motor autónomo 0.2.x por el núcleo ligero; no es una actualización compatible ni convierte estructuras anteriores automáticamente.

- El paquete cambia de `project-brain` a `@ruzer/project-brain`.
- El ejecutable `project-brain` y los comandos de análisis, reportes, agentes, swarm y governance se retiran; el único ejecutable es `brain` con `init`, `sync` y `doctor`.
- Los resultados y contextos creados por 0.2.x no se importan. El tag `v0.2.5` conserva esa versión para consulta o recuperación.

Antes de adoptar 0.3.0 en un repositorio existente, confirma o respalda los archivos anteriores, desinstala `project-brain`, instala el tag 0.3.0 o un clon local y ejecuta `brain init` en una rama de trabajo. `init` preserva archivos existentes y se detiene si no puede aplicar el contrato con seguridad.

## Desarrollo

```bash
npm test
npm run check
```

El contrato verificable vive en [`schema/context-contract.schema.json`](schema/context-contract.schema.json).
