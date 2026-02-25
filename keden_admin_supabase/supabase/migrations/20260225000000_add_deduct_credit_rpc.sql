-- Migration: Add deduct_credit RPC function for atomic credit subtraction
-- Created: 2026-02-25

CREATE OR REPLACE FUNCTION deduct_credit(user_id uuid)
RETURNS SETOF users AS $$
  UPDATE users
  SET credits = credits - 1
  WHERE id = user_id AND credits > 0 AND is_allowed = true
  RETURNING *;
$$ LANGUAGE sql SECURITY DEFINER;
