-- Add block_reason column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason TEXT DEFAULT NULL;
