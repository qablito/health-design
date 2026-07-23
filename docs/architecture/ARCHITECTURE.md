# Arquitectura de V1

**Estado:** contrato de diseño, no implementación  
**Versión del documento:** 1.0  
**Fecha:** 2026-07-16  
**Fuente funcional:** [`PRODUCT.md`](../../PRODUCT.md)

## 1. Propósito y límites

V1 es una PWA web privada, España-first, para adultos de 18 años o más. La
aplicación recoge contexto breve, calcula y muestra planes de nutrición,
entrenamiento opcional, hidratación, sueño/descanso, movilidad y
suplementación, y ofrece seguimiento, compra consultiva y exportación.

Este documento fija fronteras técnicas. No autoriza todavía código, despliegue,
integraciones de salud, compra en línea, actualización diaria de catálogos ni
un verificador farmacológico exhaustivo. La información clínica no se
diagnostica ni se usa para modificar tratamientos.

## 2. Forma del sistema

```text
Navegador (React + TypeScript + Vite PWA)
        │ HTTPS, sesión y RLS
        ▼
Supabase EU
  ├─ Auth / sesión de dispositivo
  ├─ Postgres / perfiles, contextos, planes, catálogo y auditoría
  ├─ Edge Functions / operaciones privilegiadas y reglas server-side
  └─ Storage / exportaciones y activos de ejercicios

Cloudflare Worker + Durable Object + R2 privado
  └─ ledger de continuidad de borrados y auditoría privilegiada,
     serializado e independiente de los dumps Supabase

Proveedor Luna (solo postvalidación)
        ▲ JSON estructurado sin autoridad numérica

Catálogos curados / fuentes externas importadas manualmente
```

Cloudflare Pages sirve los activos estáticos de la PWA. No se exponen secretos
en el navegador. Las operaciones que requieren privilegio, importación,
impersonación, activación manual, copias o borrado permanente pasan por una
Edge Function o una operación equivalente protegida por RLS y rol.

## 3. Identidad y sesión elegidas

Cada dispositivo usa una identidad independiente de Supabase Auth. En el
navegador, el cliente oficial conserva access/refresh tokens y envía el JWT
como Bearer sobre HTTPS. Como V1 es una SPA y no una aplicación tradicional
renderizada íntegramente en servidor, no se asume una cookie `HttpOnly`.

El JWT autentica al dispositivo, pero la autorización del perfil exige una
membresía `ProfileAccess` activa. El código privado o el QR no copian una
sesión: conceden una membresía a la identidad nueva. Revocar la membresía
impide el acceso por RLS aunque el JWT no haya expirado todavía.

Una identidad de dispositivo puede conservar membresías de varios perfiles.
La revocación ordinaria es por perfil y no invalida las demás; la sesión Auth
solo se elimina cuando se solicita un cierre global o la identidad queda
huérfana. Una identidad Auth representa un dispositivo lógico y tiene una
`DeviceSession` activa; las pestañas comparten esa identidad. El cierre o
vencimiento global revoca todas sus membresías y todos los refresh tokens de
esa identidad, mientras un JWT residual queda denegado por RLS. El TTL 30/180
se implementa en tablas/policies propias y no depende de una función de pago de
Supabase.

