# context bootstrap master prompt

Actua como analista tecnico del repositorio actual.
Inspecciona el proyecto real y crea o actualiza `AI_CONTEXT/` para que otros agentes AI puedan trabajar aqui sin inventar arquitectura, flujos, reglas ni contratos.

## Objetivo

Construir un contexto operativo, breve y confiable del proyecto real.

## Alcance minimo

Antes de escribir, inspecciona al menos:

- `README*`
- `package.json`, lockfiles y scripts
- estructura de `src/`, `app/`, `pages/`, `components/`, `lib/`, `api/`
- configuracion relevante (`env`, auth, db, build, CI)
- migraciones, schemas, seeds, contratos, tests y docs existentes
- `docs/`, `app/docs/` y documentos raiz como `API.md`, `ARCHITECTURE.md`, `BUSINESS_RULES.md`, `FLOWS.md`

## Reglas

1. No inventes nada.
   Si algo no esta confirmado en codigo o docs, marcalo como `Pendiente de confirmar`.

2. Si hay contradiccion entre docs y codigo:
   Prioriza codigo/runtime/schema vigentes y documenta la contradiccion.

3. Usa rutas reales del repositorio.

4. Cada hallazgo importante debe incluir evidencia breve:
   `Evidencia: ruta[:linea]`

5. Distingue claramente:
   - estado actual confirmado
   - pendiente de confirmar
   - docs `Draft`, `Spec`, `Legacy`, `Reference`

6. Si ya existe `AI_CONTEXT/`:
   - actualiza solo lo necesario
   - no borres notas manuales fuera de bloques generados
   - conserva decisiones y learnings manuales si no fueron invalidados por evidencia nueva

7. No propongas refactors imaginarios.
   `TASKS.md` debe salir de evidencia real del repo.

## Archivos a crear o actualizar

- `AI_CONTEXT/system_overview.md`
- `AI_CONTEXT/domain_inventory.md`
- `AI_CONTEXT/modules_map.md`
- `AI_CONTEXT/frontend_architecture.md`
- `AI_CONTEXT/backend_flows_and_contracts.md`
- `AI_CONTEXT/ui_rules.md`
- `AI_CONTEXT/DECISIONS.md`
- `AI_CONTEXT/LEARNINGS.md`
- `AI_CONTEXT/TASKS.md`

## Contenido esperado

### `system_overview.md`

- objetivo del sistema
- actores principales
- arquitectura operativa actual
- stack principal
- persistencia y fuente de verdad
- restricciones permanentes
- fuentes canonicias o fuentes de referencia si estan explicitadas

### `domain_inventory.md`

- dominios funcionales activos
- docs asociadas
- superficies reales de codigo por dominio
- dominios documentados sin superficie confirmada

### `modules_map.md`

- mapa de modulos funcionales
- rutas clave
- panel admin/backoffice si existe
- relacion entre modulos y datos
- activo vs legacy/fallback

### `frontend_architecture.md`

- layouts, paginas y componentes principales
- rendering strategy
- estado y data fetching
- i18n si existe
- dependencias UI
- reglas de navegacion y shells visibles

### `backend_flows_and_contracts.md`

- endpoints reales
- auth/authz
- validaciones
- acceso a DB
- jobs, webhooks o integraciones
- contratos vigentes
- fuentes canonicas declaradas si existen

### `ui_rules.md`

- direccion visual activa
- componentes base a respetar
- responsive, accesibilidad y copy
- patrones que no deben degradarse

### `DECISIONS.md`

- decisiones vigentes confirmadas
- por que existen si esta explicitado
- contradicciones o ambiguedades importantes

### `LEARNINGS.md`

- descubrimientos relevantes
- errores ya detectados
- trampas recurrentes
- cosas que futuros agentes no deben romper

### `TASKS.md`

- pendientes concretos
- prioridad
- contexto minimo
- criterio de cierre
- bloqueos si existen

## Estilo de salida

- usa bullets cortos
- se concreto, tecnico y breve
- evita teoria general
- evita relleno
- si faltan archivos, crealos con contenido inicial util

## Entrega final

1. Crea o actualiza los archivos.
2. Resume en 10-15 lineas el estado real del proyecto.
3. Lista supuestos, huecos o zonas que requieren confirmacion manual.
