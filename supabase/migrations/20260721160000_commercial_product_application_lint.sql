-- Preserve the access check while avoiding an intentionally unread assignment.

create or replace function public.internal_commercial_product_for_application(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_confirmation_id uuid,
  p_canonical_food_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_response jsonb;
begin
  if p_canonical_food_key !~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$' then
    raise exception using errcode = '22023', message = 'invalid_product_application';
  end if;

  perform private.require_commercial_product_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );

  select jsonb_build_object(
    'schemaVersion', 1,
    'confirmationId', confirmation.id,
    'productId', product.id,
    'revisionId', revision.id,
    'manifestId', revision.manifest_id,
    'contentHash', encode(revision.content_hash, 'hex'),
    'completeness', revision.completeness,
    'snapshot', revision.snapshot,
    'matching', jsonb_build_object(
      'canonicalFoodKey', p_canonical_food_key,
      'messageKey', 'commercial_products.matching.' || case
        when matching.id is null then 'exact'
        when food.food_key = p_canonical_food_key then matching.match_state
        else 'review'
      end,
      'state', case
        when matching.id is null then 'exact'
        when food.food_key = p_canonical_food_key then matching.match_state
        else 'review'
      end
    )
  ) into v_response
  from public.product_confirmations confirmation
  join public.commercial_product_revisions revision
    on revision.id = confirmation.revision_id
  join public.commercial_products product
    on product.id = confirmation.product_id
    and product.id = revision.product_id
  left join public.product_matching_rule_revisions matching
    on matching.product_id = product.id and matching.status = 'active'
  left join public.canonical_foods food on food.id = matching.canonical_food_id
  where confirmation.id = p_confirmation_id
    and confirmation.profile_id = p_profile_id
    and confirmation.status = 'active'
    and revision.status in ('profile_confirmed', 'global_approved')
    and (
      revision.owner_profile_id = p_profile_id
      or revision.status = 'global_approved'
    );

  if v_response is null then
    raise exception using
      errcode = 'P0002', message = 'product_confirmation_not_found';
  end if;
  return v_response;
end;
$$;
