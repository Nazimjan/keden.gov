-- Create users table
CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    iin TEXT UNIQUE NOT NULL,
    fio TEXT,
    is_allowed BOOLEAN DEFAULT TRUE,
    subscription_end TIMESTAMP WITH TIME ZONE,
    credits INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create logs table
CREATE TABLE IF NOT EXISTS public.logs (
    id SERIAL PRIMARY KEY,
    user_iin TEXT,
    user_fio TEXT,
    action_type TEXT,
    description TEXT,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Basic policies (to be refined based on auth)
CREATE POLICY "Allow authenticated access to users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Allow authenticated access to logs" ON public.logs FOR SELECT USING (true);
