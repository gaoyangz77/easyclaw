-- Add email + password_hash columns for email/password authentication
-- Device-only users will have NULL values for these columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
