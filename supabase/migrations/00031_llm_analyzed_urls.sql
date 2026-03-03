-- Track URLs already analyzed by LLM to avoid re-processing across sessions
CREATE TABLE IF NOT EXISTS llm_analyzed_urls (
  url TEXT PRIMARY KEY,
  analyzed_at TIMESTAMPTZ DEFAULT now()
);

-- Backfill from existing blog_mentions
INSERT INTO llm_analyzed_urls (url, analyzed_at)
SELECT DISTINCT url, collected_at FROM blog_mentions
WHERE url IS NOT NULL
ON CONFLICT (url) DO NOTHING;
