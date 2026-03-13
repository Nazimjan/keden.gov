import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import { formatActionType, formatDescription } from './utils.js';

function Logs() {
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [iin, setIin] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadLogs();
    }, [page]);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const data = await api.getLogs(page, 50, iin);
            setLogs(data.items);
            setTotal(data.total);
            setTotalPages(data.pages);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        setPage(1);
        loadLogs();
    };

    const handleClear = async () => {
        if (window.confirm('ОЧИСТИТЬ ВСЕ ЖУРНАЛЫ МИССИЙ? ЭТО ДЕЙСТВИЕ НЕОБРАТИМО.')) {
            try {
                await api.clearLogs();
                loadLogs();
            } catch (err) {
                alert(err.message);
            }
        }
    };

    return (
        <div className="reveal">
            <header className="page-header">
                <div>
                  <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>ИСТОРИЯ АКТИВНОСТИ</span>
                  <h2>ЖУРНАЛ ДЕЙСТВИЙ</h2>
                </div>
                <button className="btn btn-danger" onClick={handleClear}>💣 ОЧИСТКА</button>
            </header>

            <div className="card" style={{ marginBottom: '24px' }}>
              <form onSubmit={handleSearch} className="card-body" style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', padding: '20px 32px' }}>
                  <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                      <label>ФИЛЬТР ПО ИИН ОПЕРАТИВНИКА</label>
                      <input
                          type="text"
                          value={iin}
                          onChange={e => setIin(e.target.value)}
                          placeholder="ПОИСК ИИН..."
                      />
                  </div>
                  <button type="submit" className="btn btn-outline">ИСКАТЬ</button>
              </form>
            </div>

            <div className="card">
                <div className="card-header">
                  <h3 className="mono" style={{ fontSize: '0.8rem' }}>Найдено записей: {total}</h3>
                  <div className="admin-actions">
                    <button 
                      className="btn btn-sm btn-outline" 
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >◀ НАЗАД</button>
                    <span className="mono" style={{ alignSelf: 'center', fontSize: '0.8rem' }}>СТРАНИЦА {page} / {totalPages}</span>
                    <button 
                      className="btn btn-sm btn-outline" 
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >ДАЛЕЕ ▶</button>
                  </div>
                </div>
                <div className="card-body" style={{ padding: '0' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ВРЕМЯ</th>
                                <th>ОПЕРАТИВНИК</th>
                                <th>ОПЕРАЦИЯ</th>
                                <th>ОТВЕТ СИСТЕМЫ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                              <tr>
                                <td colSpan="4" style={{ textAlign: 'center', padding: '100px' }} className="mono">
                                  ЗАГРУЗКА ДАННЫХ...
                                </td>
                              </tr>
                            ) : logs.map(log => (
                                <tr key={log.id}>
                                    <td className="mono" style={{ fontSize: '0.75rem' }}>
                                      {new Date(log.created_at).toLocaleString()}
                                    </td>
                                    <td className="mono" style={{ color: 'var(--text-accent)' }}>
                                        <div style={{ fontWeight: 'bold' }}>{log.user_iin}</div>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                            {log.users?.fio || log.user_fio || 'АНОНИМ'}
                                        </div>
                                    </td>
                                    <td>
                                        <span className="badge badge-outline" style={{ fontSize: '0.6rem', border: '1px solid var(--border-mid)' }}>
                                            {formatActionType(log.action_type)}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.description}>
                                      {formatDescription(log.description, log.action_type)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default Logs;
