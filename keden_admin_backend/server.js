const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = 3001;
const JWT_SECRET = 'keden-admin-secret-key-2026';

app.use(cors());
app.use(express.json());

// ============================================================
// Middleware: Admin JWT Auth
// ============================================================
function adminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ============================================================
// ADMIN AUTH ROUTES
// ============================================================
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const admin = db.getAdmin();
    if (username !== admin.username) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = bcrypt.compareSync(password, admin.password_hash);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: admin.username });
});

app.post('/api/admin/change-password', adminAuth, (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const admin = db.getAdmin();

    if (!bcrypt.compareSync(oldPassword, admin.password_hash)) {
        return res.status(400).json({ error: 'Старый пароль неверный' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.updateAdminPassword(hash);
    res.json({ success: true });
});

// ============================================================
// ADMIN: User Management
// ============================================================
app.get('/api/admin/users', adminAuth, (req, res) => {
    res.json(db.getUsers());
});

app.post('/api/admin/users', adminAuth, (req, res) => {
    const { iin, fio } = req.body;
    if (!iin || !fio) {
        return res.status(400).json({ error: 'ИИН и ФИО обязательны' });
    }
    if (iin.length !== 12) {
        return res.status(400).json({ error: 'ИИН должен содержать 12 цифр' });
    }

    try {
        const user = db.addUser(iin, fio, 1); // <--- Admin manual addition gets is_allowed=1
        res.json(user);
    } catch (e) {
        if (e.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Пользователь с таким ИИН уже существует' });
        }
        return res.status(500).json({ error: e.message });
    }
});

app.put('/api/admin/users/:id', adminAuth, (req, res) => {
    const { is_allowed, fio, subscription_end, credits } = req.body;
    const id = parseInt(req.params.id);
    const user = db.getUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updates = {};
    if (fio !== undefined) updates.fio = fio;
    if (is_allowed !== undefined) updates.is_allowed = is_allowed ? 1 : 0;
    if (subscription_end !== undefined) updates.subscription_end = subscription_end;
    if (credits !== undefined) updates.credits = parseInt(credits, 10) || 0;

    const updated = db.updateUser(id, updates);
    res.json(updated);
});

app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const result = db.deleteUser(id);
    if (!result) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
});

// ============================================================
// ADMIN: Logs
// ============================================================
app.get('/api/admin/logs', adminAuth, (req, res) => {
    const { page = 1, limit = 50, iin } = req.query;
    const result = db.getLogs({ page: parseInt(page), limit: parseInt(limit), iin });
    res.json(result);
});

app.delete('/api/admin/logs', adminAuth, (req, res) => {
    db.clearLogs();
    res.json({ success: true });
});

// ============================================================
// ADMIN: Dashboard Stats
// ============================================================
app.get('/api/admin/stats', adminAuth, (req, res) => {
    res.json(db.getStats());
});

// ============================================================
// EXTENSION API: Auth check
// ============================================================
app.post('/api/ext/auth', (req, res) => {
    const { iin, fio } = req.body;
    if (!iin) return res.status(400).json({ allowed: false, error: 'ИИН обязателен' });

    let user = db.getUserByIin(iin);

    // Auto-register new users on first extension launch
    if (!user) {
        try {
            user = db.addUser(iin, fio || iin);
            console.log(`[Auto-register] New user: ${iin} - ${fio}`);
        } catch (e) {
            return res.json({ allowed: false, message: 'Ошибка регистрации: ' + e.message });
        }
    }

    if (!user.is_allowed) {
        return res.json({ allowed: false, message: 'Доступ заблокирован администратором.' });
    }

    const now = new Date();
    let hasSubscription = false;
    if (user.subscription_end && new Date(user.subscription_end) > now) {
        hasSubscription = true;
    }

    if (!hasSubscription && user.credits <= 0) {
        return res.json({ allowed: false, message: 'Доступ закрыт: истекла подписка или закончились кредиты.', user: { iin: user.iin, fio: user.fio, status: 'expired' } });
    }

    // Update last_active and fio if changed
    db.updateUser(user.id, { last_active: now.toISOString(), fio: fio || user.fio });

    res.json({
        allowed: true,
        user: {
            iin: user.iin,
            fio: user.fio,
            hasSubscription,
            subscription_end: user.subscription_end,
            credits: user.credits
        }
    });
});

// ============================================================
// EXTENSION API: Log action
// ============================================================
app.post('/api/ext/log', (req, res) => {
    const { iin, fio, action_type, description } = req.body;
    if (!iin || !action_type) {
        return res.status(400).json({ error: 'iin and action_type required' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    db.addLog({ user_iin: iin, user_fio: fio || '', action_type, description: description || '', ip_address: ip });

    if (action_type === 'FILL_PI') {
        const user = db.getUserByIin(iin);
        if (user) {
            const hasSubscription = user.subscription_end && new Date(user.subscription_end) > new Date();
            // Deduct a credit only if they don't have an active subscription and have credits
            if (!hasSubscription && user.credits > 0) {
                db.updateUser(user.id, { credits: user.credits - 1 });
            }
        }
    }

    res.json({ success: true });
});

// ============================================================
// Start
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 Keden Admin Backend running on http://localhost:${PORT}`);
});
