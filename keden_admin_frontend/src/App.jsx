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
    const [initialized, setInitialized] = useState(false);
    const [recoveryMode, setRecoveryMode] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setInitialized(true);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            setSession(session);
            if (event === 'PASSWORD_RECOVERY') {
                setRecoveryMode(true);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleLogout = async () => {
        await api.logout();
        setPage('dashboard');
        setRecoveryMode(false);
    };

    const handleUpdatePassword = async (e) => {
        e.preventDefault();
        setUpdating(true);
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) {
            alert('ОШИБКА ОБНОВЛЕНИЯ КЛЮЧА: ' + error.message);
        } else {
            alert('КЛЮЧ ДОСТУПА УСПЕШНО ОБНОВЛЕН');
            setRecoveryMode(false);
        }
        setUpdating(false);
    };

    if (!initialized) {
        return (
          <div className="login-container">
            <div className="mono" style={{ color: 'var(--text-accent)' }}>ИНИЦИАЛИЗАЦИЯ ЦЕНТРА УПРАВЛЕНИЯ...</div>
          </div>
        );
    }

    if (!session) {
        return <Login />;
    }

    if (recoveryMode) {
        return (
            <div className="login-container">
                <div className="login-card reveal">
                    <div className="logo">
                        <h1 style={{ color: 'var(--warning)' }}>⚡ ВОССТАНОВЛЕНИЕ</h1>
                        <p>УСТАНОВКА НОВОГО ПАРОЛЯ</p>
                    </div>
                    <form onSubmit={handleUpdatePassword}>
                        <div className="form-group">
                            <label>НОВЫЙ ПАРОЛЬ</label>
                            <input 
                                type="password" 
                                value={newPassword} 
                                onChange={e => setNewPassword(e.target.value)}
                                placeholder="МИНИМУМ 6 СИМВОЛОВ"
                                required 
                            />
                        </div>
                        <button type="submit" className="btn btn-primary btn-full" disabled={updating}>
                            {updating ? 'ОБНОВЛЕНИЕ...' : 'ОБНОВИТЬ ПАРОЛЬ'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <h2>⚡ KEDEN</h2>
                    <span>АДМИН V2.5.0</span>
                </div>

                <nav className="sidebar-nav">
                    <a
                        href="#"
                        className={page === 'dashboard' ? 'active' : ''}
                        onClick={(e) => { e.preventDefault(); setPage('dashboard'); }}
                    >
                        <span className="icon">📊</span>
                        ДАШБОРД
                    </a>
                    <a
                        href="#"
                        className={page === 'users' ? 'active' : ''}
                        onClick={(e) => { e.preventDefault(); setPage('users'); }}
                    >
                        <span className="icon">👥</span>
                        ПОЛЬЗОВАТЕЛИ
                    </a>
                    <a
                        href="#"
                        className={page === 'logs' ? 'active' : ''}
                        onClick={(e) => { e.preventDefault(); setPage('logs'); }}
                    >
                        <span className="icon">📋</span>
                        ЖУРНАЛ ДЕЙСТВИЙ
                    </a>
                </nav>

                <div className="sidebar-footer">
                    <div className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                       АДМИН: {session.user.email?.split('@')[0].toUpperCase()}
                    </div>
                    <button className="btn btn-outline btn-full btn-sm" onClick={handleLogout}>
                        🚪 ЗАВЕРШИТЬ СЕАНС
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
