-- RPC to toggle user access bypassing RLS
CREATE OR REPLACE FUNCTION toggle_user_access(user_id_param integer, allowed_param boolean)
RETURNS void AS $$
BEGIN
    UPDATE public.users
    SET is_allowed = allowed_param
    WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also ensure authenticated users can call it
GRANT EXECUTE ON FUNCTION toggle_user_access(integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_user_access(integer, boolean) TO service_role;
