# Verificación de la Tarea 2

> **Fecha:** 2026-07-17
> **Estado:** `T2_COMPLETE_REMOTE_PASS`
> **Alcance:** Supabase local, separación `development`/`production`, frontera
> de secretos, Pages, Turnstile y continuidad Cloudflare todavía inerte.

## Resultado implementado

- Stack local Supabase reproducible con Postgres 17, access token de 900
  segundos, refresh rotation, reuse interval de 10 segundos, alta anónima y
  seed vacío sintético.
- Altas por correo y SMS desactivadas; V1 conserva únicamente la identidad
  anónima confirmada por el contrato de producto.
- Proyectos Supabase independientes en `eu-west-3`:
  - `health-design-dev` (`nwoivdxdupklervtnovd`);
  - `health-design-prod` (`rbfrpgafytexrarcfmmp`).
- Frontend preparado con el cliente oficial de Supabase, carga única del
  script exacto de Turnstile y solo cuatro variables `VITE_*` permitidas.
- Build bloqueante por destino: URL, huella de clave publicable y sitekey deben
  corresponder al mismo entorno. El bundle completo, incluidos source maps, se
  escanea después del build.
- Headers de Pages generados por entorno con CSP de hosts exactos, CORS exacto,
  `no-referrer`, `nosniff`, Permissions Policy y HSTS solo en producción.
- CORS reutilizable en Edge: origen estable exacto, preflight cerrado y rechazo
  de origen ajeno antes de procesar el payload.
- Siteverify con acción/hostname opcionales, límite de token, timeout de cinco
  segundos y fallo cerrado.
- Worker y Durable Object separados por entorno, sin ruta pública y con
  `MUTATIONS_ENABLED=false`; no existe append ni borrado.
- Cuatro buckets R2 EU separados. Los dos streams `deletions` conservan Bucket
  Lock `retain-all-indefinitely`; no se crearon access keys R2.
- Credenciales privadas guardadas en el Llavero de macOS, no en el repositorio,
  CI, Pages ni variables públicas.

## Evidencia verde actual

| Comprobación | Resultado |
| --- | --- |
| `pnpm verify` | PASS |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS; 3 archivos y 23 tests |
| `pnpm test:browser` | PASS; 2 tests en Chromium |
| `pnpm build` | PASS; 95 módulos y bundle escaneado |
| `pnpm test:supply-chain` | PASS; worktree e historial inspeccionados |
| `pnpm worker:check` | PASS en `development` y `production` |
| `supabase start` completo | PASS; Vector y servicios esenciales saludables |
| `supabase db reset` | PASS; esquema recreado y seed sintético aplicado |
| `supabase stop --no-backup` | PASS; sin contenedores residuales |
| cliente local con clave de `.env.example` | PASS; alta anónima real |
| Auth local | PASS; anónimo permitido y email rechazado |
| smoke Edge local | PASS; `401`, `200`, `400` y `413` |
| validación `Origin` local | PASS; POST ajeno devuelve `403` |
| Auth hospedado dev + Turnstile de prueba | PASS |
| Edge hospedado dev | PASS; preflight `204`, origen exacto `200`, ajeno `403` |
| Auth remoto dev/prod | PASS; 900/rotación/10, anónimo y CAPTCHA activos, email/teléfono cerrados |
| Pages producción | PASS; `https://health-design.pages.dev`, `200` y headers exactos |
| Pages preview | PASS; alias estable `200`, Supabase dev y `noindex` |
| Workers remotos | PASS; dos versiones separadas e inertes |
| R2 EU | PASS; cuatro buckets y locks indefinidos en ambos `deletions` |

La función `runtime-smoke` se desplegó solo en `health-design-dev` para probar
la frontera hospedada. Producción no contiene este harness.

## Hallazgos corregidos durante la ejecución

1. La clave publicable ficticia de `.env.example` permitía compilar, pero no
   autenticar contra el stack real. Se sustituyó por la clave pública local
   estable y se verificó una sesión anónima.
2. La primera frontera validaba la URL de Supabase, pero no impedía cruzar la
   clave publicable del otro entorno. Ahora se comprueba su huella SHA-256.
3. Producción rechazaba la sitekey de prueba, pero aceptaba cualquier otra. La
   comparación es ahora exacta.
4. Pages añadía `Access-Control-Allow-Origin: *` a los HTML. `_headers` lo
   sobrescribe con el origen canónico de cada entorno; la comprobación en vivo
   confirmó el cambio.
5. Supabase conservaba el proveedor email activo por defecto aunque V1 no pide
   correo. Se cerraron email y teléfono sin afectar al alta anónima.
6. Siteverify no tenía límite temporal. Ahora aborta a los cinco segundos y
   devuelve fallo cerrado.
7. El gateway local de Supabase intercepta `OPTIONS` y añade CORS wildcard.
   El POST sigue validando `Origin` y falla con `403`; el entorno hospedado sí
   conserva el preflight exacto del handler. No hay mutaciones V1 activas.
8. Wrangler confundía el config del Worker con Pages. Se separó
   `apps/web/wrangler.toml` y desapareció el aviso.
9. Los comandos R2 sin `--jurisdiction eu` producían un falso “bucket no
   existe”. El runbook documenta el selector obligatorio.
10. `supabase config push` 2.108.0 aplicó parte de Auth antes de fallar al leer
    Storage con `LegacyConfigPushStorageReadNetworkError`. Se restauraron los
    campos afectados y la configuración remota se aplica ahora selectivamente
    y se relee completa.

## Incidencia local resuelta

Colima publica su daemon en `~/.colima/default/docker.sock`, pero Vector espera
el socket raíz dentro de la máquina virtual. El enlace recomendado por Colima
resuelve el acceso de aplicaciones locales:

```bash
sudo ln -s ~/.colima/default/docker.sock /var/run/docker.sock
```

Supabase CLI 2.108.0 obtiene, además, la ruta del contexto activo e intentaba
montar directamente la ruta del host dentro de la VM. Fijar para la sesión
`DOCKER_HOST=unix:///var/run/docker.sock` conserva la ruta que existe a ambos
lados. Con esa configuración se observó en verde la secuencia completa:

```bash
export DOCKER_HOST=unix:///var/run/docker.sock
pnpm exec supabase start
pnpm exec supabase db reset
pnpm exec supabase functions serve runtime-smoke
EDGE_SMOKE_USE_LOCAL_ANON=true pnpm edge:smoke
pnpm exec supabase stop --no-backup
```

Vector quedó saludable, el smoke devolvió `401`, `200`, `400` y `413`, y el
apagado no dejó contenedores `supabase_*_health-design` en ejecución.

## Límites explícitos

- Tarea 2 no implementa perfiles, membresías, RLS ni datos de salud; eso empieza
  en Tarea 3.
- Los Workers y buckets están provisionados, pero no ejecutan mutaciones ni
  sustituyen las pruebas futuras del protocolo de ledger.
- Las URLs hash de Pages son recibos de despliegue. Solo los aliases estables
  están autorizados como origen de aplicación.
- No se presenta el scanner de patrones como detector universal de cualquier
  secreto posible.

## Referencias operativas

- [Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config)
- [Supabase Edge Functions CORS](https://supabase.com/docs/guides/functions/cors)
- [Supabase Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)
- [Cloudflare Pages previews](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Cloudflare Turnstile testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
- [Cloudflare R2 Bucket Locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Colima FAQ](https://github.com/abiosoft/colima/blob/main/docs/FAQ.md)
