# Verificación de la Tarea 1

> **Fecha:** 2026-07-17  
> **Estado:** `T1_IMPLEMENTED_LOCAL_PASS_WITH_EXTERNAL_GATES_PENDING`  
> **Alcance:** fundación del monorepo y contrato compartido entre runtimes; no demuestra funcionalidad de producto.

## Resultado entregado

- Workspace pnpm con versiones exactas, un único `pnpm-lock.yaml`, Node 24.18.0
  fijado como runtime de CI y TypeScript estricto.
- `packages/contracts` como fuente canónica del schema Zod cerrado y de su tipo
  inferido.
- Consumo del contrato desde Node de pruebas, la aplicación React y una
  Supabase Edge Function.
- Bundle ESM Edge generado automáticamente dentro del árbol desplegable, con
  declaración de tipos también generada. `pnpm edge:check` bloquea un bundle
  ausente o desactualizado; no existe una copia manual del contrato.
- Prueba separada en Chromium real mediante Vitest Browser y Playwright.
- Función Edge sin secretos ni efectos, con JWT obligatorio, método y tipo de
  contenido restringidos, schema estricto y límite de 1 KiB aplicado durante la
  lectura del stream.
- CI con acciones externas fijadas por SHA, checkout sin credenciales
  persistentes y jobs separados para calidad, Edge y cadena de suministro.
- SCA bloqueante para vulnerabilidades altas, SBOM CycloneDX 1.6, manifest de
  hashes y puerta de tag preparada para crear y volver a verificar attestations
  separadas de procedencia SLSA y SBOM antes de subir el artefacto.
- Detector bloqueante de los patrones y artefactos privados definidos para V1
  en worktree e historial: credenciales conocidas, claves, certificados,
  `.env`, dumps, backups, restores y copias. No se presenta como un detector
  universal de cualquier secreto posible.

## Comprobaciones RED observadas

1. La instalación congelada falló con `ERR_PNPM_OUTDATED_LOCKFILE` al añadir las
   dependencias de browser y generación Edge antes de actualizar el lockfile.
2. La primera ejecución de navegador falló porque Chromium todavía no estaba
   instalado; después se instaló el binario fijado por Playwright.
3. La prueba de política CI devolvió once hallazgos antes de añadir calidad en
   release, escaneo posterior al build, checkout endurecido y verificación de
   attestations.
4. La primera prueba HTTP sobredimensionada devolvió `503`: cancelar el body
   entrante abortaba también la respuesta en Deno. Se sustituyó la cancelación
   por liberación del reader; el test unitario y el runtime real pasan ahora con
   `413` sin seguir consumiendo el stream.
5. El primer parser de `content-type` aceptaba
   `text/application/json-ish`; la regresión falló con `200` antes de exigir el
   media type exacto y ahora pasa con `415`.
6. El scanner de política ignoraba dos workflows antiguos con sufijo ` 2`.
   Ambos se eliminaron y una fixture `legacy.yml` demuestra que cualquier
   workflow activo no canónico bloquea la puerta.
7. Supabase CLI `2.109.0` y `2.109.1` terminaban `functions serve` antes de
   arrancar con `failed to determine entrypoint`. La comparación A/B mantuvo
   código, configuración, Docker y Colima constantes: `2.108.0` mantuvo el
   proceso activo y superó el smoke HTTP completo. La CLI queda fijada en esa
   última versión verificada.

## Evidencia local verde

| Comprobación | Resultado |
| --- | --- |
| Node ejecutor de la repetición final | PASS; `v24.18.0` |
| `pnpm install --frozen-lockfile` | PASS bajo Node 24.18.0 y pnpm 11.13.1 |
| `pnpm edge:check` | PASS; JS y declaración generados coinciden con la fuente |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS; 2 archivos y 14 tests |
| `pnpm test:browser` | PASS; 1 test en Chromium real |
| `pnpm build` | PASS; 95 módulos transformados |
| `pnpm test:supply-chain` | PASS; worktree completo y ruta pre-commit sin historial validados |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas en la consulta final |
| `pnpm supply-chain:artifacts` | PASS; 219 componentes y 3 artefactos verificados |
| `pnpm verify` completo | PASS bajo Node 24.18.0 |
| YAML de ambos workflows | PASS; parseo local |
| HTTP Edge con payload canónico | PASS; `200` y respuesta exacta |
| HTTP Edge sin token | PASS; `401` con JWT obligatorio |
| HTTP Edge con campo adicional | PASS; `400 invalid_runtime_smoke_payload` |
| HTTP Edge con payload superior a 1 KiB | PASS; `413 payload_too_large` |
| `pnpm exec supabase functions serve runtime-smoke` | PASS; proceso activo con CLI `2.108.0` |
| Attestations de GitHub | Configuradas, no ejecutadas localmente |

