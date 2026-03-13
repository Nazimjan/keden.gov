import React, { useState } from 'react';
import { api } from './api.js';

function Login({ onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await api.login(email, password);
        } catch (err) {
            setError(err.message || 'ОБНАРУЖЕНО НАРУШЕНИЕ АУТЕНТИФИКАЦИИ');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card reveal">
                <div className="logo">
                    <h1>⚡ KEDEN</h1>
                    <p>ПАНЕЛЬ УПРАВЛЕНИЯ</p>
                </div>
                
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>EMAIL</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="EMAIL"
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>ПАРОЛЬ</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="ПАРОЛЬ"
                            required
                        />
                    </div>
                    
                    {error && (
                      <div className="mono" style={{ color: 'var(--danger)', fontSize: '0.7rem', marginBottom: '20px' }}>
                        ОШИБКА: {error}
                      </div>
                    )}
                    
                    <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                        {loading ? 'ВХОД...' : 'ВОЙТИ'}
                    </button>
                    
                    <div className="mono" style={{ marginTop: '40px', fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                      ШИФРОВАНИЕ: AES-256-GCM | СТАТУС: ОЖИДАНИЕ
                    </div>
                </form>
            </div>
        </div>
    );
}

export default Login;
