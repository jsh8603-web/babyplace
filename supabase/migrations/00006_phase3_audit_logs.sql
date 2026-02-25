-- Phase 3: Audit logs for admin activity tracking
--
-- This table records all admin actions (place edits, merges, keyword changes, role changes)
-- enabling accountability and allowing admins to track system changes.
--
-- RLS:
-- - service_role can INSERT (backend admin actions)
-- - Admins (role='admin') can SELECT (read their own activities)

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  admin_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy 1: service_role can INSERT (used by Next.js API routes)
CREATE POLICY "service_role_can_insert_audit_logs"
  ON audit_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Policy 2: Admins can SELECT (read all audit logs if they are admin)
CREATE POLICY "admins_can_read_audit_logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Indexes for fast queries
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_admin ON audit_logs(admin_id);
