create function private.list_effective_nutrition_generator_catalog()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with required_nutrients(nutrient_key) as (
    values
      ('energy_kcal'),
      ('protein'),
      ('carbohydrates'),
      ('fat'),
      ('fiber')
  ), catalog as (
    select
      effective.id as effective_revision_id,
      food.food_key,
      food.name,
      food.category,
      food.food_state,
      food.edible_part,
      revision.id as revision_id,
      manifest.id as manifest_id,
      source.source_key,
      revision.source_version,
      jsonb_object_agg(
        nutrient.nutrient_key,
        observation.normalized_value::text
        order by nutrient.nutrient_key
      ) filter (
        where nutrient.nutrient_key in (
          select required.nutrient_key from required_nutrients required
        )
          and observation.value_state = 'known'
          and observation.normalized_value is not null
      ) as nutrients,
      coalesce(jsonb_object_agg(
        nutrient.nutrient_key,
        jsonb_build_object(
          'value', observation.normalized_value::text,
          'unit', observation.normalized_unit
        )
        order by nutrient.nutrient_key
      ) filter (
        where nutrient.nutrient_key in (
          'calcium', 'folate', 'iron', 'iodine', 'magnesium', 'potassium',
          'salt', 'saturated_fat', 'selenium', 'sodium', 'sugars',
          'vitamin_b12', 'vitamin_c', 'zinc'
        )
          and observation.value_state = 'known'
          and observation.normalized_value is not null
      ), '{}'::jsonb) as clinical_nutrients
    from public.effective_food_revisions effective
    join public.canonical_foods food
      on food.id = effective.canonical_food_id
    join public.food_composition_revisions revision
      on revision.id = effective.revision_id
    join public.nutrition_source_manifests manifest
      on manifest.id = revision.source_manifest_id
    join public.nutrition_sources source
      on source.id = manifest.source_id
    join public.nutrient_observations observation
      on observation.food_revision_id = revision.id
    join public.nutrition_nutrients nutrient
      on nutrient.id = observation.nutrient_id
    where effective.superseded_at is null
      and food.active
      and revision.status = 'validated'
      and manifest.status = 'validated'
    group by
      effective.id,
      food.id,
      revision.id,
      manifest.id,
      source.source_key
    having count(*) filter (
      where nutrient.nutrient_key in (
        select required.nutrient_key from required_nutrients required
      )
        and observation.value_state = 'known'
        and observation.normalized_value is not null
    ) = 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'effectiveRevisionId', catalog.effective_revision_id,
    'canonicalFoodKey', catalog.food_key,
    'name', catalog.name,
    'category', catalog.category,
    'foodState', catalog.food_state,
    'ediblePart', catalog.edible_part,
    'revisionId', catalog.revision_id,
    'manifestId', catalog.manifest_id,
    'sourceKey', catalog.source_key,
    'sourceVersion', catalog.source_version,
    'nutrients', catalog.nutrients,
    'clinicalNutrients', catalog.clinical_nutrients
  ) order by catalog.food_key), '[]'::jsonb)
  from catalog
$$;

create function public.internal_nutrition_effective_generator_catalog()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select private.list_effective_nutrition_generator_catalog()
$$;

revoke all on function private.list_effective_nutrition_generator_catalog()
from public, anon, authenticated;
revoke all on function public.internal_nutrition_effective_generator_catalog()
from public, anon, authenticated;
grant execute on function public.internal_nutrition_effective_generator_catalog()
to service_role;

comment on function public.internal_nutrition_effective_generator_catalog() is
'T10: catálogo privado de revisiones efectivas con cinco nutrientes exactos para el motor.';
