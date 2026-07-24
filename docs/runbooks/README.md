# Contrato de runbooks de V1

**Estado:** contrato general; `local-development.md`, `nutrition-import.md`,
`exercise-assets.md`, `commercial-product-publication.md` y
`catalog-publication.md`, [`backup-restore.md`](./backup-restore.md),
[`permanent-deletion.md`](./permanent-deletion.md),
[`anonymous-auth-cleanup.md`](./anonymous-auth-cleanup.md) y
[`audit-retention-deletion.md`](./audit-retention-deletion.md) ya contienen
procedimientos ejecutables. Los cuatro runbooks T18 están validados con
fixtures locales; su activación remota Development permanece pendiente de
autorizaciones independientes.
**Fuente:** [`OPERATIONS.md`](../operations/OPERATIONS.md) y
[`plan de implementación`](../plans/2026-07-16-v1-implementation-plan.md).

Los runbooks deben escribirse junto a la capacidad real que operan. No se
rellenan ahora con comandos, nombres de proyecto o salidas inventadas: hacerlo
crearía una falsa sensación de preparación. Este documento fija cuáles son
obligatorios, qué deben contener y cuándo se consideran verificados.

## Runbooks obligatorios

| Archivo futuro | Capacidad | Tarea que lo entrega |
|---|---|---|
| `local-development.md` | arranque, reset, seed, funciones, frontend y cierre local | T2 |
| `nutrition-import.md` | cuarentena, manifest, CIQUAL 2025, validación, diff, aprobación y reanudación nutricional | T9–T10 |
| [`exercise-assets.md`](./exercise-assets.md) | alta, licencia, revisión anatómica, accesibilidad y retirada de activos | T11 |
| [`commercial-product-publication.md`](./commercial-product-publication.md) | ficha nutricional comercial, confirmación privada, revisión global, matching y aplicación a candidato | T16 |
| [`catalog-publication.md`](./catalog-publication.md) | SKU/cadena/precio, cobertura 60+20, publicación y ocultación | T17 |
| [`backup-restore.md`](./backup-restore.md) | backup semanal/precrítico, cuatro rotaciones y restore aislado | T18 |
| [`permanent-deletion.md`](./permanent-deletion.md) | solicitud, tombstone, purga reanudable, alias y verificación | T18 |
| [`anonymous-auth-cleanup.md`](./anonymous-auth-cleanup.md) | dry-run, selección por lotes, exclusiones y eliminación Auth | T4/T18 |
| [`audit-retention-deletion.md`](./audit-retention-deletion.md) | borrado excepcional de rangos `admin-audit` con recibos y credencial JIT | T18 |

## Estructura mínima de cada runbook

1. objetivo, alcance y acciones que quedan expresamente fuera;
2. entorno permitido y prohibiciones de ejecutar contra otro entorno;
3. rol, AAL y aprobaciones necesarias;
4. precondiciones, versiones y secretos requeridos sin revelar valores;
5. comando o secuencia exacta, con modo `dry-run` cuando la acción sea
   destructiva;
6. salida esperada y criterios objetivos para continuar;
7. idempotencia, reanudación y comportamiento ante fallo parcial;
8. rollback o, si no existe, explicación explícita de irreversibilidad;
9. validación posterior, métricas, alertas y evidencias que se archivan;
10. propietario, fecha de última revisión y fecha/resultado del último
    simulacro.

## Reglas de seguridad documental

- Nunca incluir secretos, tokens, peppers, claves privadas, datos reales,
  aliases, dumps o URLs con capabilities.
- Los ejemplos usan exclusivamente IDs y perfiles sintéticos.
- Una instrucción destructiva exige identificación del entorno, `dry-run`,
  doble confirmación y condición de parada.
- El runbook de restore carga primero `deletions` y las exclusiones de rangos
  de auditoría; no permite promover una copia con intents o borrados
  pendientes.
- El runbook de borrado de auditoría no reutiliza credenciales normales de la
  aplicación: documenta activación JIT, alcance exacto y revocación.
- Los comandos se copian desde scripts versionados; no se mantienen dos
  implementaciones manuales divergentes.

## Puerta de aceptación

Un runbook no está aprobado por existir el archivo. Debe ensayarse en un
entorno aislado con datos sintéticos y adjuntar:

- commit y artefacto;
- operador y timestamp;
- entradas/versiones;
- log redactado y hashes/manifiestos;
- resultado `PASS` o defecto enlazado;
- duración real frente al RPO/RTO cuando aplique.

G7 no puede aprobarse sin simulacro de backup/restore, borrado de perfil,
reconciliación de auditoría, borrado parcial de rango y cleanup Auth. Los
runbooks de ingesta/publicación forman parte de G6.
