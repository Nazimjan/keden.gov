import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import { formatActionType } from './utils.js';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';

function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        try {
            const data = await api.getStats();
            setStats(data);
        } catch (err) {
            console.error('Ошибка статистики:', err);
        } finally {
            setLoading(false);
        }
    };

    const chartData = [
      { name: 'Пн', value: 400 },
      { name: 'Вт', value: 300 },
      { name: 'Ср', value: 600 },
      { name: 'Чт', value: 800 },
      { name: 'Пт', value: 500 },
      { name: 'Сб', value: 200 },
      { name: 'Вс', value: 300 },
    ];

    if (loading) {
      return (
        <div className="loading-state">
          <div className="mono">ИНИЦИАЛИЗАЦИЯ СИСТЕМЫ...</div>
        </div>
      );
    }

    return (
        <div className="reveal">
            <header className="page-header">
                <div>
                    <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>ОБЩАЯ СТАТИСТИКА</span>
                    <h2>ПАНЕЛЬ УПРАВЛЕНИЯ</h2>
                </div>
                <div className="admin-actions">
                  <button className="btn btn-outline" onClick={loadStats}>
                    🔄 СИНХРОНИЗАЦИЯ
                  </button>
                </div>
            </header>

            <div className="stats-grid">
                <div className="stat-card reveal stagger-1">
                    <div className="stat-icon">👥</div>
                    <div className="stat-value">{stats?.totalUsers || 0}</div>
                    <div className="stat-label">Всего пользователей</div>
                </div>
                <div className="stat-card reveal stagger-2">
                    <div className="stat-icon">⚡</div>
                    <div className="stat-value">{stats?.activeUsers || 0}</div>
                    <div className="stat-label">Активных сессий</div>
                </div>
                <div className="stat-card reveal stagger-3">
                    <div className="stat-icon">📑</div>
                    <div className="stat-value">{stats?.totalLogs || 0}</div>
                    <div className="stat-label">Всего действий</div>
                </div>
                <div className="stat-card reveal stagger-4">
                    <div className="stat-icon">🔥</div>
                    <div className="stat-value">{stats?.todayLogs || 0}</div>
                    <div className="stat-label">Действий за 24ч</div>
                </div>
            </div>

            <div className="grid-2 reveal stagger-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '40px' }}>
              <div className="card">
                <div className="card-header">
                  <h3>ГРАФИК АКТИВНОСТИ</h3>
                  <span className="badge badge-info">ПРЯМАЯ ТРАНСЛЯЦИЯ</span>
                </div>
                <div className="card-body" style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-dim)" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="var(--text-muted)" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="var(--text-muted)" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'var(--bg-panel)', 
                          border: '1px solid var(--border-mid)',
                          borderRadius: '0px',
                          fontFamily: 'Space Mono'
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke="var(--accent)" 
                        fillOpacity={1} 
                        fill="url(#colorValue)" 
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3>ПОСЛЕДНИЕ ДЕЙСТВИЯ</h3>
                  <button className="btn btn-sm btn-outline" style={{ padding: '4px 8px', fontSize: '0.6rem' }}>ВСЕ ЛОГИ</button>
                </div>
                <div className="card-body" style={{ padding: '0' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>ОПЕРАТИВНИК</th>
                        <th>ДЕЙСТВИЕ</th>
                        <th>ВРЕМЯ</th>
                      </tr>
                    </thead>
                    <tbody>
                       {stats?.recentActivity?.map((log, i) => (
                        <tr key={i}>
                          <td className="mono" style={{ color: 'var(--text-accent)' }}>
                            <div>{log.user_iin}</div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                                {log.users?.fio || log.user_fio || 'АНОНИМ'}
                            </div>
                          </td>
                          <td style={{ fontSize: '0.8rem' }}>{formatActionType(log.action_type)}</td>
                          <td className="mono" style={{ fontSize: '0.7rem' }}>
                            {new Date(log.created_at).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                      {(!stats?.recentActivity || stats.recentActivity.length === 0) && (
                        <tr>
                          <td colSpan="3" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                            ДЕЙСТВИЙ НЕ ЗАФИКСИРОВАНО
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
        </div>
    );
}

export default Dashboard;
