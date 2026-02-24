require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const { handleExtract } = require('./controllers/extract.controller');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'keden-admin-secret-key-2026';

// ── SECURITY: RATE LIMITING ──────────────────────────────────────────────────
const rateLimit = require('express-rate-limit');

// Общий лимит на все API
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов с одного IP
    message: { error: 'Too many requests, please try again later.' }
});

// Строгий лимит на авторизацию (защита от брутфорса и спам-регистраций)
const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 5, // максимум 5 попыток в минуту
    message: { error: 'Too many attempts, please slow down.' }
});

// Лимит на тяжелые операции (AI Extractions)
const extractLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // 20 экстракций в 15 минут
    message: { error: 'Extract limit reached. Please wait.' }
});

app.use(globalLimiter);

// ── SECURITY: CORS ───────────────────────────────────────────────────────────
const corsOptions = {
    origin: function (origin, callback) {
        // Разрешаем запросы только от расширения и (опционально) самого сервера для админки
        const allowedOrigins = [
            /^chrome-extension:\/\//, // Регулярка для расширений Chrome
            'http://localhost:3001',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://127.0.0.1:5173'
        ];

        if (!origin || allowedOrigins.some(pattern =>
            typeof pattern === 'string' ? pattern === origin : pattern.test(origin)
        )) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Rejected origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
};

app.use(cors(corsOptions));

// Лимит уменьшен до безопасного уровня (2МБ), так как сканы теперь идут через multipart/form-data
app.use(express.json({ limit: '2mb' }));

const multer = require('multer');
const os = require('os');
const upload = multer({ dest: os.tmpdir() }); // Сохраняем во временную папку ОС

// Логгер запросов для отладки
app.use((req, res, next) => {
    if (req.path === '/api/v1/extract') {
        console.log(`[REQ] ${req.method} ${req.path} - Body size: ${JSON.stringify(req.body).length} bytes`);
    } else {
        console.log(`[REQ] ${req.method} ${req.path}`);
    }
    next();
});

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
// EXTENSION API: Auth check (JWT-based Auto-registration)
// ============================================================
app.post('/api/ext/auth', authLimiter, (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'JWT token required' });
    }

    try {
        // Декодируем токен Кедена (без проверки подписи)
        const decoded = jwt.decode(token);

        if (!decoded || !decoded.iin) {
            return res.status(401).json({ error: 'Invalid Keden session' });
        }

        // Проверка срока жизни токена
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp && decoded.exp < now) {
            return res.status(401).json({ error: 'Keden session expired' });
        }

        const iin = decoded.iin;
        const fio = decoded.fullName || decoded.name || iin;

        // Авто-регистрация (Upsert)
        const user = db.upsertUser(iin, fio);

        if (!user || user.is_allowed === 0) {
            return res.status(403).json({
                allowed: false,
                message: 'Ваш доступ заблокирован или ожидает подтверждения администратором.'
            });
        }

        res.json({
            allowed: true,
            iin: user.iin,
            fio: user.fio,
            credits: user.credits,
            subscription_end: user.subscription_end
        });

    } catch (e) {
        console.error('Auth Error:', e);
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
});

// ============================================================
// EXTENSION API: AI Extract (SSE)
// ============================================================
app.post('/api/v1/extract', extractLimiter, upload.any(), handleExtract);

/**
 * Эндпоинт для анализа ОДИНОЧНОГО файла (для режима максимальной скорости)
 */
app.post('/api/v1/analyze-single', async (req, res) => {
    const { iin, fileName, parts } = req.body;
    if (!iin || !parts) return res.status(400).json({ error: 'Missing data' });

    try {
        const { analyzeFile } = require('./services/ai.service');
        const db = require('./db');

        const user = db.getUserByIin(iin);
        if (!user || (!user.subscription_end && user.credits <= 0)) {
            return res.status(403).json({ error: 'No credits' });
        }

        console.log(`[AI-Single] Starting: ${fileName} for ${iin}`);
        const result = await analyzeFile(parts, fileName);
        res.json(result);
    } catch (err) {
        console.error(`[AI-Single] Error ${fileName}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Эндпоинт для пакетного анализа (как работало старое стабильное расширение)
 */
app.post('/api/v1/analyze-batch', async (req, res) => {
    const { iin, fileParts, fileNames } = req.body;
    if (!iin || !fileParts || !fileNames) return res.status(400).json({ error: 'Missing data' });

    try {
        const { analyzeAllFiles } = require('./services/ai.service');
        const db = require('./db');

        const user = db.getUserByIin(iin);
        if (!user || (!user.subscription_end && user.credits <= 0)) {
            return res.status(403).json({ error: 'No credits' });
        }

        console.log(`[AI-Batch] Processing ${fileParts.length} files for ${iin}`);

        // analyzeAllFiles(fileParts, fileNames, onStatus)
        const result = await analyzeAllFiles(fileParts, fileNames, (msg) => {
            console.log(`[AI-Batch Status] ${msg}`);
        });

        res.json(result);
    } catch (err) {
        console.error(`[AI-Batch] Error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Эндпоинт для слияния массива результатов в финальный объект ПИ
 */
app.post('/api/v1/merge', async (req, res) => {
    const { results } = req.body;
    if (!Array.isArray(results)) return res.status(400).json({ error: 'Expected array of results' });

    try {
        const { mergeAgentResultsJS } = require('./services/merger');
        const finalData = mergeAgentResultsJS(results);
        res.json(finalData);
    } catch (err) {
        console.error(`[Merge] Error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================

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
