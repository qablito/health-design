# Desarrollo local y entornos

Este runbook cubre el arranque reproducible de V1 y la frontera entre `local`,
`development` y `production`. Ningún comando local debe escribir en los
proyectos remotos salvo que lo indique expresamente.

## Matriz de entornos

| Destino | Frontend | Supabase | Datos | Turnstile |
|---|---|---|---|---|
| `local` | `http://127.0.0.1:5173` | stack local en `127.0.0.1:54321` | solo seed sintético | clave oficial de prueba |
| `preview` | `https://task-02-environments.health-design.pages.dev` | `health-design-dev`, ref `nwoivdxdupklervtnovd`, `eu-west-3` | solo sintéticos | claves oficiales de prueba |
| `production` | `https://health-design.pages.dev` | `health-design-prod`, ref `rbfrpgafytexrarcfmmp`, `eu-west-3` | usuarios invitados | widget real `health-design-prod` |

Una preview abierta nunca puede usar la URL de Supabase, la clave publicable ni
el widget de producción. `scripts/check-public-env.mjs` hace fallar el build si
la combinación de destino y entorno no coincide. Las claves publicables se
enlazan al entorno mediante su huella SHA-256 y la sitekey de producción se
comprueba de forma exacta; ambas siguen siendo datos públicos de cliente, no
secretos privilegiados.

Las URLs hash que Pages emite son recibos de despliegue, no orígenes de uso de
la aplicación. El navegador debe abrir los aliases estables anteriores para
que Auth, Turnstile y CORS compartan el mismo origen canónico.

## Requisitos

- Node.js 24 y pnpm 11.13.1.
- Un daemon Docker activo: Docker Desktop o Colima.
- Supabase y Wrangler ejecutados siempre mediante `pnpm exec`, para usar las
  versiones fijadas en el lockfile.

## Primer arranque

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm exec supabase start
pnpm exec supabase db reset
pnpm dev
```

Vite lee el `.env.local` de la raíz. El ejemplo ya contiene únicamente los
valores públicos locales —incluida la clave publicable generada por el stack
local, que no es un secreto— y placeholders para variables privadas. No se
debe copiar una credencial privada real a `.env.example`.

Superficies locales principales:

- aplicación: `http://127.0.0.1:5173`;
- API de Supabase: `http://127.0.0.1:54321`;
- Studio: `http://127.0.0.1:54323`;
- Mailpit: `http://127.0.0.1:54324`.

## Edge Function local

Con Supabase iniciado, usar dos terminales:

```bash
pnpm exec supabase functions serve runtime-smoke
```

```bash
EDGE_SMOKE_USE_LOCAL_ANON=true pnpm edge:smoke
```

El smoke exige JWT y comprueba el límite HTTP real. No se debe sustituir por
una prueba que invoque directamente el handler.

## Reset, seed y apagado

```bash
pnpm exec supabase db reset
pnpm exec supabase stop --no-backup
```

`supabase/seed.sql` es deliberadamente mínimo, determinista y sintético. Los
datos reales, catálogos capturados y perfiles de usuarios no forman parte del
seed ni de CI.

## Verificación antes de entregar

```bash
pnpm verify
pnpm test:supply-chain
pnpm worker:check
pnpm exec supabase start
pnpm exec supabase db reset
node scripts/check-public-env.mjs
```

Después se ejecuta el smoke de Edge y se apaga el stack. `pnpm worker:check`
solo compila y valida bindings; no despliega ni habilita mutaciones.

## Variables y secretos

Solo estas variables pueden llegar al navegador:

- `VITE_APP_ENV`;
- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_PUBLISHABLE_KEY`;
- `VITE_TURNSTILE_SITE_KEY`.

`PUBLIC_DEPLOY_TARGET` controla el build, pero no se expone mediante Vite. Todo
lo demás es privado y vive en secretos del proveedor o en un archivo local
ignorado. En particular, nunca se publica `service_role`/`sb_secret_`, pepper,
claves de backup, Luna, Cloudflare API o credenciales R2.

Las Edge Functions leen `APP_ENV=development|production` como configuración
servidora. Si falta, usan la allowlist local y rechazan los orígenes hospedados;
si contiene otro valor, fallan antes de procesar la petición.

Las credenciales operativas creadas durante la provisión están en el Llavero de
macOS:

- servicio `health-design-supabase-db-password`, cuentas
  `health-design-dev` y `health-design-prod`;
- servicio `health-design-turnstile-secret`, cuenta `health-design-prod`.

No se crearon access keys de R2. Los Workers acceden exclusivamente mediante
bindings administrados por Cloudflare.

## Recursos Cloudflare

- Pages: `health-design`, rama de producción `main`.
- Workers sin ruta pública:
  - `health-design-continuity-ledger-dev`;
  - `health-design-continuity-ledger-prod`.
- Durable Object: `ContinuityLedger`, separado por Worker/entorno.
- R2 EU:
  - `health-design-deletions-dev`;
  - `health-design-admin-audit-dev`;
  - `health-design-deletions-prod`;
  - `health-design-admin-audit-prod`.

Los buckets `deletions` tienen la regla `retain-all-indefinitely`. Ambos
Workers conservan `MUTATIONS_ENABLED="false"`; `/health` solo informa de ese
estado y no existe todavía ninguna ruta de escritura.

El `wrangler.toml` de la raíz pertenece al Worker y sus bindings. El
`apps/web/wrangler.toml` pertenece exclusivamente a Pages; mantenerlos
separados evita que un despliegue estático interprete por error la
configuración del ledger.

## Configuración hospedada de Supabase Auth

Los dos proyectos remotos mantienen access tokens de 900 segundos, rotación de
refresh tokens activa, intervalo de reutilización de 10 segundos, identidades
anónimas activas, altas por correo y teléfono desactivadas, Turnstile
obligatorio y TOTP disponible. Desarrollo admite únicamente las URLs de
preview de `health-design.pages.dev`; producción admite únicamente
`https://health-design.pages.dev`.

