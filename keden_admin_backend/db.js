/**
 * db.js — Data Access Layer via Supabase
 * Supabase — единственная база данных. SQLite удалён.
 * Все методы async — сигнатура вызывающего кода обновлена соответственно.
 */

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const SUPABASE_URL = 'https://qklfgwicqcxmrdhdyuyp.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrbGZnd2ljcWN4bXJkaGR5dXlwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg4NDg3MiwiZXhwIjoyMDg3NDYwODcyfQ.mIsmrwmXTjRpLA5GUNYyEJw1PjODkpRDmLtpatthrGI';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Admin (хранится локально в памяти / env — не в Supabase) ───────────────────
// Логин/пароль admin — только для AdminPanel, не для пользователей расширения
let adminData = {
  username: 'admin',
  password_hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10)
};

module.exports = {

  // ── Admin ────────────────────────────────────────────────────────────────
  getAdmin: () => adminData,
  updateAdminPassword: (hash) => { adminData.password_hash = hash; },

  // ── Users ────────────────────────────────────────────────────────────────
  getUsers: async () => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data;
  },

  getUserByIin: async (iin) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('iin', iin)
      .single();
    if (error) return null;
    return data;
  },

  getUserById: async (id) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return data;
  },

  addUser: async (iin, fio, is_allowed = false) => {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('iin', iin)
      .single();
    if (existing) throw new Error('UNIQUE constraint failed: users.iin');

    const { data, error } = await supabase
      .from('users')
      .insert({
        iin,
        fio: fio || '',
        is_allowed: !!is_allowed,
        subscription_end: null,
        credits: 10,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  upsertUser: async (iin, fio) => {
    // Upsert: создать если нет, или обновить last_active если есть
    const { data, error } = await supabase
      .from('users')
      .upsert({
        iin,
        fio: fio || '',
        is_allowed: false, // новые пользователи по умолчанию не активны
        credits: 10,
      }, { onConflict: 'iin', ignoreDuplicates: false })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  updateUser: async (id, updates) => {
    const supabaseUpdates = {};
    if (updates.fio !== undefined) supabaseUpdates.fio = updates.fio;
    if (updates.is_allowed !== undefined) supabaseUpdates.is_allowed = updates.is_allowed === 1 || updates.is_allowed === true;
    if (updates.subscription_end !== undefined) supabaseUpdates.subscription_end = updates.subscription_end || null;
    if (updates.credits !== undefined) supabaseUpdates.credits = parseInt(updates.credits, 10) || 0;
    if (updates.last_active !== undefined) supabaseUpdates.last_active = updates.last_active;

    const { data, error } = await supabase
      .from('users')
      .update(supabaseUpdates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  deleteUser: async (id) => {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);
    return !error;
  },

  // ── Logs ─────────────────────────────────────────────────────────────────
  getLogs: async (options = {}) => {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const offset = (page - 1) * limit;

    let query = supabase.from('logs').select('*', { count: 'exact' });
    if (options.iin) query = query.eq('user_iin', options.iin);
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: logs, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      logs: logs || [],
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    };
  },

  addLog: async (entry) => {
    const { data, error } = await supabase
      .from('logs')
      .insert({
        user_iin: entry.user_iin || '',
        user_fio: entry.user_fio || '',
        action_type: entry.action_type,
        description: entry.description || '',
      })
      .select()
      .single();
    if (error) {
      console.error('[addLog] Error:', error.message);
      return null;
    }
    return data;
  },

  clearLogs: async () => {
    const { error } = await supabase.from('logs').delete().neq('id', 0);
    return !error;
  },

  // ── Stats ────────────────────────────────────────────────────────────────
  getStats: async () => {
    const [
      { count: totalUsers },
      { count: activeUsers },
      { count: totalLogs },
      { data: recentActivity }
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_allowed', true),
      supabase.from('logs').select('*', { count: 'exact', head: true }),
      supabase.from('logs').select('*').order('created_at', { ascending: false }).limit(10)
    ]);

    const today = new Date().toISOString().split('T')[0];
    const { count: todayLogs } = await supabase
      .from('logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00`);

    return {
      totalUsers: totalUsers || 0,
      activeUsers: activeUsers || 0,
      totalLogs: totalLogs || 0,
      todayLogs: todayLogs || 0,
      recentActivity: recentActivity || []
    };
  },

  // ── Кредиты: атомарный вычет ─────────────────────────────────────────────
  deductCredit: async (iin) => {
    // Читаем актуальное значение
    const { data: user } = await supabase
      .from('users')
      .select('id, credits')
      .eq('iin', iin)
      .single();
    if (!user || user.credits <= 0) return false;

    const { error } = await supabase
      .from('users')
      .update({ credits: user.credits - 1 })
      .eq('id', user.id)
      .eq('credits', user.credits); // оптимистичная блокировка
    return !error;
  }
};
