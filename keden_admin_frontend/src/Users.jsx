import React, { useState, useEffect } from 'react';
import { api } from './api.js';

function Users() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [newIin, setNewIin] = useState('');
    const [newFio, setNewFio] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [search, setSearch] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [editUser, setEditUser] = useState(null);
    const [editCredits, setEditCredits] = useState('');
    const [editSubEnd, setEditSubEnd] = useState('');

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            const data = await api.getUsers();
            setUsers(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        setError('');

        try {
            await api.addUser(newIin, newFio);
            setShowModal(false);
            setNewIin('');
            setNewFio('');
            setSuccess('Пользователь успешно добавлен');
            setTimeout(() => setSuccess(''), 3000);
            loadUsers();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleToggle = async (user) => {
        try {
            await api.updateUser(user.id, { is_allowed: !user.is_allowed });
            loadUsers();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDelete = async (user) => {
        try {
            await api.deleteUser(user.id);
            setDeleteConfirmId(null);
            setSuccess('Пользователь удален');
            setTimeout(() => setSuccess(''), 3000);
            loadUsers();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleEditOpen = (user) => {
        setError('');
        setEditUser(user);
        setEditCredits(user.credits || 0);
        setEditSubEnd(user.subscription_end || '');
    };

    const handleEditSave = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.updateUser(editUser.id, {
                credits: parseInt(editCredits) || 0,
                subscription_end: editSubEnd || null
            });
            setEditUser(null);
            setSuccess('Данные обновлены');
            setTimeout(() => setSuccess(''), 3000);
            loadUsers();
        } catch (err) {
            setError(err.message);
        }
    };

    const formatDate = (date) => {
        if (!date) return '—';
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return '—'; }
    };

    const filtered = users.filter(u =>
        u.iin.includes(search) || u.fio.toLowerCase().includes(search.toLowerCase())
    );

    if (loading) {
        return <div className="loading-center"><div className="spinner" /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <h2>👥 Пользователи</h2>
                <button className="btn btn-primary" onClick={() => { setShowModal(true); setError(''); }}>
                    ➕ Добавить
                </button>
            </div>

            {error && <div className="alert alert-error">❌ {error}</div>}
            {success && <div className="alert alert-success">✅ {success}</div>}

            <div className="card">
                <div className="card-header">
                    <h3>Список пользователей ({filtered.length})</h3>
                    <div className="search-bar">
                        <span className="search-icon">🔍</span>
                        <input
                            type="text"
                            placeholder="Поиск по ИИН или ФИО..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </div>
                <div className="card-body">
                    {filtered.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">👤</div>
                            <p>Пользователи не найдены</p>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>ИИН</th>
                                    <th>ФИО</th>
                                    <th>Статус</th>
                                    <th>Доступ</th>
                                    <th>Подписка</th>
                                    <th>Кредиты</th>
                                    <th>Добавлен</th>
                                    <th>Последняя активность</th>
                                    <th>Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((user) => (
                                    <tr key={user.id}>
                                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{user.iin}</td>
                                        <td>{user.fio}</td>
                                        <td>
                                            <span className={`badge ${user.is_allowed ? 'badge-success' : 'badge-danger'}`}>
                                                {user.is_allowed ? '● Активен' : '● Заблокирован'}
                                            </span>
                                        </td>
                                        <td>
                                            <label className="toggle-switch">
                                                <input
                                                    type="checkbox"
                                                    checked={!!user.is_allowed}
                                                    onChange={() => handleToggle(user)}
                                                />
                                                <span className="toggle-slider" />
                                            </label>
                                        </td>
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                            {user.subscription_end
                                                ? new Date(user.subscription_end) > new Date()
                                                    ? <span className="badge badge-success">До {user.subscription_end.substring(0, 10)}</span>
                                                    : <span className="badge badge-danger">Истекла</span>
                                                : <span style={{ opacity: 0.5 }}>—</span>}
                                        </td>
                                        <td>
                                            <span className="badge">{user.credits || 0} ПИ</span>
                                        </td>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(user.created_at)}</td>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(user.last_active)}</td>
                                        <td>
                                            <div className="actions-cell">
                                                <button className="btn btn-outline btn-sm" onClick={() => handleEditOpen(user)} title="Редактировать лимиты">
                                                    ✏️
                                                </button>
                                                {deleteConfirmId === user.id ? (
                                                    <>
                                                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(user)}>
                                                            ✓ Да
                                                        </button>
                                                        <button className="btn btn-outline btn-sm" onClick={() => setDeleteConfirmId(null)}>
                                                            ✗ Нет
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() => setDeleteConfirmId(user.id)}
                                                        title="Удалить"
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>➕ Добавить пользователя</h3>

                        {error && !editUser && <div className="alert alert-error">❌ {error}</div>}

                        <form onSubmit={handleAdd}>
                            <div className="form-group">
                                <label>ИИН (12 цифр)</label>
                                <input
                                    type="text"
                                    placeholder="123456789012"
                                    value={newIin}
                                    onChange={(e) => setNewIin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                                    maxLength={12}
                                    autoFocus
                                />
                            </div>

                            <div className="form-group">
                                <label>ФИО</label>
                                <input
                                    type="text"
                                    placeholder="Иванов Иван Иванович"
                                    value={newFio}
                                    onChange={(e) => setNewFio(e.target.value)}
                                />
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
                                    Отмена
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={newIin.length !== 12 || !newFio.trim()}>
                                    Добавить
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {editUser && (
                <div className="modal-overlay" onClick={() => setEditUser(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>✏️ Редактировать доступ</h3>
                        <p style={{ marginBottom: '1rem', opacity: 0.8 }}>{editUser.fio} ({editUser.iin})</p>

                        {error && <div className="alert alert-error">❌ {error}</div>}

                        <form onSubmit={handleEditSave}>
                            <div className="form-group">
                                <label>Подписка активна ДО (включительно)</label>
                                <input
                                    type="date"
                                    value={editSubEnd ? editSubEnd.split('T')[0] : ''}
                                    onChange={(e) => setEditSubEnd(e.target.value)}
                                />
                                <small>Если не указано, доступ возможен только по кредитам.</small>
                            </div>

                            <div className="form-group">
                                <label>Количество кредитов (ПИ)</label>
                                <input
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={editCredits}
                                    onChange={(e) => setEditCredits(e.target.value)}
                                />
                                <small>Будут списываться по 1 за каждую отправку ПИ, если нет подписки.</small>
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn btn-outline" onClick={() => setEditUser(null)}>
                                    Отмена
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Сохранить
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Users;
