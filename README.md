# Project Brain Lite

Project Brain Lite conserva un contexto técnico pequeño y verificable para humanos y agentes externos. Observa el repositorio de forma local y determinista; después de `init`, sólo escribe la proyección delimitada de `CONTEXT.md` y preserva el resto de los cinco archivos canónicos.

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

- `brain init [ruta]`: crea únicamente los cinco archivos que falten y sincroniza la proyección inicial.
- `brain sync [ruta]`: regenera `GeneratedProjection` dentro de sus marcadores y conserva byte por byte `RepositoryOwnedContent`.
- `brain doctor [ruta]`: audita el contrato, los roles, la frescura, los enlaces y posibles riesgos sin escribir. Usa `--json` para automatización.

El escáner usa primero el inventario de Git y respeta `.gitignore`; fuera de Git hace un recorrido local seguro. No llama modelos, servicios cloud ni procesos autónomos, y tampoco ejecuta los comandos candidatos que detecta.

## Modelo de dominio 0.3.1

Este glosario es la definición canónica del producto. Los documentos operativos usan estos términos sin redefinirlos.

**Repository**: Repositorio de software observado localmente y autoridad factual primaria sobre su contenido técnico.

**TechnicalContextBundle**: Agregado exacto de los cinco `ContextArtifact` canónicos; no es un sexto artefacto.

**ContextArtifact**: Uno de los cinco archivos Markdown persistentes del contrato: `AGENTS.md`, `CONTEXT.md`, `DECISIONS.md`, `TASKS.md` o `LEARNINGS.md`.

**GeneratedProjection**: Región delimitada de `CONTEXT.md`, derivada y regenerable, cuya representación puede escribir Project Brain después de `init`.

**RepositoryOwnedContent**: Todos los bytes exteriores a `GeneratedProjection`; pertenecen al repositorio, no se regeneran y deben preservarse aunque procedan originalmente de una plantilla.

**RepositoryObservation**: Resultado determinista de una lectura local del repositorio; es recalculable, pero no es un snapshot transaccional ni un hash de contenido.

**TechnicalSource**: Localizador repository-local de evidencia técnica.

**ObservedFact**: Afirmación sustentada directamente por una `TechnicalSource`.

**Detection**: Inferencia heurística determinista producida por reglas conocidas; no es un hecho observado.

**TechnicalDecision**: Registro humano y no regenerable de una decisión técnica.

**TechnicalTask**: Registro humano y no regenerable de trabajo técnico activo.

**TechnicalLearning**: Registro humano y no regenerable de un hallazgo técnico reutilizable.

**ContextContract**: Reglas de topología, roles, marcadores, ownership y presupuestos editoriales del bundle; no concede autoridad de escritura sobre `RepositoryOwnedContent`.

**DoctorCheckResult**: Resumen efímero y recalculable de una comprobación read-only de `doctor`.

**Diagnostic**: Mensaje derivado que identifica check, severidad, código y ubicación; no es memoria canónica.

**IntegrationReference**: Puntero Markdown repository-owned hacia otra autoridad; no copia contenido, no hace fetching ni transfiere autoridad.

### Ciclo de TechnicalDecision

- propuesta (`proposed`): candidata en discusión y no autoritativa; por sí sola no condiciona el trabajo.
- aceptada (`accepted`): único estado normativo; expresa una elección técnica vigente del repositorio.
- reemplazada (`replaced`): deja de ser normativa y añade una referencia breve a la decisión sucesora aceptada.

El campo `Estado` es un estado técnico documental, no el estado de gestión del proyecto. Project Brain no propone, acepta, migra ni reescribe decisiones; Git conserva el historial detallado.

### Alcance de TechnicalTask

`TechnicalTask` representa actividad técnica local activa; se retira del contexto al concluir y Git conserva el pasado. No es estado persistente de gestión.

La estructura recomendada contiene cuatro campos:

- **Resultado técnico:** cambio observable esperado en el `Repository`, no un milestone de gestión.
- **Siguiente validación:** próxima comprobación candidata; registrarla no implica que fue ejecutada, aprobada o superada.
- **Bloqueos técnicos:** impedimentos técnicos actuales; se usa “Ninguno” cuando no existen.
- **Referencia opcional:** puntero al registro de gestión correspondiente, si existe.

Project Memory Hub es una integración opcional y conserva la autoridad sobre owners, fechas, riesgos, milestones y estado de gestión. Si no existe, la referencia se omite; nunca se copian esos valores a `TechnicalTask`.

### Alcance de TechnicalLearning

`TechnicalLearning` es conocimiento técnico humano, confirmado y repository-owned; no es normativo. Una hipótesis sin evidencia no es un `TechnicalLearning` y no debe presentarse como conocimiento confirmado.

La estructura recomendada registra:

- **Evidencia:** localizador técnico identificable dentro del `Repository`; por ejemplo, `src/scanner.mjs` es evidencia repository-local cuando sustenta directamente el hallazgo.
- **Aplicación:** cuándo y cómo puede reutilizarse el conocimiento.
- **Límite:** condiciones en las que el hallazgo deja de aplicar, para no convertirlo en una verdad universal.

