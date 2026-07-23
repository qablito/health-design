# Publicación de catálogos de supermercado

**Estado:** operativo en Development para T17.
**Entorno permitido:** Supabase `nwoivdxdupklervtnovd`, Pages Preview y R2
`health-design-catalog-source-dev`.
**Entorno prohibido:** Supabase `rbfrpgafytexrarcfmmp` y la aplicación de
producción.

Este runbook gobierna la captura privada, importación, matching, publicación,
ocultación y validación de catálogos de supermercado. No autoriza scraping,
publicación de cadenas que no superen sus puertas, cambios nutricionales ni
acciones en Production.

## Estado de referencia

| Cadena | Estado | Cobertura de la cesta 60 + 20 |
|---|---|---:|
| Mercadona | `published` | 73/80; cada grupo ≥ 75 % |
| DIA | `not_published` | 62/80 |
| ALDI | `not_published` | 41/80 |

La aplicación muestra presencia en el catálogo y precio base orientativo. No
muestra stock, disponibilidad, ubicación interna ni fecha de captura.

## Precondiciones y frontera

1. Confirmar que el proyecto enlazado es exactamente Development y que ningún
   comando apunta al ref de Production.
2. Trabajar con capturas y manifests en almacenamiento privado. No registrar
   URLs firmadas, nombres de archivos fuente, productos, precios ni
   credenciales.
3. Verificar SHA-256 del objeto bruto y del normalizado antes de importar.
4. Mantener separados el manifest bruto, el normalizado y el recibo de
   importación. Una misma clave con el mismo hash es un replay; con otro hash es
   un conflicto y se detiene.
5. La importación es idempotente y no publica. El matching dudoso permanece en
   revisión manual.
6. La publicación u ocultación exige superadministrador, sesión AAL2 y TOTP
   reciente. AAL1 debe rechazarse antes de mutar.

## Flujo de importación y revisión

1. Comprobar el objeto privado y sus hashes sin descargarlo a un directorio
   rastreado.
2. Validar los manifests y normalizar el catálogo de forma determinista.
3. Consultar los recibos `intent/outcome` antes de reintentar. Tras un timeout,
   reutilizar la misma clave de idempotencia.
4. Ejecutar la importación. El mismo artefacto no crea una segunda revisión.
5. Revisar manualmente candidatos `review`; activar únicamente matching
   documentado `exact` o `allowed`.
6. Calcular cobertura contra la semilla activa de 60 alimentos fijos y 20
   dinámicos.
7. Autorizar publicación solo con al menos 72/80 y ≥ 75 % en cada grupo.
8. Registrar `intent` antes de la mutación y `outcome` después. Un resultado
   parcial no se reinterpreta como éxito.

## Publicación, ocultación y rollback

- Publicar una revisión crea el estado autorizado que consumen los snapshots;
  no modifica planes nutricionales ni snapshots históricos.
- Ocultar es una operación manual AAL2. No se usa para fabricar evidencia ni
  para probar una revisión histórica.
- El rollback manual selecciona una revisión previamente validada, vuelve a
  comprobar cobertura y registra nuevos recibos; no edita una publicación
  histórica.
- Un precio permanece vigente hasta una nueva revisión publicada u ocultación
  manual. No existe caducidad automática.
- Ante interrupción, consultar primero los recibos. Reanudar el paso pendiente
  con la misma clave; nunca repetir activaciones a ciegas.

## Despliegue selectivo

Solo se despliegan migraciones y funciones cuyo diff pertenezca al tramo
autorizado. Para T17, `catalogs` sirve catálogos y snapshots, y `exports`
proyecta un snapshot ya autorizado. No desplegar `admin`,
`admin-reconciler` ni otras funciones sin un cambio demostrado y autorización
separada.

El Preview web debe apuntar exclusivamente a Supabase Development. No se
publica en la rama principal de Pages.

## Smoke y recuperación

El plan local, sin red ni secretos, se inspecciona con:

```bash
pnpm test:t17:remote --dry-run
```

El modo real requiere autorización remota independiente y las variables de
Development. Rechaza de forma cerrada el ref y la URL de Production. Usa dos
perfiles sintéticos, valida aislamiento, snapshot y exportaciones privadas, y
ejecuta cleanup en presencia de fallos.

Variables requeridas, siempre desde almacenamiento seguro y sin escribir sus
valores en el repositorio:

- `SUPABASE_URL=https://nwoivdxdupklervtnovd.supabase.co`;
- `SUPABASE_PROJECT_REF=nwoivdxdupklervtnovd`;
- `SUPABASE_PUBLISHABLE_KEY`;
- `SUPABASE_SECRET_KEY`;
- `T17_REMOTE_CONFIRM=health-design-dev:t17-shopping`;
- `T17_SUPERADMIN_AAL2_ACCESS_TOKEN`, con TOTP verificado hace menos de cinco
  minutos.

Después del preflight, copia, migración y despliegue autorizados:

```bash
pnpm test:t17:remote --execute
```

La ejecución real también exige que este worktree esté enlazado explícitamente
al proyecto de desarrollo `nwoivdxdupklervtnovd`; no confía solo en variables
de entorno.

Mientras solo Mercadona esté publicada:

- `MULTISTORE_REMOTE: NOT_APPLICABLE_REMOTE_ONLY_ONE_CHAIN_PUBLISHED`
- `HISTORICAL_PUBLICATION_REMOTE:
  NOT_APPLICABLE_WITHOUT_SAFE_PUBLICATION_CHANGE`
- `FULL_RESTORE_T18: NOT_IMPLEMENTED`

Estos estados no se convierten en `PASS` por inferencia.

## Cleanup

Eliminar perfiles, preferencias, sobrantes, selecciones, snapshots,
relaciones dependientes, artefactos de `plan-exports` y objetos sintéticos.
Conservar el catálogo compartido, la publicación de Mercadona y la evidencia
privada T17B. Verificar que repetir el cleanup no causa mutaciones adicionales.

## Evidencia mínima

Guardar solo commit, entorno, hashes no sensibles, conteos, estados, cabeceras
privadas y resultados de puertas. No guardar identidades, alias, correos,
contraseñas, TOTP, tokens, datos clínicos, productos o precios reales.
