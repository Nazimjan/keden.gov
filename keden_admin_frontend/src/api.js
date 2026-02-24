import { supabase } from './supabase';

export const api = {
    // Auth - Using Supabase Auth
    login: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        return { token: data.session.access_token };
    },

    logout: async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('admin_token');
    },

    // Users
    getUsers: async () => {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    addUser: async (iin, fio) => {
        const { data, error } = await supabase
            .from('users')
            .insert([{ iin, fio, credits: 10 }])
            .select();
        if (error) throw error;
        return data[0];
    },

    updateUser: async (id, updates) => {
        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', id)
            .select();
        if (error) throw error;
        return data[0];
    },

    deleteUser: async (id) => {
        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', id);
        if (error) throw error;
        return true;
    },

    // Logs
    getLogs: async (page = 1, limit = 50, iin = '') => {
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase
            .from('logs')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);

        if (iin) {
            query = query.eq('user_iin', iin);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        return {
            items: data,
            total: count,
            pages: Math.ceil(count / limit)
        };
    },

    clearLogs: async () => {
        // Warning: Supabase requires a filter for DELETE unless configured otherwise.
        // We'll use a hack to delete all or just a filter that matches everything.
        const { error } = await supabase
            .from('logs')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete everything
        if (error) throw error;
        return true;
    },

    // Stats
    getStats: async () => {
        const [
            { count: totalUsers },
            { count: totalLogs },
            { count: activeUsers },
            { count: todayLogs },
            { data: recentActivity }
        ] = await Promise.all([
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('logs').select('*', { count: 'exact', head: true }),
            supabase.from('users').select('*', { count: 'exact', head: true })
                .eq('is_allowed', true)
                .or(`subscription_end.gt.${new Date().toISOString()},credits.gt.0`),
            supabase.from('logs').select('*', { count: 'exact', head: true })
                .gt('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
            supabase.from('logs').select('*').order('created_at', { ascending: false }).limit(10)
        ]);

        return {
            totalUsers: totalUsers || 0,
            activeUsers: activeUsers || 0,
            totalLogs: totalLogs || 0,
            todayLogs: todayLogs || 0,
            recentActivity: recentActivity || []
        };
    }
};
