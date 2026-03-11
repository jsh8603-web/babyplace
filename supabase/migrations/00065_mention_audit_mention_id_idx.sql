-- Index on mention_audit_log.mention_id for FK cascade delete performance
-- Without this index, deleting blog_mentions rows triggers full table scan on 180K+ rows
CREATE INDEX IF NOT EXISTS idx_mention_audit_mention_id ON mention_audit_log(mention_id);
