do $$
declare
  v_food public.canonical_foods%rowtype;
  v_superseded_at timestamptz := clock_timestamp();
begin
  select * into v_food
  from public.canonical_foods food
  where food.food_key = 'food:ciqual-26161'
  for update;

  if v_food.id is null then
    return;
  end if;

  if v_food.food_state = 'raw' and v_food.edible_part = 'flesh' then
    return;
  end if;

  if v_food.food_state <> 'raw' or v_food.edible_part <> 'meat' then
    raise exception using
      errcode = '55000',
      message = 'unexpected_salmon_identity';
  end if;

  update public.effective_food_revisions effective
  set superseded_at = v_superseded_at
  where effective.canonical_food_id = v_food.id
    and effective.superseded_at is null;

  update public.canonical_foods food
  set edible_part = 'flesh'
  where food.id = v_food.id;
end;
$$;
