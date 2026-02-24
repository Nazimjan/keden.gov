import { createClient } from '@supabase/supabase-js';

// Supabase details for Admin Frontend
export const SUPABASE_URL = 'https://qklfgwicqcxmrdhdyuyp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_BzW22spkneL4YLIr32qKmA_5qu0j42T';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
