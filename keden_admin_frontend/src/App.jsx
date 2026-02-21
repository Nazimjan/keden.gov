import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import Users from './Users.jsx';
import Logs from './Logs.jsx';

function App() {
    const [token, setToken] = useState(localStorage.getItem('admin_token'));
    const [page, setPage] = useState('dashboard');

    const handleLogin = (newToken) => {
        localStorage.setItem('admin_token', newToken);
        setToken(newToken);
    };

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        setToken(null);
        setPage('dashboard');
    };

    if (!token) {
        return <Login onLogin={handleLogin} />;
    }

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <h2>⚡ Keden Admin</h2>
                    <span>Управление расширением</span>
                </div>

                <nav className="sidebar-nav">
                    <a
                        href="#"
                        className={page === 'dashboard' ? 'active' : ''}
                        onClick={(e) => { e.preventDefault(); setPage('dashboard'); }}
                    >
                        <span className="icon">📊</span>
                        Дашборд
                    </a>
                    <a
                        href="#"
                        className={page === 'users' ? 'active' : ''}
                        onClick={(e) => { e.preventDefault(); setPage('users'); }}
                    >
                        <span className="icon">👥</span>
                        Пользователи
                    </a>
                    <a
                        href="#"
                        className={page === 'logs' ? 'active' : ''}
                        onClick={(e) => { e.preventDefault(); setPage('logs'); }}
                    >
                        <span className="icon">📋</span>
                        Логи
                    </a>
                </nav>

                <div className="sidebar-footer">
                    <button className="btn btn-outline btn-full btn-sm" onClick={handleLogout}>
                        🚪 Выйти
                    </button>
                </div>
            </aside>

            <main className="main-content">
                {page === 'dashboard' && <Dashboard />}
                {page === 'users' && <Users />}
                {page === 'logs' && <Logs />}
            </main>
        </div>
    );
}

export default App;
