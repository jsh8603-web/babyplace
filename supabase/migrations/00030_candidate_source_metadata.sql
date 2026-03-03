-- Add source_metadata to place_candidates for blog post details
-- Used by auto-promote to create blog_mentions when promoting candidates to places
ALTER TABLE place_candidates
ADD COLUMN IF NOT EXISTS source_metadata JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN place_candidates.source_metadata IS 'Blog post metadata [{title, snippet, post_date, source_type}] for creating blog_mentions on promotion';
