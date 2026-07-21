# Publicación de productos comerciales T16

**Estado:** procedimiento implementado y validado localmente; simulacro remoto pendiente.
**Entorno permitido:** exclusivamente `health-design-dev` (`nwoivdxdupklervtnovd`).
**Producción:** prohibida hasta una autorización posterior y explícita.
**Propietario:** superadministrador.
**Última revisión:** 2026-07-21.

## 1. Objetivo y fronteras

Este runbook cubre la resolución de un GTIN, la confirmación privada de una
etiqueta, la revisión administrativa, la creación de una revisión global, la
activación independiente del matching y la aplicación a un candidato de plan.

Una ficha nutricional comercial T16 no es un SKU de compra T17: no contiene
cadena, precio, disponibilidad, oferta ni transporte. Un SKU nunca modifica
kcal, macros, fibra o nutrientes del plan. Open Food Facts es una fuente bajo
demanda, no publica directamente y puede devolver una ficha provisional o no
disponible.

No se guardan fotografías ni fotogramas. La cámara se procesa en el navegador;
la entrada manual permanece disponible. Luna no extrae, completa ni aprueba
datos de etiqueta.

## 2. Autoridad y estados

La resolución sigue esta precedencia cerrada:

1. confirmación del perfil;
2. revisión global aprobada;
3. etiqueta confirmada;
4. Open Food Facts;
5. ficha manual vacía.

`unknown` nunca equivale a cero. Una confirmación crea una revisión inmutable y,
si difiere de la base, una corrección privada `pending`. El superadministrador
puede corregir esa propuesta mediante otra revisión, aprobarla o rechazarla con
motivo cerrado. Aprobar crea una revisión `global_approved` y una regla de
matching `draft`; compartir la ficha y activar el matching son acciones
distintas. Solo hay una regla activa por GTIN.

Aplicar una confirmación crea `PlanVersion:draft` y `PlanCandidate:pending`.
La versión activa no cambia hasta una activación manual posterior.

## 3. Precondiciones y parada segura

- Rama y commit exactos identificados; `CI=true pnpm verify` y `pnpm test:db`
  deben pasar.
- La migración remota se compara antes de aplicar.
- Existe una copia cifrada precrítica nueva, montada en solo lectura y con hashes
  verificados; la rotación conserva exactamente cuatro versiones.
- `catalogs`, `plans`, `admin` y `admin-reconciler` apuntan a desarrollo.
- `OPEN_FOOD_FACTS_USER_AGENT` identifica la aplicación y un contacto válido;
  no se registra el body externo.
- Se preparan dos perfiles sintéticos distintos, un plan activo sintético para
  el segundo y una sesión de superadministrador AAL2 con TOTP de menos de cinco
  minutos.
- El GTIN de prueba no pertenece a un producto real usado por invitados.

Parar sin aplicar ni desplegar si falta una condición, el proyecto enlazado no
es `nwoivdxdupklervtnovd`, la copia no verifica, el token no es AAL2 reciente o
se observa cualquier referencia de producción.

## 4. Secuencia de activación en desarrollo

1. Crear y verificar la copia precrítica según el runbook de continuidad.
2. Revisar `supabase migration list --linked` y ejecutar primero un dry-run.
3. Aplicar las cinco migraciones T16 en orden:
   `20260721084023`, `20260721114021`, `20260721143000`, `20260721154500` y
   `20260721160000`. Las dos últimas sincronizan de forma aditiva los guards de
   concurrencia y el acceso verificado, sin borrar datos.
4. Desplegar `catalogs`, `plans`, `admin` y `admin-reconciler` con verificación
   JWT; no desplegar una función nueva en producción.
5. Renovar el TOTP administrativo y exportar los secretos requeridos solo en la
   sesión actual. Nunca escribirlos en `.env`, shell history, Markdown o logs.
6. Ejecutar `pnpm test:t16:remote` con las confirmaciones literales del script.
7. Abrir el candidato sintético devuelto, revisar cantidad, kcal/macros/fibra,
   dos sustituciones e incertidumbres; activarlo manualmente desde la UI.
8. Descargar PDF compacto y XLSX de la versión activada y comprobar que muestran
   nombre/marca y procedencia de cálculo, pero no `profile_id`,
   `confirmation_id`, `product_id`, `revision_id`, GTIN privado ni evidencia.
9. Borrar el perfil sintético A por el flujo permanente cuando T18 esté activo;
   comprobar que su confirmación/corrección privada desaparece y que la revisión
   global anonimizada continúa resolviéndose para B.
10. Reconciliar y comprobar los pares `intent/outcome` de corregir, aprobar,
    rechazar —si se prueba— y activar matching.

Variables exigidas por el smoke:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
T16_REMOTE_CONFIRM=health-design-dev:t16-commercial-products
T16_REMOTE_MUTATION_CONFIRM=I_ACCEPT_SYNTHETIC_T16_MUTATIONS
T16_PROFILE_A_ID / T16_PROFILE_A_TOKEN
T16_PROFILE_B_ID / T16_PROFILE_B_TOKEN
T16_ADMIN_AAL2_TOKEN
T16_PLAN_ID / T16_BASE_VERSION_ID / T16_PLAN_AGGREGATE_VERSION
T16_CANONICAL_FOOD_KEY
T16_DAY_INDEX / T16_MEAL_INDEX / T16_FOOD_INDEX
T16_TEST_GTIN / T16_TEST_SYMBOLOGY
```

El script falla cerrado si falta una variable, si URL o confirmación no señalan
desarrollo, si los perfiles coinciden, si el token admin no declara AAL2+TOTP o
si no se conserva la versión activa al crear el candidato.

## 5. Resultado esperado

- Anónimo rechazado y AAL1 administrativo rechazado.
- AAL2 reciente acepta cola/detalle y mutaciones.
- Confirmación idéntica es idempotente; la misma clave con otro cuerpo devuelve
  conflicto.
- B no resuelve la propuesta privada de A.
- La aprobación crea una revisión global inmutable y matching `draft`; la
  activación explícita deja una sola regla activa.
- B recibe la revisión global, la confirma y crea un candidato sin reemplazar el
  plan activo.
- El ledger técnico tiene `intent/outcome` y hashes anterior/nuevo, nunca
  snapshots, GTIN, cuerpo, token o perfil en claro.

## 6. Fallo parcial, reanudación y rollback

Las confirmaciones y mutaciones administrativas usan claves idempotentes. Ante
timeout no se repite con otra clave: se consulta primero la revisión, la cola y
el journal. Un `intent` sin `outcome` se entrega al reconciliador antes de seguir.

No se edita ni borra una revisión publicada para “revertir”. Se retira o
supersede mediante una revisión posterior; el histórico de planes conserva la
revisión usada. Una regla de matching incorrecta se sustituye o retira con una
nueva acción auditada. Si falla el candidato, el plan activo permanece intacto.

## 7. Evidencia a archivar

- commit, migraciones y versiones de funciones;
- hash y verificación de la copia cifrada;
- salida redactada `T16_REMOTE_SMOKE_CORE_PASS`;
- IDs sintéticos opacos de candidato/corrección/matching;
- capturas de revisión y activación manual, PDF/XLSX sintéticos;
- recuento de residuos y pares `intent/outcome`;
- confirmación de que producción no recibió migración ni despliegue.

El runbook solo pasa a “simulacro remoto PASS” cuando toda esta evidencia está
registrada en `TASK_16_VERIFICATION.md`.
