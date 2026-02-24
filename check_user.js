const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://qklfgwicqcxmrdhdyuyp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BzW22spkneL4YLIr32qKmA_5qu0j42T';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkUser() {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('iin', '890103300211')
        .single();

    if (error) {
        console.error('Error fetching user:', error.message);
    } else {
        console.log('User data:', data);
    }
}

checkUser();
