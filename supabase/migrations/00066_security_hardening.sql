-- 00066: Security hardening
-- Fixes: RLS on 17 unprotected tables, function search_path,
--        RLS policy performance (auth.uid() → subquery), duplicate indexes

-- ============================================================
-- 1. Enable RLS on server-only tables (17 tables)
--    service_role bypasses RLS, so no policy needed for server scripts.
--    This blocks anon/authenticated access via PostgREST.
-- ============================================================

ALTER TABLE audit_metadata            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_blacklist_terms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_promotion_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_dedup_audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE excluded_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_analyzed_urls         ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_extraction_results    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mention_audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_accuracy_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_blacklist_patterns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_candidates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE poster_audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_counters       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Fix function search_path (prevent search_path hijack)
--    SET search_path = '' ensures fully-qualified table references.
-- ============================================================

-- 2a. update_updated_at (trigger)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 2b. update_event_scores_batch (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.update_event_scores_batch(updates_json text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE rec RECORD;
BEGIN
  FOR rec IN SELECT * FROM json_populate_recordset(
    null::record, updates_json::json
  ) AS x(id INT, score REAL)
  LOOP
    UPDATE public.events SET popularity_score = rec.score WHERE id = rec.id;
  END LOOP;
END;
$function$;

-- 2c. increment_event_mention_count (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.increment_event_mention_count(
  p_event_id integer, p_increment integer, p_last_mentioned_at timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.events SET
    mention_count = mention_count + p_increment,
    last_mentioned_at = GREATEST(last_mentioned_at, p_last_mentioned_at)
  WHERE id = p_event_id;
END;
$function$;

-- 2d. increment_irrelevant_count (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.increment_irrelevant_count(p_place_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.places
  SET irrelevant_mention_count = irrelevant_mention_count + 1
  WHERE id = p_place_id;
END;
$function$;

-- 2e. increment_mention_count
CREATE OR REPLACE FUNCTION public.increment_mention_count(
  p_place_id integer, p_increment integer, p_last_mentioned_at timestamp with time zone
)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $function$
  UPDATE public.places
  SET
    mention_count       = mention_count + p_increment,
    last_mentioned_at   = GREATEST(last_mentioned_at, p_last_mentioned_at)
  WHERE id = p_place_id;
$function$;

-- 2f. increment_source_count
CREATE OR REPLACE FUNCTION public.increment_source_count(p_place_id integer)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $function$
  UPDATE public.places
  SET
    source_count = source_count + 1,
    updated_at   = now()
  WHERE id = p_place_id;
$function$;

-- 2g. increment_rate_limit_counter (2-param overload)
CREATE OR REPLACE FUNCTION public.increment_rate_limit_counter(
  p_provider text, p_date date
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.rate_limit_counters (provider, date, count)
    VALUES (p_provider, p_date, 1)
  ON CONFLICT (provider, date)
    DO UPDATE SET count = public.rate_limit_counters.count + 1;
END;
$function$;

-- 2h. increment_rate_limit_counter (3-param overload)
CREATE OR REPLACE FUNCTION public.increment_rate_limit_counter(
  p_provider text, p_date date, p_increment integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.rate_limit_counters (provider, date, count)
    VALUES (p_provider, p_date, p_increment)
  ON CONFLICT (provider, date)
    DO UPDATE SET count = public.rate_limit_counters.count + p_increment;
END;
$function$;

-- ============================================================
-- 3. Fix RLS policies: auth.uid()/auth.role() → subquery form
--    Prevents per-row re-evaluation, improving performance.
-- ============================================================

-- 3a. favorites
DROP POLICY "Users manage own favorites" ON favorites;
CREATE POLICY "Users manage own favorites" ON favorites
  FOR ALL USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- 3b. profiles
DROP POLICY "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT USING ((select auth.uid()) = id);

DROP POLICY "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING ((select auth.uid()) = id);

DROP POLICY "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id);

DROP POLICY "Service role manages profiles" ON profiles;
CREATE POLICY "Service role manages profiles" ON profiles
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 3c. verification_checks
DROP POLICY "verification_checks_insert_own" ON verification_checks;
CREATE POLICY "verification_checks_insert_own" ON verification_checks
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

-- 3d. visits
DROP POLICY "Users manage own visits" ON visits;
CREATE POLICY "Users manage own visits" ON visits
  FOR ALL USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- 3e. user_hidden_items
DROP POLICY "Users manage own hidden items" ON user_hidden_items;
CREATE POLICY "Users manage own hidden items" ON user_hidden_items
  FOR ALL USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- 3f. places (service_role policies)
DROP POLICY "Only service_role can modify places" ON places;
CREATE POLICY "Only service_role can modify places" ON places
  FOR INSERT WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY "Only service_role can update places" ON places;
CREATE POLICY "Only service_role can update places" ON places
  FOR UPDATE USING ((select auth.role()) = 'service_role');

DROP POLICY "Only service_role can delete places" ON places;
CREATE POLICY "Only service_role can delete places" ON places
  FOR DELETE USING ((select auth.role()) = 'service_role');

-- 3g. events (service_role policies)
DROP POLICY "Only service_role can modify events" ON events;
CREATE POLICY "Only service_role can modify events" ON events
  FOR INSERT WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY "Only service_role can update events" ON events;
CREATE POLICY "Only service_role can update events" ON events
  FOR UPDATE USING ((select auth.role()) = 'service_role');

-- 3h. blog_mentions (service_role policy)
DROP POLICY "Only service_role can modify blog_mentions" ON blog_mentions;
CREATE POLICY "Only service_role can modify blog_mentions" ON blog_mentions
  FOR INSERT WITH CHECK ((select auth.role()) = 'service_role');

-- 3i. app_settings (service_role policy)
DROP POLICY "Only service_role can modify app_settings" ON app_settings;
CREATE POLICY "Only service_role can modify app_settings" ON app_settings
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 3j. audit_logs (service_role + admin policies)
DROP POLICY "service_role_can_insert_audit_logs" ON audit_logs;
CREATE POLICY "service_role_can_insert_audit_logs" ON audit_logs
  FOR INSERT WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY "admins_can_read_audit_logs" ON audit_logs;
CREATE POLICY "admins_can_read_audit_logs" ON audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid()) AND profiles.role = 'admin'
    )
  );

-- 3k. scoring_logs (admin policy)
DROP POLICY "scoring_logs_admin_all" ON scoring_logs;
CREATE POLICY "scoring_logs_admin_all" ON scoring_logs
  FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = (select auth.uid())) = 'admin')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = (select auth.uid())) = 'admin');

-- 3l. search_logs (service_role read policy)
DROP POLICY "Only service_role can read search_logs" ON search_logs;
CREATE POLICY "Only service_role can read search_logs" ON search_logs
  FOR SELECT USING ((select auth.role()) = 'service_role');

-- 3m. agent_kv (service_role policy)
DROP POLICY "service_role_only" ON agent_kv;
CREATE POLICY "service_role_only" ON agent_kv
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- ============================================================
-- 4. Drop duplicate indexes
-- ============================================================

DROP INDEX IF EXISTS idx_events_running;
-- keeps idx_events_dates (identical: start_date, end_date)

DROP INDEX IF EXISTS idx_verification_checks_place_id_verified_at;
-- keeps idx_verification_checks_place_id_recent (identical: place_id, verified_at DESC)

-- ============================================================
-- 5. Fix upsert_blacklist_term search_path
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_blacklist_term(p_term text, p_place_id integer, p_sample_title text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.blog_blacklist_terms (term, occurrence_count, distinct_place_count, seen_place_ids, sample_titles)
  VALUES (
    p_term, 1, 1,
    CASE WHEN p_place_id IS NOT NULL THEN ARRAY[p_place_id] ELSE '{}' END,
    CASE WHEN p_sample_title IS NOT NULL THEN ARRAY[p_sample_title] ELSE '{}' END
  )
  ON CONFLICT (term) DO UPDATE SET
    occurrence_count = public.blog_blacklist_terms.occurrence_count + 1,
    last_seen_at = now(),
    seen_place_ids = CASE
      WHEN p_place_id IS NOT NULL AND NOT (public.blog_blacklist_terms.seen_place_ids @> ARRAY[p_place_id])
      THEN array_append(public.blog_blacklist_terms.seen_place_ids, p_place_id)
      ELSE public.blog_blacklist_terms.seen_place_ids
    END,
    distinct_place_count = CASE
      WHEN p_place_id IS NOT NULL AND NOT (public.blog_blacklist_terms.seen_place_ids @> ARRAY[p_place_id])
      THEN public.blog_blacklist_terms.distinct_place_count + 1
      ELSE public.blog_blacklist_terms.distinct_place_count
    END,
    sample_titles = CASE
      WHEN array_length(public.blog_blacklist_terms.sample_titles, 1) IS NULL
        OR array_length(public.blog_blacklist_terms.sample_titles, 1) < 5
      THEN array_append(public.blog_blacklist_terms.sample_titles, p_sample_title)
      ELSE public.blog_blacklist_terms.sample_titles
    END;
END;
$function$;
