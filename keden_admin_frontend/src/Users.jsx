import React, { useState, useEffect } from 'react';
import { api } from './api.js';

function Users() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [newUser, setNewUser] = useState({ iin: '', fio: '' });
    const [processingId, setProcessingId] = useState(null);
    
    // Management state
    const [editingUser, setEditingUser] = useState(null);
    const [editData, setEditData] = useState({ credits: 0, subscription_end: '', block_reason: '' });

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            const data = await api.getUsers();
            setUsers(data);
        } catch (err) {
            console.error('Ошибка загрузки пользователей:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            await api.addUser(newUser.iin, newUser.fio);
            setNewUser({ iin: '', fio: '' });
            setShowAdd(false);
            loadUsers();
        } catch (err) {
            alert('Ошибка добавления: ' + err.message);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ ИЗ СИСТЕМЫ?')) {
            try {
                await api.deleteUser(id);
                loadUsers();
            } catch (err) {
                alert('Ошибка удаления: ' + err.message);
            }
        }
    };

    const startEdit = (user) => {
        setEditingUser(user);
        setEditData({
            credits: user.credits || 0,
            subscription_end: user.subscription_end ? user.subscription_end.split('T')[0] : '',
            block_reason: user.block_reason || ''
        });
    };

    const handleUpdateUser = async (e) => {
        e.preventDefault();
        setProcessingId(editingUser.id);
        try {
            await api.updateUser(editingUser.id, {
                credits: parseInt(editData.credits),
                subscription_end: editData.subscription_end || null,
                block_reason: editData.block_reason
            });
            setEditingUser(null);
            loadUsers();
        } catch (err) {
            alert('Ошибка обновления: ' + err.message);
        } finally {
            setProcessingId(null);
        }
    };

    const toggleAccess = async (user) => {
        const nextState = !user.is_allowed;
        let reason = user.block_reason;

        if (!nextState) {
            const inputReason = window.prompt('УКАЖИТЕ ПРИЧИНУ БЛОКИРОВКИ:', user.block_reason || '');
            if (inputReason === null) return; // Cancelled
            reason = inputReason;
        } else {
            // If unblocking, maybe keep reason or clear it? Let's clear it for now or keep it as history.
            // User requested "note to lock", usually stays.
        }

        setProcessingId(user.id);
        try {
            await api.updateUser(user.id, { 
                is_allowed: nextState,
                block_reason: reason 
            });
            await loadUsers();
        } catch (err) {
            alert('СБОЙ ОПЕРАЦИИ: ' + err.message);
        } finally {
            setProcessingId(null);
        }
    };

    if (loading) return <div className="loading-state h-full flex items-center justify-center mono">ЗАГРУЗКА БАЗЫ...</div>;

    return (
        <div className="reveal">
            <header className="page-header">
                <div>
                  <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>УПРАВЛЕНИЕ ДОСТУПОМ</span>
                  <h2>ПОЛЬЗОВАТЕЛИ</h2>
                </div>
                <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
                    {showAdd ? '✖ ОТМЕНА' : '➕ ДОБАВИТЬ'}
                </button>
            </header>

            {showAdd && (
                <div className="card reveal" style={{ maxWidth: '600px' }}>
                    <div className="card-header">
                      <h3>РЕГИСТРАЦИЯ НОВОГО ПОЛЬЗОВАТЕЛЯ</h3>
                    </div>
                    <form onSubmit={handleAdd} className="card-body">
                        <div className="form-group">
                            <label>ИИН (Гос. идентификатор)</label>
                            <input
                                type="text"
                                value={newUser.iin}
                                onChange={e => setNewUser({ ...newUser, iin: e.target.value })}
                                placeholder="12 цифр ИИН"
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>ФИО (Полное имя)</label>
                            <input
                                type="text"
                                value={newUser.fio}
                                onChange={e => setNewUser({ ...newUser, fio: e.target.value })}
                                placeholder="Фамилия Имя Отчество"
                                required
                            />
                        </div>
                        <button type="submit" className="btn btn-primary btn-full">ДОБАВИТЬ В СИСТЕМУ</button>
                    </form>
                </div>
            )}

            {editingUser && (
                <div className="modal-overlay" style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex',
                    alignItems: 'center', justifyContent: 'center'
                }}>
                    <div className="card reveal" style={{ maxWidth: '500px', width: '90%' }}>
                        <div className="card-header">
                            <h3>УПРАВЛЕНИЕ ПОДПИСКОЙ: {editingUser.iin}</h3>
                        </div>
                        <form onSubmit={handleUpdateUser} className="card-body">
                            <div className="form-group">
                                <label>КРЕДИТЫ (ЛИМИТ)</label>
                                <input
                                    type="number"
                                    value={editData.credits}
                                    onChange={e => setEditData({ ...editData, credits: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>ДАТА ИСТЕЧЕНИЯ ПОДПИСКИ</label>
                                <input
                                    type="date"
                                    value={editData.subscription_end}
                                    onChange={e => setEditData({ ...editData, subscription_end: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>ОСТАВЬТЕ ПУСТЫМ ДЛЯ БЕССРОЧНОГО</small>
                            </div>
                            <div className="form-group">
                                <label>ПРИМЕЧАНИЕ / ПРИЧИНА БЛОКИРОВКИ</label>
                                <textarea
                                    className="form-group input"
                                    style={{ width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border-mid)', color: 'white', padding: '10px' }}
                                    value={editData.block_reason}
                                    onChange={e => setEditData({ ...editData, block_reason: e.target.value })}
                                    placeholder="Например: Вышло критическое обновление!"
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button type="button" className="btn btn-outline flex-1" onClick={() => setEditingUser(null)}>ОТМЕНА</button>
                                <button type="submit" className="btn btn-primary flex-1" disabled={processingId}>СОХРАНИТЬ</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-body" style={{ padding: '0' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>СТАТУС</th>
                                <th>ИИН</th>
                                <th>ФИО</th>
                                <th>КРЕДИТЫ</th>
                                <th>ИСТЕКАЕТ</th>
                                <th>ПРИМЕЧАНИЕ</th>
                                <th style={{ textAlign: 'right' }}>ДЕЙСТВИЯ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id}>
                                    <td>
                                        <span className={`badge ${user.is_allowed ? 'badge-success' : 'badge-danger'}`}>
                                            {user.is_allowed ? 'АКТИВЕН' : 'ЗАБЛОК'}
                                        </span>
                                    </td>
                                    <td className="mono" style={{ color: 'var(--text-accent)' }}>{user.iin}</td>
                                    <td style={{ fontWeight: '600' }}>{user.fio}</td>
                                    <td className="mono">{user.credits}</td>
                                    <td className="mono" style={{ fontSize: '0.75rem' }}>
                                      {user.subscription_end ? new Date(user.subscription_end).toLocaleDateString() : '—'}
                                    </td>
                                    <td style={{ fontSize: '0.75rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={user.block_reason}>
                                        {user.block_reason || '—'}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div className="admin-actions" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                                          <button 
                                            className="btn btn-outline" 
                                            style={{ padding: '6px 12px', fontSize: '0.65rem' }} 
                                            onClick={() => startEdit(user)}
                                          >
                                              ⚙️ НАСТРОЙКИ
                                          </button>
                                          <button 
                                            className={`btn ${user.is_allowed ? 'btn-outline' : 'btn-primary'}`} 
                                            style={{ padding: '6px 16px', fontSize: '0.65rem', minWidth: '100px' }} 
                                            onClick={() => toggleAccess(user)}
                                            disabled={processingId === user.id}
                                          >
                                              {processingId === user.id ? '...' : (user.is_allowed ? '🔒 БЛОК' : '🔓 ДОСТУП')}
                                          </button>
                                          <button 
                                            className="btn btn-danger" 
                                            style={{ padding: '6px 12px', fontSize: '0.65rem' }} 
                                            onClick={() => handleDelete(user.id)}
                                            disabled={processingId === user.id}
                                          >
                                              ✖
                                          </button>
                                        </div>
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

export default Users;
