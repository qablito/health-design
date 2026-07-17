# ADR-0003: Acceso a perfiles mediante membresías de dispositivo

- Estado: aceptado
- Fecha: 2026-07-16

## Contexto

V1 no pide correo ni teléfono, pero un perfil debe estar disponible en varios dispositivos. El alias debe ser visible y sencillo, sin convertirse en credencial. Cada sesión debe poder revocarse de forma independiente.

## Decisión

Cada instalación o navegador obtiene una identidad anónima independiente de
Supabase Auth. La sesión usa JWT/refresh token administrados por el cliente
oficial; el acceso al perfil se concede mediante una membresía de dispositivo
almacenada en servidor.

- El alias es presentación y routing de V1: queda reservado y es único entre
  perfiles `active` o `deletion_requested` para evitar ambigüedad, se libera al
  completar `DeletionJob.status=purged` y eliminar la fila del perfil, pero
  nunca es factor de autenticación.
- El código privado es un secreto de alta entropía, almacenado con hash resistente y protección frente a intentos masivos.
- Solo existe un código activo por perfil; rotar revoca el anterior sin cerrar
  sesiones salvo elección explícita.
- El código o un QR de un solo uso permite crear una nueva membresía.
- El QR expira pronto, usa un payload opaco no URL, se consume de forma atómica
  por `POST` y no contiene datos de salud ni el código permanente.
- Las políticas de acceso se basan en la membresía y el rol, no en el alias.
- La renovación del código y la revocación de sesiones son operaciones independientes.
- Un dispositivo nuevo obtiene su propia identidad y usa código/QR para recibir
  una membresía; nunca copia la sesión de otro dispositivo.
- Una identidad Auth representa un dispositivo lógico y conserva una sola
  `DeviceSession` activa; las pestañas del mismo navegador comparten esa
  identidad.
- Revocar la membresía debe denegar acceso inmediatamente por RLS aunque el JWT
  aún sea válido.
- Refresh rotation queda activada con reuse interval de 10 segundos; la sesión
  de dispositivo vence a los 30 días idle o 180 días absolutos.
- Una identidad puede conservar varias membresías; revocar una no afecta las
  demás.
- Supabase no se usa como mecanismo de revocación individual por perfil.
  Revocar un perfil elimina solo `ProfileAccess`. Cerrar o vencer globalmente
  el actor deshabilita `DeviceSession`, revoca todas sus membresías y ejecuta
  `signOut` servidor para todos los refresh tokens de esa identidad. RLS
  bloquea también cualquier JWT residual.
- RLS resuelve `auth.uid() → Actor.auth_subject → ProfileAccess.actor_id`.

Las operaciones de vinculación, restablecimiento, invitación y administración
pasan por funciones servidoras. El QR es vinculación, no recuperación
autoservicio.

El secreto de invitación tampoco se transporta en una URL. Un enlace puede
abrir la ruta pública, pero el secreto se introduce y canjea en el cuerpo de un
POST.

## Consecuencias

### Positivas

- Acceso entre dispositivos sin pedir PII convencional.
- Revocación granular.
- El robo o adivinación de un alias no concede acceso.
- RLS puede aislar perfiles incluso si el cliente consulta directamente datos permitidos.

### Costes y riesgos

- El usuario debe conservar el código privado.
- El endpoint de enlace es sensible a fuerza bruta y abuso.
- Una identidad Supabase Auth solo se elimina cuando no conserva otra
  membresía ni rol administrativo.
- El restablecimiento por superadministrador tiene alto impacto y exige registro privado.

## Alternativas descartadas

- Alias como contraseña: entropía insuficiente.
- Una sesión compartida entre dispositivos: no permite revocación granular.
- Cuenta tradicional obligatoria por correo: contradice la experiencia confirmada para V1.
- Almacenamiento solo local: no permite sincronización real.
