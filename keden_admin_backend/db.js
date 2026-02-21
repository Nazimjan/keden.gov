const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

// Default structure
const DEFAULT_DATA = {
  admin: {
    username: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10)
  },
  users: [],
  logs: [],
  nextUserId: 1,
  nextLogId: 1
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('DB load error, using defaults:', e.message);
  }
  return { ...DEFAULT_DATA };
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// Initialize
let db = loadDB();
if (!fs.existsSync(DB_PATH)) {
  saveDB(db);
  console.log('Default admin created: admin / admin123');
}

module.exports = {
  // Admin
  getAdmin: () => db.admin,
  updateAdminPassword: (hash) => {
    db.admin.password_hash = hash;
    saveDB(db);
  },

  // Users
  getUsers: () => db.users,
  getUserByIin: (iin) => db.users.find(u => u.iin === iin),
  getUserById: (id) => db.users.find(u => u.id === id),
  addUser: (iin, fio, is_allowed = 0) => {
    if (db.users.find(u => u.iin === iin)) {
      throw new Error('UNIQUE');
    }
    const user = {
      id: db.nextUserId++,
      iin,
      fio,
      is_allowed,
      subscription_end: null,
      credits: 0,
      created_at: new Date().toISOString(),
      last_active: null
    };
    db.users.push(user);
    saveDB(db);
    return user;
  },
  updateUser: (id, updates) => {
    const idx = db.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    db.users[idx] = { ...db.users[idx], ...updates };
    saveDB(db);
    return db.users[idx];
  },
  deleteUser: (id) => {
    const idx = db.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    db.users.splice(idx, 1);
    saveDB(db);
    return true;
  },

  // Logs
  getLogs: (options = {}) => {
    let logs = [...db.logs];
    if (options.iin) {
      logs = logs.filter(l => l.user_iin === options.iin);
    }
    logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = logs.length;
    const page = options.page || 1;
    const limit = options.limit || 50;
    const offset = (page - 1) * limit;
    return {
      logs: logs.slice(offset, offset + limit),
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  },
  addLog: (entry) => {
    const log = {
      id: db.nextLogId++,
      ...entry,
      created_at: new Date().toISOString()
    };
    db.logs.push(log);
    // Keep max 10000 logs
    if (db.logs.length > 10000) {
      db.logs = db.logs.slice(-10000);
    }
    saveDB(db);
    return log;
  },
  clearLogs: () => {
    db.logs = [];
    saveDB(db);
    return true;
  },

  // Stats
  getStats: () => {
    const totalUsers = db.users.length;
    const activeUsers = db.users.filter(u => u.is_allowed).length;
    const totalLogs = db.logs.length;
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = db.logs.filter(l => l.created_at && l.created_at.startsWith(today)).length;

    const recentActivity = [...db.logs]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);

    return { totalUsers, activeUsers, totalLogs, todayLogs, recentActivity };
  }
};
