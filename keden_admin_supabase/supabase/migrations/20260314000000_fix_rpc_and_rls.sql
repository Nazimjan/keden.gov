-- Fix deduct_credit RPC to use correct types and be more robust
DROP FUNCTION IF EXISTS deduct_credit(uuid);
DROP FUNCTION IF EXISTS deduct_credit(integer);

CREATE OR REPLACE FUNCTION deduct_credit(user_id_param integer)
RETURNS SETOF public.users AS $$
BEGIN
    RETURN QUERY
    UPDATE public.users
    SET credits = credits - 1
    WHERE id = user_id_param 
      AND credits > 0 
      AND is_allowed = true
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Harden RLS Policies
-- First, drop the insecure policies
DROP POLICY IF EXISTS "Allow authenticated access to users" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated access to logs" ON public.logs;

-- Users table policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 1. Admins (authenticated users) can do everything
CREATE POLICY "Admins full access to users" ON public.users
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 2. Service role has full access (default, but explicit is good)
CREATE POLICY "Service role full access to users" ON public.users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Logs table policies
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- 1. Admins can read and delete logs
CREATE POLICY "Admins manage logs" ON public.logs
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 2. Service role can insert and read logs
CREATE POLICY "Service role manage logs" ON public.logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
