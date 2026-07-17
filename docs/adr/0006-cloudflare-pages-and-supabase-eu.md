# ADR-0006: React/Vite en Cloudflare Pages y Supabase en región europea

- Estado: aceptado
- Fecha: 2026-07-16

## Contexto

V1 necesita una aplicación web accesible desde móvil y escritorio, sincronización remota, almacenamiento estructurado, autenticación por dispositivo, funciones servidoras y un coste operativo bajo para una prueba de hasta 10 usuarios.

## Decisión

- Frontend: React, TypeScript y Vite, preparado como PWA.
- Hosting: Cloudflare Pages con despliegues de vista previa.
- Continuidad: Cloudflare Worker, Durable Object y R2 para los streams
  independientes definidos en ADR-0007.
- Backend gestionado: proyecto Supabase en región europea.
- Persistencia: PostgreSQL.
- Autenticación: Supabase Auth como identidad de dispositivo.
- Autorización: RLS, privilegios mínimos y membresías de perfil.
- Expiración operativa: `DeviceSession` y RLS propias aplican 30 días idle/180
  días absolutos; V1 no depende de una función de timeboxing reservada a un
  plan de pago.
- Lógica privilegiada: Edge Functions o funciones servidoras equivalentes.
- Ficheros: Supabase Storage privado; las exportaciones se descargan por proxy
  autenticado, sin URL firmada expuesta al navegador.
- Desarrollo y producción: proyectos y secretos separados.

Las claves con privilegios elevados nunca llegan al navegador. Las tablas internas no se exponen sin necesidad; toda superficie expuesta requiere grants mínimos y RLS.

Los despliegues de vista previa no se consideran privados por existir una URL
difícil de adivinar. Se protegen mediante Cloudflare Access o se conectan
exclusivamente al entorno de desarrollo con datos sintéticos. Ninguna preview
abierta utiliza el proyecto Supabase de producción.

## Consecuencias

### Positivas

- Poca infraestructura propia para la prueba privada.
- PostgreSQL facilita reglas, versionado y consultas auditables.
- Previews independientes para validar interfaz.
- La PWA cubre escritorio y móvil con un único frontend.

### Costes y riesgos

- Dependencia de dos proveedores.
- Las previews necesitan una política explícita de acceso y entorno.
- RLS y funciones privilegiadas pasan a ser superficie crítica.
- Las copias lógicas y pruebas de restauración deben diseñarse explícitamente.
- El ledger independiente añade coordinación, cifrado y operación de
  Worker/Durable Object/R2.
- Cambiar de backend requeriría migrar autenticación, políticas y datos.

## Alternativas descartadas

- Backend propio desde el inicio: coste operativo desproporcionado para V1.
- Solo almacenamiento local: no cumple sincronización.
- Aplicaciones nativas separadas: amplía alcance y mantenimiento.
- Lógica privilegiada en el cliente: expone secretos y controles.

## Referencias

- [Cloudflare Pages: preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Cloudflare Pages: build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
