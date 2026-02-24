/**
 * migrate.js — Одноразовый скрипт миграции данных из data.json в SQLite.
 * Запускать только ОДИН РАЗ: node migrate.js
 * После успешного выполнения переименует data.json в data.backup.json.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_JSON_PATH = path.join(__dirname, 'data.json');
const BACKUP_PATH = path.join(__dirname, 'data.backup.json');
const SQLITE_PATH = path.join(__dirname, 'database.sqlite');

// Проверяем, что data.json существует
if (!fs.existsSync(DATA_JSON_PATH)) {
    console.log('✅ data.json не найден — скорее всего, миграция уже была выполнена или данных нет.');
    process.exit(0);
}

if (fs.existsSync(SQLITE_PATH)) {
    console.log('⚠️  database.sqlite уже существует. Удалите его вручную, если хотите повторить миграцию.');
    process.exit(1);
}

// Читаем старые данные
const raw = fs.readFileSync(DATA_JSON_PATH, 'utf-8');
const data = JSON.parse(raw);

const db = new Database(SQLITE_PATH);

// Включаем WAL сразу
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Создаём схему ────────────────────────────────────────────────────────────
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

console.log('✅ Схема SQLite создана.');

// ── Миграция в рамках одной транзакции ───────────────────────────────────────
const migrate = db.transaction(() => {
    // 1. Admins
    if (data.admin) {
        db.prepare('INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)')
            .run(data.admin.username, data.admin.password_hash);
        console.log(`✅ Admin "${data.admin.username}" перенесён.`);
    }

    // 2. Users
    const insertUser = db.prepare(`
        INSERT OR IGNORE INTO users (id, iin, fio, is_allowed, subscription_end, credits, created_at, last_active)
        VALUES (@id, @iin, @fio, @is_allowed, @subscription_end, @credits, @created_at, @last_active)
    `);

    for (const u of (data.users || [])) {
        insertUser.run({
            id: u.id,
            iin: u.iin,
            fio: u.fio || '',
            is_allowed: u.is_allowed ? 1 : 0,
            subscription_end: u.subscription_end || null,
            credits: u.credits || 0,
            created_at: u.created_at || new Date().toISOString(),
            last_active: u.last_active || null
        });
    }
    console.log(`✅ Пользователи перенесены: ${(data.users || []).length}`);

    // 3. Logs — привязываемся к user_id через iin
    const getUserIdByIin = db.prepare('SELECT id FROM users WHERE iin = ?');
    const insertLog = db.prepare(`
        INSERT INTO logs (id, user_id, user_iin, user_fio, action_type, description, ip_address, created_at)
        VALUES (@id, @user_id, @user_iin, @user_fio, @action_type, @description, @ip_address, @created_at)
    `);

    let logsMigrated = 0;
    let logsSkipped = 0;
    for (const l of (data.logs || [])) {
        const userRow = getUserIdByIin.get(l.user_iin);
        if (!userRow) {
            logsSkipped++;
            continue; // Лог без пользователя — пропускаем
        }
        insertLog.run({
            id: l.id,
            user_id: userRow.id,
            user_iin: l.user_iin,
            user_fio: l.user_fio || '',
            action_type: l.action_type,
            description: l.description || '',
            ip_address: l.ip_address || '',
            created_at: l.created_at || new Date().toISOString()
        });
        logsMigrated++;
    }
    console.log(`✅ Логи перенесены: ${logsMigrated}, пропущено (без user): ${logsSkipped}`);
});

migrate();

db.close();

// Переименовываем старый файл как резервную копию
fs.renameSync(DATA_JSON_PATH, BACKUP_PATH);
console.log(`✅ Миграция завершена. data.json переименован в data.backup.json`);
console.log(`🎯 Запустите сервер: node server.js`);
