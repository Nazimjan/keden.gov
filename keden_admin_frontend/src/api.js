const API_BASE = '/api';

async function request(url, options = {}) {
    const token = localStorage.getItem('admin_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
    };

    const resp = await fetch(`${API_BASE}${url}`, { ...options, headers });
    const data = await resp.json();

    if (!resp.ok) {
        throw new Error(data.error || 'Ошибка сервера');
    }
    return data;
}

export const api = {
    // Auth
    login: (username, password) => request('/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    changePassword: (oldPassword, newPassword) => request('/admin/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),

    // Users
    getUsers: () => request('/admin/users'),
    addUser: (iin, fio) => request('/admin/users', { method: 'POST', body: JSON.stringify({ iin, fio }) }),
    updateUser: (id, data) => request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),

    // Logs
    getLogs: (page = 1, limit = 50, iin = '') => {
        const params = new URLSearchParams({ page, limit });
        if (iin) params.append('iin', iin);
        return request(`/admin/logs?${params}`);
    },
    clearLogs: () => request('/admin/logs', { method: 'DELETE' }),

    // Stats
    getStats: () => request('/admin/stats')
};
