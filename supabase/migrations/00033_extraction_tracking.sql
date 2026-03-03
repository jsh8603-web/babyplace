-- Track match outcomes for DROP analysis.
ALTER TABLE llm_extraction_results
  ADD COLUMN IF NOT EXISTS match_result TEXT,
  ADD COLUMN IF NOT EXISTS kakao_best_score REAL,
  ADD COLUMN IF NOT EXISTS llm_confidence REAL;

CREATE INDEX IF NOT EXISTS idx_llm_extraction_match_result
  ON llm_extraction_results(match_result);
