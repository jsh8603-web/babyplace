-- Allow batch increment for rate_limit_counters (performance: flush once per pipeline)
CREATE OR REPLACE FUNCTION increment_rate_limit_counter(
  p_provider TEXT,
  p_date DATE,
  p_increment INT DEFAULT 1
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rate_limit_counters (provider, date, count)
    VALUES (p_provider, p_date, p_increment)
  ON CONFLICT (provider, date)
    DO UPDATE SET count = rate_limit_counters.count + p_increment;
END;
$$;
