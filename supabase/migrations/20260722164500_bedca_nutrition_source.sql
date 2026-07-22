alter table public.nutrition_sources
drop constraint nutrition_sources_source_key_check;

alter table public.nutrition_sources
add constraint nutrition_sources_source_key_check check (
  source_key in (
    'ciqual_2025', 'bls_4_0', 'fineli', 'livsmedelsverket',
    'usda_foundation', 'usda_sr_legacy', 'bedca_public'
  )
);

alter table public.nutrition_sources
drop constraint nutrition_sources_precedence_check;

alter table public.nutrition_sources
add constraint nutrition_sources_precedence_check check (
  precedence between 1 and 7
);

insert into public.nutrition_sources (
  id, source_key, name, precedence, license_reference
) values (
  '19000000-0000-4000-8000-000000000007',
  'bedca_public',
  'Base de Datos Española de Composición de Alimentos',
  7,
  'BEDCA public data use conditions'
)
on conflict (source_key) do update
set name = excluded.name,
    precedence = excluded.precedence,
    license_reference = excluded.license_reference;

comment on constraint nutrition_sources_source_key_check
on public.nutrition_sources is
  'Catálogo cerrado de fuentes nutricionales admitidas por el motor V1.';

comment on constraint nutrition_sources_precedence_check
on public.nutrition_sources is
  'La precedencia 1..7 coincide con SOURCE_PRIORITY del catálogo canónico.';
