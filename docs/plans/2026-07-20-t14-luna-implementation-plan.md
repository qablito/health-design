# T14 — Adaptador Luna, contrato y presupuesto

## Estado inicial

- Rama: `codex/task-14-luna`
- Base: `c41d914`
- Entorno remoto autorizado: solo `development`
- Producción: no modificar
- Modelo: `gpt-5.6-luna`, razonamiento `none`
- Corte mensual: 10,00 EUR
- Cuota: 10 explicaciones por perfil y día
- Timeout: 8 segundos, sin reintento automático

## Autoridad y seams confirmados

El motor determinista conserva toda la autoridad normativa. Luna solo explica
una versión válida ya persistida y nunca cambia su `output_hash`.

Los seams públicos bajo prueba son:

1. contratos `AIExplanation*` de entrada, salida y fallback;
2. RPC transaccional de reserva, liquidación y reconciliación;
3. `POST /v1/plans/{version_id}/explanation`;
4. activación AAL2 de una revisión de proveedor;
5. cliente y vista web de la explicación.

## Lote 1 — Contrato cerrado

1. Crear pruebas rojas para respuesta válida, slots no permitidos, números o
   entidades nuevas y fallback.
2. Añadir `packages/contracts/src/ai.ts` y exportarlo.
3. Mantener un texto determinista disponible sin proveedor.

Verificación: `pnpm vitest run tests/ai-contract.test.ts`.

## Lote 2 — Presupuesto y revisiones

1. Crear la migración con el CLI.
2. Añadir revisiones de precio/FX y proveedor, explicaciones, meses de
   presupuesto y eventos de uso.
3. Aplicar RLS sin políticas públicas y RPC internos con comprobación de actor.
4. Reservar bajo bloqueo la cota máxima contractual; rechazar cuando el total
   exceda 10,00 EUR o cuando el perfil alcance 10 llamadas diarias.
5. Hacer idempotentes reserva, liquidación, pendiente, liberación y anomalía.

Verificación: `pnpm test:db` y pruebas unitarias del presupuesto.

## Lote 3 — Edge Function y administración

1. Incorporar `explanation.ts` al router `plans`.
2. Comprobar versión normativa válida antes de reservar.
3. Llamar a Responses API con JSON Schema estricto, `store: false`, modelo y
   endpoint de la revisión activa, timeout de 8 segundos y cero reintentos.
4. Validar íntegramente la salida; ante cualquier fallo devolver fallback y
   conservar el estado de gasto correcto.
5. Añadir activación administrativa AAL2 de revisiones preparadas.

Verificación: pruebas Edge de éxito, rechazo, timeout, presupuesto,
idempotencia y AAL1/AAL2.

## Lote 4 — Experiencia web

1. Añadir una acción opcional «Explicar mi plan» a las vistas de resultados.
2. Mostrar claramente si el texto procede de Luna o del fallback.
3. No mostrar configuración, costes internos, payload ni datos clínicos.

Verificación: pruebas de cliente, navegador y E2E.

## Lote 5 — Cierre remoto

1. Ejecutar `pnpm verify`, `pnpm test:e2e`, `pnpm test:db`, supply-chain y
   validación de Worker.
2. Crear copia cifrada precrítica T14 sin eliminar una rotación anterior sin
   autorización explícita.
3. Aplicar migración y desplegar funciones solo en desarrollo.
4. Guardar `OPENAI_API_KEY` únicamente en secretos de desarrollo.
5. Preparar y activar manualmente las revisiones AAL2; ejecutar humo remoto de
   fallback, llamada real, cuota, presupuesto y persistencia.
6. Registrar evidencia y elevar el estado solo con recibo remoto real.

## Paradas obligatorias

- No existe clave API de desarrollo.
- Región, retención, no entrenamiento, precio o FX no pueden documentarse.
- Luna devuelve contenido fuera del contrato.
- Una prueba de dinero, aislamiento, AAL2 o hash falla.
- Cualquier comando apunta a producción.
