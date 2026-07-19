update public.nutrient_observations observation
set normalized_value = observation.normalized_value * 1000,
    normalized_unit = 'mg',
    interval_minimum = observation.interval_minimum * 1000,
    interval_maximum = observation.interval_maximum * 1000
where observation.nutrient_id = '29000000-0000-4000-8000-000000000010'
  and observation.normalized_unit = 'g';

update public.nutrition_nutrients nutrient
set canonical_unit = 'mg'
where nutrient.id = '29000000-0000-4000-8000-000000000010'
  and nutrient.nutrient_key = 'sodium';
