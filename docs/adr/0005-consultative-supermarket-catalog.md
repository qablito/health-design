# ADR-0005: Catálogo de supermercados consultivo, no transaccional

- Estado: aceptado
- Fecha: 2026-07-16

## Contexto

El usuario quiere comprobar disponibilidad, formato y precio de los alimentos pautados. No quiere comprar desde la aplicación ni gestionar ofertas, entrega o fidelización. Los catálogos cambian y una coincidencia textual no garantiza equivalencia nutricional.

## Decisión

La compra será una proyección consultiva del plan activo:

- el alimento canónico conserva la pauta nutricional;
- una regla versionada determina qué SKU puede cubrirlo;
- el SKU solo determina envases, coste y sobrante;
- el precio usado es el precio base;
- una cesta parcial nunca se presenta como la cesta completa más barata;
- la cadena elegida por el usuario se mantiene, aunque se pueda mostrar un aviso de ahorro;
- la comparación multitienda solo se ejecuta si el usuario la activa.

Una cadena permanece oculta hasta cumplir cobertura y calidad mínimas y recibir activación administrativa.

## Consecuencias

### Positivas

- La dieta no cambia por una coincidencia comercial.
- Los costes pueden explicarse por formato y número de envases.
- Se evita convertir la aplicación en un checkout.
- Los fallos de cobertura son visibles y revisables.

### Costes

- Requiere reglas canónicas y revisión editorial.
- Los precios son orientativos, no una promesa.
- La extracción de catálogos necesita mantenimiento y control de procedencia.

## Alternativas descartadas

- Seleccionar el primer resultado por texto: alto riesgo de falso positivo.
- Recomendar siempre la cadena más barata: ignora la preferencia vinculante.
- Integrar ofertas y cupones: amplía el producto fuera de V1.
- Usar macros de cada SKU en el plan: acopla nutrición a disponibilidad comercial.

