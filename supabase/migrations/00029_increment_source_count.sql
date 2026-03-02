-- Atomic source_count increment for when multiple collectors discover the same place.
-- Called from server/collectors/*.ts via supabaseAdmin.rpc().
CREATE OR REPLACE FUNCTION increment_source_count(p_place_id INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE places
  SET
    source_count = source_count + 1,
    updated_at   = now()
  WHERE id = p_place_id;
$$;
