# ADR-0008: renderizadores PDF y XLSX en Supabase Edge

- Estado: aceptado
- Fecha: 2026-07-20

## Contexto

T15 debe representar una versión nutricional inmutable con las mismas elecciones
en impresión, PDF y XLSX. Los archivos contienen datos privados, deben generarse
sin una URL pública o firmada en el navegador y han de ejecutarse dentro del
runtime Deno de Supabase Edge Functions.

La solución necesita dos renderizadores sin binarios nativos, un modelo común
independiente del formato, dependencias reproducibles y neutralización explícita
de fórmulas en hojas de cálculo.

## Decisión

- El modelo canónico `ExportModel` se construye antes de renderizar y contiene
  únicamente el resultado nutricional permitido, el `plan_version_id`, el hash
  del resultado, la versión del renderizador y la configuración normalizada.
- La impresión es una vista HTML/CSS A4 creada en el navegador desde ese modelo;
  no es un `ExportArtifact` ni se persiste.
- El PDF se genera con `pdf-lib@1.17.1`.
- El XLSX se genera con SheetJS CE `0.20.3`, fijado mediante el tarball del CDN
  oficial y el lockfile. La Edge Function empaqueta el módulo desde la instalación
  bloqueada para que el despliegue no dependa de descargar el CDN; no se usa el
  paquete npm antiguo `xlsx` como origen.
- Ambos renderizadores usan módulos ESM puros, sin canvas, navegador sin cabeza,
  binarios nativos, macros ni enlaces externos.
- La Edge Function genera, limita a 25 MiB, guarda en el bucket privado
  `plan-exports` y entrega bytes mediante un proxy autenticado. Nunca devuelve
  una URL de Storage al cliente.
- El XLSX usa matrices de valores y neutraliza cualquier texto que pueda
  interpretarse como fórmula antes de escribir la celda.
- Las versiones quedan fijadas. Una actualización exige nueva revisión de
  cadena de suministro, compatibilidad Edge, ida y vuelta XLSX y regresión de
  equivalencia.

## Evidencia de compatibilidad

- El grafo real de imports se carga en Supabase Edge Runtime/Deno sin fallback
  nativo.
- Las pruebas unitarias abren de nuevo el XLSX y validan hojas, unidades,
  metadatos, orden y neutralización de fórmulas.
- Las pruebas de PDF verifican cabecera, páginas, metadatos y ausencia de campos
  sensibles.
- La puerta remota usa el fixture máximo de 168 elecciones para ambos formatos.

## Consecuencias

### Positivas

- Un solo modelo reduce la deriva entre pantalla, impresión y archivos.
- La generación permanece dentro de la frontera privada de Supabase.
- No aparece un servicio adicional ni un navegador automatizado en producción.
- El lockfile conserva el origen exacto de SheetJS.

### Costes y límites

- El PDF usa una maquetación tabular deliberadamente sobria; no pretende ser un
  motor editorial completo.
- Los cambios de fuente, paginación o formato requieren pruebas deterministas.
- La compatibilidad local no basta: cada cambio de renderizador debe probarse
  también en Edge alojado con el fixture máximo.
- T15 exporta solo alimentación. Otros módulos requieren un contrato futuro y
  no pueden añadirse como campos libres.

## Alternativas descartadas

- **Puppeteer/Chromium:** aumenta tamaño, tiempo de arranque y dependencia de un
  binario no adecuado para esta Edge Function.
- **Servicio PDF externo:** amplía la exposición de datos y la superficie
  operativa.
- **URL firmada de Storage:** convierte la URL en una capacidad transferible y
  contradice el proxy autenticado aprobado.
- **CSV:** no cubre hojas separadas, metadatos, preparación y edición estructurada.
- **ExcelJS:** no fue seleccionado porque la combinación elegida ya supera las
  pruebas ESM/Edge con menor superficie necesaria para V1.

## Referencias

- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase Storage: buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase Storage: control de acceso](https://supabase.com/docs/guides/storage/security/access-control)
- [pdf-lib](https://pdf-lib.js.org/)
- [SheetJS CE](https://docs.sheetjs.com/)
