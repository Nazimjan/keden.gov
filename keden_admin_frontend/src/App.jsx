import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import Users from './Users.jsx';
import Logs from './Logs.jsx';

import { supabase } from './supabase.js';

function App() {
    const [session, setSession] = useState(null);
    const [page, setPage] = useState('dashboard');

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleLogout = async () => {
        await api.logout();
        setPage('dashboard');
    };

    if (!session) {
        return <Login onLogin={() => { }} />; // Login works with supabase auth directly
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
