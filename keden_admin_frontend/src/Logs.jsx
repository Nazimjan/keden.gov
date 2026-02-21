import React, { useState, useEffect } from 'react';
import { api } from './api.js';

function Logs() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [filterIin, setFilterIin] = useState('');

    useEffect(() => {
        loadLogs();
    }, [page, filterIin]);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const data = await api.getLogs(page, 30, filterIin);
            setLogs(data.logs);
            setTotalPages(data.totalPages);
            setTotal(data.total);
        } catch (err) {
            console.error('Logs load error:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (date) => {
        if (!date) return '—';
        const d = new Date(date + 'Z');
        return d.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const actionColors = {
        'FILL_PI': 'badge-success',
        'LOGIN': 'badge-info',
        'AUTH_CHECK': 'badge-info',
        'ANALYZE': 'badge-info',
        'ERROR': 'badge-danger',
    };

    const getActionBadgeClass = (action) => {
        return actionColors[action] || 'badge-info';
    };

    return (
        <div>
            <div className="page-header">
                <h2>📋 Журнал действий</h2>
                <div className="search-bar">
                    <span className="search-icon">🔍</span>
                    <input
                        type="text"
                        placeholder="Фильтр по ИИН..."
                        value={filterIin}
                        onChange={(e) => { setFilterIin(e.target.value); setPage(1); }}
                    />
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3>Всего записей: {total}</h3>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn btn-outline btn-sm" onClick={loadLogs}>
                            🔄 Обновить
                        </button>
                        <button className="btn btn-danger btn-sm" id="clearLogsBtn" onClick={async (e) => {
                            const btn = e.target;
                            if (btn.innerText.includes('Точно?')) {
                                try {
                                    btn.innerText = '🗑️ Очистить журнал';
                                    await api.clearLogs();
                                    loadLogs();
                                } catch (err) {
                                    alert('Ошибка очистки: ' + err.message);
                                }
                            } else {
                                const oldText = btn.innerText;
                                btn.innerText = '❓ Точно? (Нажмите еще раз)';
                                setTimeout(() => {
                                    if (btn.innerText.includes('Точно?')) btn.innerText = oldText;
                                }, 3000);
                            }
                        }}>
                            🗑️ Очистить журнал
                        </button>
                    </div>
                </div>
                <div className="card-body">
                    {loading ? (
                        <div className="loading-center"><div className="spinner" /></div>
                    ) : logs.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">📭</div>
                            <p>Логи пусты</p>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>ИИН</th>
                                    <th>ФИО</th>
                                    <th>Действие</th>
                                    <th>Описание</th>
                                    <th>IP</th>
                                    <th>Время</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log) => (
                                    <tr key={log.id}>
                                        <td style={{ color: 'var(--text-muted)' }}>{log.id}</td>
                                        <td style={{ fontFamily: 'monospace' }}>{log.user_iin}</td>
                                        <td>{log.user_fio || '—'}</td>
                                        <td>
                                            <span className={`badge ${getActionBadgeClass(log.action_type)}`}>
                                                {log.action_type}
                                            </span>
                                        </td>
                                        <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {log.description || '—'}
                                        </td>
                                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.ip_address || '—'}</td>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="pagination">
                        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                            ← Назад
                        </button>
                        <span>Стр. {page} из {totalPages}</span>
                        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                            Вперёд →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Logs;
