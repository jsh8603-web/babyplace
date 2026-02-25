-- Allow authenticated users to insert their own profile (needed for OAuth callback)
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
