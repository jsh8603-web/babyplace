-- Intermediate storage for LLM extraction results.
-- Enables replay of Kakao/DB matching without re-running LLM.
CREATE TABLE IF NOT EXISTS llm_extraction_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id TEXT NOT NULL,
  keyword_id INT,
  keyword TEXT NOT NULL,
  blog_url TEXT NOT NULL,
  blog_title TEXT,
  blog_snippet TEXT,
  blog_postdate TEXT,
  extracted_name TEXT,
  extracted_addr TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_llm_extraction_batch ON llm_extraction_results(batch_id);
