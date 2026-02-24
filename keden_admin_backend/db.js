/**
 * db.js — Data Access Layer (Repository Pattern)
 * Использует better-sqlite3 (синхронный SQLite).
 * Интерфейсы экспортируемых функций идентичны предыдущей реализации.
 */

const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const SQLITE_PATH = path.join(__dirname, 'database.sqlite');

const db = new Database(SQLITE_PATH);

// Перформанс и надёжность
db.pragma('journal_mode = WAL');        // Конкурентные чтения/записи
db.pragma('foreign_keys = ON');         // Каскадные удаления логов
db.pragma('synchronous = NORMAL');      // Баланс скорость/надёжность

// ── Инициализация схемы (CREATE TABLE IF NOT EXISTS) ─────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        iin TEXT NOT NULL UNIQUE,
        fio TEXT,
        is_allowed INTEGER NOT NULL DEFAULT 0,
        subscription_end TEXT,
        credits INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        last_active TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_iin ON users(iin);

    CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_iin TEXT NOT NULL,
        user_fio TEXT,
        action_type TEXT NOT NULL,
        description TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
`);

// ── Seed: создаём дефолтного admin если таблица пустая ───────────────────────
const adminCount = db.prepare('SELECT COUNT(*) as cnt FROM admins').get();
if (adminCount.cnt === 0) {
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
    .run('admin', bcrypt.hashSync('admin123', 10));
  console.log('Default admin created: admin / admin123');
}

// ─── Prepared statements (кэшируются для производительности) ─────────────────
const stmts = {
  getAdmin: db.prepare('SELECT * FROM admins WHERE username = ?'),
  updateAdminPwd: db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?'),

  getUsers: db.prepare('SELECT * FROM users ORDER BY id ASC'),
  getUserByIin: db.prepare('SELECT * FROM users WHERE iin = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  addUser: db.prepare(`
                        INSERT INTO users (iin, fio, is_allowed, subscription_end, credits, created_at, last_active)
                        VALUES (@iin, @fio, @is_allowed, @subscription_end, @credits, @created_at, @last_active)
                    `),
  upsertUser: db.prepare(`
        INSERT INTO users (iin, fio, is_allowed, credits, created_at, last_active)
        VALUES (@iin, @fio, 1, 10, @now, @now)
        ON CONFLICT(iin) DO UPDATE SET
            fio = excluded.fio,
            last_active = excluded.last_active
    `),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  addLog: db.prepare(`
                        INSERT INTO logs (user_id, user_iin, user_fio, action_type, description, ip_address, created_at)
                        VALUES (@user_id, @user_iin, @user_fio, @action_type, @description, @ip_address, @created_at)
                    `),
  clearLogs: db.prepare('DELETE FROM logs'),
  countLogs: db.prepare('SELECT COUNT(*) as total FROM logs'),
  countLogsByIin: db.prepare('SELECT COUNT(*) as total FROM logs WHERE user_iin = ?'),

  logsByPage: db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT ? OFFSET ?'),
  logsByIin: db.prepare('SELECT * FROM logs WHERE user_iin = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'),

  // Атомарный UPDATE — защита от Race Condition при списании кредитов
  deductCredit: db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Динамически формирует UPDATE users SET k1=?,k2=? WHERE id=? */
function buildUpdateUser(id, updates) {
  const allowed = ['fio', 'is_allowed', 'subscription_end', 'credits', 'last_active'];
  const keys = Object.keys(updates).filter(k => allowed.includes(k));
  if (keys.length === 0) return null;
  const setClauses = keys.map(k => `${k} = @${k}`).join(', ');
  return db.prepare(`UPDATE users SET ${setClauses} WHERE id = @id`);
}

// ─── Exports: публичный интерфейс (идентичен старому db.js) ──────────────────
module.exports = {

  // ── Admin ──────────────────────────────────────────────────────────────────
  getAdmin: () => {
    return stmts.getAdmin.get('admin');
  },
  updateAdminPassword: (hash) => {
    stmts.updateAdminPwd.run(hash, 'admin');
  },

  // ── Users ──────────────────────────────────────────────────────────────────
  getUsers: () => {
    return stmts.getUsers.all();
  },
  getUserByIin: (iin) => {
    return stmts.getUserByIin.get(iin) || null;
  },
  getUserById: (id) => {
    return stmts.getUserById.get(id) || null;
  },
  addUser: (iin, fio, is_allowed = 0) => {
    const existing = stmts.getUserByIin.get(iin);
    if (existing) throw new Error('UNIQUE constraint failed: users.iin');
    const now = new Date().toISOString();
    const info = stmts.addUser.run({
      iin, fio: fio || '',
      is_allowed: is_allowed ? 1 : 0,
      subscription_end: null,
      credits: 10, // Default trial credits
      created_at: now,
      last_active: null
    });
    return stmts.getUserById.get(info.lastInsertRowid);
  },
  upsertUser: (iin, fio) => {
    const now = new Date().toISOString();
    stmts.upsertUser.run({ iin, fio: fio || '', now });
    return stmts.getUserByIin.get(iin);
  },
  updateUser: (id, updates) => {
    // Если нужно только atомарно списать кредиты — используем спецзапрос
    if (Object.keys(updates).length === 1 && updates.credits !== undefined) {
      const user = stmts.getUserById.get(id);
      if (!user) return null;
      // Вычисляем, нужно ли спецзапрос (deductCredit) или обычный UPDATE
      if (updates.credits === user.credits - 1) {
        stmts.deductCredit.run(id);
      } else {
        db.prepare('UPDATE users SET credits = @credits WHERE id = @id').run({ credits: updates.credits, id });
      }
      return stmts.getUserById.get(id);
    }

    const stmt = buildUpdateUser(id, updates);
    if (!stmt) return stmts.getUserById.get(id) || null;
    stmt.run({ ...updates, id });
    return stmts.getUserById.get(id) || null;
  },
  deleteUser: (id) => {
    const info = stmts.deleteUser.run(id);
    return info.changes > 0;
  },

  // ── Logs ───────────────────────────────────────────────────────────────────
  getLogs: (options = {}) => {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const offset = (page - 1) * limit;

    let logs, total;
    if (options.iin) {
      total = stmts.countLogsByIin.get(options.iin).total;
      logs = stmts.logsByIin.all(options.iin, limit, offset);
    } else {
      total = stmts.countLogs.get().total;
      logs = stmts.logsByPage.all(limit, offset);
    }

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  },
  addLog: (entry) => {
    const user = stmts.getUserByIin.get(entry.user_iin);
    const user_id = user ? user.id : 0; // 0 если пользователь не найден
    const now = new Date().toISOString();
    const info = stmts.addLog.run({
      user_id,
      user_iin: entry.user_iin || '',
      user_fio: entry.user_fio || '',
      action_type: entry.action_type,
      description: entry.description || '',
      ip_address: entry.ip_address || '',
      created_at: now
    });
    return { id: info.lastInsertRowid, ...entry, created_at: now };
  },
  clearLogs: () => {
    stmts.clearLogs.run();
    return true;
  },

  // ── Stats ──────────────────────────────────────────────────────────────────
  getStats: () => {
    const { total: totalUsers } = db.prepare('SELECT COUNT(*) as total FROM users').get();
    const { total: activeUsers } = db.prepare('SELECT COUNT(*) as total FROM users WHERE is_allowed = 1').get();
    const { total: totalLogs } = stmts.countLogs.get();
    const today = new Date().toISOString().split('T')[0];
    const { total: todayLogs } = db.prepare(
      "SELECT COUNT(*) as total FROM logs WHERE created_at LIKE ?"
    ).get(`${today}%`);
    const recentActivity = db.prepare(
      'SELECT * FROM logs ORDER BY created_at DESC LIMIT 10'
    ).all();

    return { totalUsers, activeUsers, totalLogs, todayLogs, recentActivity };
  }
};