Las identidades anónimas sin invitación o membresía no tienen acceso a datos.
Su creación y los intercambios de código/QR se protegen frente a abuso según
[`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md).

## 4. Fronteras y responsabilidades

### Cliente PWA

- Presenta el asistente por pasos, progreso, tiempo estimado y autoguardado.
- Valida formato localmente, pero nunca decide seguridad, dosis, límites ni
  resultado nutricional.
- Muestra solo el plan activo o un candidato explícitamente identificado.
- Solicita confirmación obligatoria de datos de código de barras.
- Envía comandos idempotentes; el estado remoto es la fuente de sincronización.
  Una edición aún no confirmada puede mantenerse temporalmente en memoria para
  reintentar, pero V1 no persiste respuestas de salud en `localStorage`,
  `IndexedDB`, Cache API ni URLs.
- El service worker solo cachea assets públicos, inmutables y versionados.
  Nunca intercepta ni almacena respuestas de perfil, cuestionario, plan,
  seguimiento, administración o exportación.
- Logout, revocación y borrado eliminan memoria de aplicación y caches
  controladas; la sesión técnica de Auth se gestiona aparte por el cliente
  oficial.

### API/Edge Functions

- Comprueba sesión, alcance del perfil, rol y versión de contrato.
- Normaliza entradas y llama al motor determinista versionado.
- Aplica reglas farmacológicas, clínicas, de catálogo y de publicación.
- Calcula impacto, crea candidatos y nunca sustituye silenciosamente el plan
  activo.
- Ejecuta operaciones privilegiadas de superadministrador y escribe el registro
  técnico privado.
- Registra en el ledger externo un `intent` antes de cualquier mutación
  privilegiada y finaliza su `outcome` mediante outbox idempotente.
- Registra el tombstone externo antes de completar una purga y exige los
  streams de borrado y auditoría antes de promover un restore.
- Aísla llamadas al proveedor Luna y valida la respuesta antes de persistirla.

### Motor determinista

Es la única autoridad para cálculos, restricciones, compatibilidad,
reconciliación de módulos, cantidades, kcal, macros, fibra, hidratación,
impacto, estados y nivel de acción. Debe ser una librería pura y versionada,
invocable en tests sin red ni LLM. Sus entradas y salidas se registran como
artefactos reproducibles.

### Supabase/Postgres

- Mantiene datos relacionales, versiones inmutables y relaciones de pertenencia.
- RLS limita toda fila de usuario al perfil autorizado mediante una membresía
  activa; el cliente no puede escribir roles ni membresías.
- El superadministrador no usa `service_role` desde el navegador. Las
  operaciones completas pasan por Edge Functions que validan cuenta separada,
  AAL2, actor original y perfil efectivo, y después auditan la acción.
- Constraints impiden estados imposibles, activaciones sin validación o
  referencias a versiones eliminadas.

### Luna

Solo recibe un paquete mínimo ya validado y sin necesidad de datos personales
innecesarios. Puede devolver explicaciones, resúmenes, instrucciones breves y
traducciones de tecnicismos. No puede alterar números, alimentos, ejercicios,
dosis, límites, advertencias, nivel de acción, estado clínico ni activar un
candidato. Si falla, se muestran textos deterministas predefinidos.

Permanece deshabilitado hasta activar una revisión de proveedor que documente
región, retención, no entrenamiento, endpoint, precio, timeout y minimización.
El servidor conserva versiones y hashes de prompt, nunca el prompt ni el
payload clínico completos.

## 5. Flujos principales

### Creación de plan

1. Se crea o reanuda un borrador de contexto.
2. El cliente guarda cada respuesta con `idempotency_key`.
3. La API normaliza unidades, alias, fechas y selecciones.
4. El motor calcula dependencias, restricciones y módulos solicitados.
5. Se ejecutan validaciones normativas de entrada, módulo, restricciones,
   coherencia y activabilidad. Las ocho puertas de salida son criterios de
   lanzamiento del producto, no funciones ejecutadas dentro de cada plan.
6. Se crea un plan versionado `complete` o `provisional` en estado `draft`.
7. En la primera generación, el usuario activa esa versión borrador. En una
   regeneración, se crea además un candidato que enlaza versión base y versión
   candidata; al confirmarlo, la candidata pasa a `active` y la anterior a
   `archived`.

### Cambio durante seguimiento

1. Se registra el dato nuevo con vigencia y origen.
2. El detector identifica módulos afectados y dependencias.
3. Se calcula un candidato separado.
4. Cambios estructurales requieren activación manual; ajustes menores pueden
   presentarse como propuesta, nunca mutar el activo sin confirmación.

### Compra consultiva

El plan activo fija alimento y cantidad nutricional. El catálogo de
supermercado solo resuelve SKU, formato, precio base y envases/retales. La
presencia en catálogo no acredita stock. La elección de supermercado habitual prevalece; el ahorro
multitienda es opcional y se presenta como aviso.

## 6. Entornos y configuración

- `development`: datos sintéticos, proyecto Supabase separado, sin perfiles
  reales ni invitaciones.
- `production`: proyecto Supabase EU, invitaciones manuales, hasta diez
  perfiles iniciales, variables de entorno separadas.
- Las previews de Cloudflare Pages se protegen con Cloudflare Access o solo
  usan `development`; una preview abierta nunca se conecta a producción.
- No se comparten claves, buckets ni bases de datos entre entornos.
- Cada plan guarda las versiones de reglas, fuentes, catálogos, configuración
  del motor y proveedor usados para generarlo.

## 7. Coste y resiliencia de IA

Presupuesto operativo de IA: 10 EUR/mes. Umbrales de alerta: 50 %, 75 % y 90
%. `cap_eur` queda fijado a 10,00 por constraint. Antes de cada llamada una
transacción usa una `PricingFxRevision` aprobada para reservar la cota máxima
contractual en EUR; la condición
`liquidado + cotas_reservadas + nueva_cota <= 10` se evalúa bajo bloqueo. Un
timeout mantiene la reserva hasta reconciliar cargo/no cargo. Un cobro superior
a la cota se registra como anomalía y bloquea llamadas posteriores; la
aplicación garantiza el corte de autorización, no el cumplimiento contractual
del proveedor, cuyo hard billing cap se activa si está disponible. Si no cabe,
falta una revisión vigente o Luna no devuelve JSON válido, se usa una
explicación determinista y el plan sigue siendo válido.

## 8. Referencias de plataforma verificadas

- [Supabase: Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase: User Sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase: Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Supabase: Multi-Factor Authentication](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase: Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase: Database backups](https://supabase.com/docs/guides/platform/backups)
- [Cloudflare Pages: framework guides](https://developers.cloudflare.com/pages/framework-guides/)
- [Cloudflare Pages: preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Cloudflare Turnstile: Content Security Policy](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)
- [Cloudflare R2: Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)

Las referencias se revisan antes de implementar porque las capacidades y
recomendaciones de plataforma pueden cambiar.

## 9. Decisiones aplazadas deliberadamente

- nombres finales de tablas, índices y migraciones;
- paleta, tipografías y componentes visuales;
- proveedor local futuro del contrato Luna;
- fuentes o licencia exacta que todavía estén en evaluación;
- integraciones Apple Health, Health Connect, Garmin o Fitbit.
