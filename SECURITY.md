# Seguridad

Project Brain Lite opera sobre archivos locales, no ejecuta modelos y no transmite el contenido del repositorio.

- Revisa rutas canónicas antes de escribir y rechaza enlaces simbólicos.
- `init` no sobrescribe archivos existentes.
- `sync` realiza una sustitución atómica limitada al bloque generado.
- `doctor` busca patrones comunes de credenciales y datos personales, pero no sustituye un escáner de secretos dedicado.
- CI audita dependencias de producción y desarrollo con umbral alto; Dependabot revisa semanalmente npm y GitHub Actions.

No guardes tokens, contraseñas, llaves privadas ni información restringida en `AGENTS.md` o `AI_CONTEXT/`. Reporta vulnerabilidades mediante un aviso privado de seguridad en GitHub, no mediante un issue público.
