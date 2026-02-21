import React, { useState, useEffect } from 'react';
import { api } from './api.js';

function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 30000);
        return () => clearInterval(interval);
    }, []);

    const loadStats = async () => {
        try {
            const data = await api.getStats();
            setStats(data);
        } catch (err) {
            console.error('Stats load error:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="loading-center"><div className="spinner" /></div>;
    }

    if (!stats) return null;

    const formatDate = (date) => {
        if (!date) return '—';
        const d = new Date(date + 'Z');
        return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div>
            <div className="page-header">
                <h2>📊 Дашборд</h2>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon">👥</div>
                    <div className="stat-value">{stats.totalUsers}</div>
                    <div className="stat-label">Всего пользователей</div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon">✅</div>
                    <div className="stat-value">{stats.activeUsers}</div>
                    <div className="stat-label">Активных</div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon">📋</div>
                    <div className="stat-value">{stats.totalLogs}</div>
                    <div className="stat-label">Всего действий</div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon">🔥</div>
                    <div className="stat-value">{stats.todayLogs}</div>
                    <div className="stat-label">Действий сегодня</div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3>🕐 Последняя активность</h3>
                </div>
                <div className="card-body">
                    {stats.recentActivity.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">📭</div>
                            <p>Пока нет действий</p>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>ИИН</th>
                                    <th>ФИО</th>
                                    <th>Действие</th>
                                    <th>Описание</th>
                                    <th>Время</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.recentActivity.map((log, i) => (
                                    <tr key={i}>
                                        <td style={{ fontFamily: 'monospace' }}>{log.user_iin}</td>
                                        <td>{log.user_fio || '—'}</td>
                                        <td><span className="badge badge-info">{log.action_type}</span></td>
                                        <td>{log.description || '—'}</td>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
