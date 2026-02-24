require('dotenv').config({ path: '../keden_admin_backend/.env' });
const { createClient } = require('@supabase/supabase-js');
const db = require('../keden_admin_backend/db');

// Set these manually or via another .env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
    console.log('--- Migrating Users from SQLite to Supabase ---');
    const users = db.getUsers();
    console.log(`Found ${users.length} users in SQLite.`);

    for (const user of users) {
        const { iin, fio, is_allowed, subscription_end, credits } = user;

        const { data, error } = await supabase
            .from('users')
            .upsert({
                iin,
                fio,
                is_allowed: is_allowed === 1,
                subscription_end: subscription_end || null,
                credits: credits || 0
            }, { onConflict: 'iin' });

        if (error) {
            console.error(`Error migrating user ${iin}:`, error.message);
        } else {
            console.log(`Migrated user: ${iin} (${fio})`);
        }
    }
    console.log('--- Migration Finished ---');
}

migrate().catch(console.error);