Si el aprendizaje cambia una regla normativa, referencia una `TechnicalDecision` aceptada; la decisión, no el aprendizaje, conserva la autoridad normativa. Owners, fechas de entrega, riesgos, milestones y estado de gestión permanecen fuera de `TechnicalLearning`.

### Alcance de TechnicalSource

`TechnicalSource` es un localizador repository-local que identifica una ubicación verificable dentro del `Repository`; no es una afirmación. `ObservedFact` es una afirmación directamente sustentada por una o más fuentes repository-local. `Detection` sigue siendo una inferencia heurística determinista producida por reglas conocidas.

Citar una fuente no convierte una `Detection` en `ObservedFact` ni demuestra conclusiones que la evidencia no sustenta directamente.

- **Válido:** `package.json` localiza la evidencia de que ese archivo declara `engines.node`.
- **Inválidos:** `Node.js` sin localizador no identifica evidencia; `npm test` es un comando candidato, no una fuente.
- **Frontera de gestión:** Project Memory Hub conserva datos de gestión y no es un `TechnicalSource` de Project Brain.

`TechnicalSource` no representa owners, fechas, riesgos, milestones ni estado de gestión. Una referencia externa es una `IntegrationReference`, no transfiere autoridad y no provoca acceso de red.

### Convención de IntegrationReference

`IntegrationReference` es una convención opcional en Markdown para declarar un puntero desde `RepositoryOwnedContent` hacia otra autoridad. Sus cuatro campos obligatorios y no vacíos son:

- **system:** nombre estable del sistema al que pertenece el registro destino; no es un conector.
- **destination:** localizador portable del registro; es dato, no una instrucción de navegación.
- **provenance:** ubicación repository-owned desde la que se declara la referencia.
- **authority:** declaración explícita de quién conserva autoridad sobre cada clase de información, independientemente del `system` que hospeda el destino.

Una instancia opt-in comienza con un encabezado ATX cuyo texto exacto es `IntegrationReference`; menciones, enlaces y texto inline ordinarios no declaran una instancia.

#### Brain → Memory Hub

##### IntegrationReference

- **system:** `Project Memory Hub`
- **destination:** `memory-hub:project-brain`
- **provenance:** `AI_CONTEXT/TASKS.md#validar-contexto`
- **authority:** Project Memory Hub para owners, fechas, riesgos, milestones y estado de gestión.

#### Memory Hub → Brain

##### IntegrationReference

- **system:** `Project Brain Lite`
- **destination:** `project-brain:AI_CONTEXT/CONTEXT.md`
- **provenance:** `projects/project-brain/memory/SOURCES.md#contexto-tecnico`
- **authority:** el `Repository` para hechos técnicos y Project Brain únicamente para representar `GeneratedProjection`.

La referencia no copia información canónica entre sistemas. La convención no implementa conectores, fetching ni sincronización. `doctor` sólo reconoce la declaración explícita y advierte cuando falta o está vacío alguno de sus cuatro campos mínimos; no interpreta el destino ni comprueba su contenido. No crea un sexto artefacto canónico ni se incorpora al esquema. Los destinos remotos nunca son consultados automáticamente; las rutas relativas normales dentro del repositorio siguen bajo la auditoría de `doctor`.

## Matriz de autoridad

Project Brain es autoridad de escritura únicamente sobre `GeneratedProjection`; no sustituye la autoridad factual del `Repository`.

| Información | Autoridad del dato | Autoridad de escritura | Regeneración |
| --- | --- | --- | --- |
| Contenido técnico y evidencia | `Repository` | Repositorio y sus autores | Project Brain no lo regenera |
| `GeneratedProjection` | Datos del `Repository`; representación de Project Brain | Project Brain mediante `sync` | Sí |
| `RepositoryOwnedContent` —incluidas decisiones, tareas, aprendizajes y referencias— | `Repository` | Repositorio y sus autores | No |
| Owners, fechas, riesgos, milestones y estado de gestión | Project Memory Hub, cuando se usa | Project Memory Hub | Según el Hub |
| Historial detallado | Git | Git | Consultable desde Git |
| Observaciones, resultados de checks y diagnósticos | Evidencia del `Repository` y reglas de Project Brain | No son estado persistente | Se recalculan |

Project Memory Hub conserva la autoridad sobre owners, fechas, riesgos, milestones y estado de gestión. Git conserva la autoridad sobre el historial detallado.

## No-equivalencias

```text
fingerprint != content hash
doctor OK != context fresh
detected command != executed command
```

- El fingerprint resume el inventario mediante ruta y tamaño; no prueba igualdad del contenido.
- `doctor` puede terminar correctamente y comunicar warnings, incluida una proyección desactualizada.
- Un comando candidato detectado no fue ejecutado, aprobado ni validado por Project Brain.

## Herramientas complementarias

- **Graphify:** deriva relaciones y grafos. Mantén su salida reconstruible en `graphify-out/`.
- **Obsidian:** permite navegar y editar los mismos archivos Markdown sin transferir ownership.
- **Git:** conserva el pasado; el contexto activo no duplica una bitácora.

Cuando Project Brain y Project Memory Hub conviven, funcionan como repositorios hermanos e independientes. Una `IntegrationReference` puede relacionar sus fuentes canónicas sin copiar ni sincronizar registros, y sus respectivos archivos `AI_CONTEXT` no se fusionan.

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
