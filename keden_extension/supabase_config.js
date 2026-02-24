// Supabase Configuration for Keden Extension
const SUPABASE_CONFIG = {
    URL: 'https://qklfgwicqcxmrdhdyuyp.supabase.co',
    ANON_KEY: 'sb_publishable_BzW22spkneL4YLIr32qKmA_5qu0j42T',
    EDGE_FUNCTION_URL: 'https://qklfgwicqcxmrdhdyuyp.supabase.co/functions/v1/extract-ai'
};

// For development convenience
if (typeof module !== 'undefined') {
    module.exports = SUPABASE_CONFIG;
}