`runtime-smoke` está desplegada únicamente en `health-design-dev` para probar
JWT y CORS hospedado sin efectos. No se despliega en producción. Su preflight
devuelve el origen estable exacto, el POST válido devuelve `200` y un origen
ajeno devuelve `403`.

No ejecutar un `supabase config push` completo con la CLI 2.108.0. El bug
documentado más abajo puede fallar después de haber copiado defaults locales no
deseados. Cualquier cambio remoto se aplica de forma selectiva y después se
vuelve a leer la configuración completa para comprobar que no se alteraron
mailer, MFA ni las URLs del otro entorno.

## Build y despliegue manual de Pages

Las variables `VITE_*` se integran en el bundle, por lo que se fijan antes del
build. Los marcadores entre `<...>` son valores públicos del entorno, nunca
secretos.

Preview:

```bash
PUBLIC_DEPLOY_TARGET=preview \
VITE_APP_ENV=development \
VITE_SUPABASE_URL=https://nwoivdxdupklervtnovd.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<development-publishable-key> \
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
pnpm build
pnpm exec wrangler pages deploy dist --cwd apps/web \
  --project-name health-design --branch <branch>
```

Producción:

```bash
PUBLIC_DEPLOY_TARGET=production \
VITE_APP_ENV=production \
VITE_SUPABASE_URL=https://rbfrpgafytexrarcfmmp.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<production-publishable-key> \
VITE_TURNSTILE_SITE_KEY=<production-site-key> \
pnpm build
pnpm exec wrangler pages deploy dist --cwd apps/web \
  --project-name health-design --branch main
```

`pnpm build` ya genera los headers y escanea el bundle usando las mismas
variables de entorno. Ejecutar después `pnpm check:public-env` sin repetir esas
variables validaría contra `local` y produciría un resultado engañoso.

Producción rechaza la sitekey ficticia; `local` y `preview` rechazan una
sitekey real. Los headers generados permiten únicamente el Supabase del
entorno y `challenges.cloudflare.com`; también sobrescriben el CORS genérico
de Pages con el origen exacto del entorno. HSTS y
`upgrade-insecure-requests` solo se emiten en producción.

## Errores frecuentes

### Docker no responde o hay puertos ocupados

Iniciar Docker Desktop o Colima, ejecutar
`pnpm exec supabase stop --no-backup` y volver a iniciar. No matar contenedores
ajenos ni borrar volúmenes manualmente.

Con Colima, Supabase necesita que `/var/run/docker.sock` resuelva al socket del
daemon. Si `supabase start` falla únicamente al montar ese socket en el servicio
Vector, crear una sola vez el enlace recomendado por Colima:

```bash
sudo ln -s ~/.colima/default/docker.sock /var/run/docker.sock
```

Verificar el destino con `readlink /var/run/docker.sock`. Supabase CLI toma la
ruta del contexto de Docker; para que Vector monte la ruta existente dentro de
la VM de Colima, fijar también en cada terminal que ejecute Supabase:

```bash
export DOCKER_HOST=unix:///var/run/docker.sock
```

Después se pueden usar sin cambios los comandos de este runbook. No excluir
Vector como solución permanente: esa opción solo sirve para aislar el
diagnóstico.

### `functions serve` no inicia

Comprobar primero `pnpm exec supabase status` y el log del proceso. Usar la CLI
fijada por el proyecto; una CLI global distinta no es evidencia válida.

El gateway del stack local añade `Access-Control-Allow-Origin: *` a sus
respuestas y contesta él mismo a `OPTIONS`; es comportamiento del proxy local,
no del handler. La función sigue rechazando con `403` todo POST cuyo `Origin`
no esté permitido. La comprobación de CORS exacto se ejecuta además contra la
función hospedada en `development`, donde el preflight conserva la allowlist
exacta. Ningún endpoint de mutación V1 está habilitado todavía.

### `config push` muestra `LegacyConfigPushStorageReadNetworkError`

La CLI 2.108.0 puede fallar al leer la configuración remota de Storage. No
repetir el push completo: puede intentar copiar defaults locales de Auth. Los
ajustes hospedados se cambian de forma selectiva mediante Dashboard o el
endpoint oficial de Management API y se verifican después campo a campo.

### Wrangler indica que un bucket R2 no existe

Los cuatro buckets pertenecen a la jurisdicción EU. Los comandos operativos de
R2 deben incluir `--jurisdiction eu`; sin ese indicador, Wrangler consulta el
espacio global y puede devolver un falso `bucket does not exist`.

### Un build de preview detecta producción

No desactivar el check. Corregir `PUBLIC_DEPLOY_TARGET`, `VITE_APP_ENV` y la URL
de Supabase; después reconstruir desde cero. La preferencia del usuario o una
URL difícil de adivinar no convierten una preview en un entorno privado.