La prueba HTTP Edge se ejecutó contra
`pnpm exec supabase functions serve runtime-smoke` con JWT habilitado y la clave
`anon` local obtenida internamente por el script, sin imprimirla. Para arrancar
el resto del stack en Colima se excluyó `vector`, porque su montaje del socket
de Docker no es compatible con esta instalación; esto no cambia el código ni la
configuración desplegable ni interviene en Edge Functions.

Secuencia reproducible en este Mac con Colima:

```bash
pnpm exec supabase start -x vector
pnpm exec supabase functions serve runtime-smoke
# En otra terminal:
EDGE_SMOKE_USE_LOCAL_ANON=true pnpm edge:smoke
# Detener functions serve con Ctrl+C y después:
pnpm exec supabase stop --no-backup
```

Los runners de CI usan Docker con su socket estándar y arrancan el stack
completo; la exclusión local de `vector` no se aplica allí.

Durante la verificación previa al commit inicial, el detector declaró
`not-applicable:repository-has-no-commits` únicamente después de confirmar que
el recuento era cero. Un fallo de Git distinto se convierte en hallazgo
bloqueante; a partir del primer commit examina nombres y parches de todo el
historial.

## Regresión local resuelta

La incidencia se reprodujo con la función del proyecto y con una función mínima
generada por la propia CLI. `2.108.0` sirve el mismo entrypoint y supera `401`,
`200`, `400` y `413`; `2.109.0` y `2.109.1` fallan durante el bootstrap. Se fija
`2.108.0` de forma exacta en `package.json` y `pnpm-lock.yaml` hasta que una
versión estable posterior demuestre la misma matriz verde. El job CI conserva
la comprobación independiente de que el proceso siga vivo antes de ejecutar el
smoke HTTP. La secuencia sigue la
[guía oficial de Supabase](https://supabase.com/docs/guides/functions/quickstart).

## Puerta externa de release

Un tag `v*` solo puede llegar al upload cuando pasan:

1. instalación congelada, detector de patrones privados e historial y SCA;
2. calidad completa, incluida la prueba de Chromium;
3. `supabase functions serve` y smoke HTTP Edge;
4. job `quality` sobre el commit exacto del tag, incluido `pnpm verify` y
   Chromium real;
5. build y nuevo escaneo del `dist` ya generado;
6. SBOM y hashes locales;
7. firma OIDC de procedencia SLSA y SBOM CycloneDX;
8. `gh attestation verify` de ambos predicados, repositorio, identidad y commit
   del workflow firmante, commit fuente y ref;
9. upload del bundle.

GitHub documenta que `actions/attest` crea una procedencia SLSA por defecto y
usa el modo SBOM al recibir `sbom-path`; las firmas se generan con certificados
de corta duración de Sigstore y se verifican con GitHub CLI:
[documentación oficial de `actions/attest`](https://github.com/actions/attest).

Esta sesión no ha ejecutado GitHub Actions ni ha creado un tag, por lo que la
attestation no se presenta como verificada todavía. Si el repositorio es
privado y el plan de GitHub no admite attestations, el release fallará de forma
intencionada y no publicará un artefacto sin procedencia verificable.

## Límite conocido del cuerpo en streaming

El handler rechaza al superar 1 KiB y no solicita un segundo chunk después de
detectarlo. Web Streams entrega cada chunk ya materializado, por lo que un
primer chunk de transporte podría ser mayor que ese umbral antes de que el
handler pueda medirlo. El límite de gateway/proxy que completa la defensa en
profundidad se configurará al desplegar el backend en la Tarea 2; no se atribuye
al handler una garantía de memoria absoluta.
