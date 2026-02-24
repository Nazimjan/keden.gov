/**
 * KEDEN Extension - Admin Auth Module
 * Handles authentication against the admin backend and usage logging
 */

const ADMIN_API_BASE = 'http://localhost:3001';

/**
 * Extracts current Keden user info from the auth-storage in localStorage
 * The token is a JWT that contains user info (iin, fullName, etc.)
 * Also falls back to state.user and state.userAccountData
 */
function extractKedenUserInfo() {
    try {
        const authStorage = localStorage.getItem('auth-storage');
        if (!authStorage) {
            console.warn('[Admin Auth] auth-storage not found in localStorage');
            return null;
        }

        const state = JSON.parse(authStorage).state;
        if (!state) return null;

        let iin = '';
        let fio = '';
        let token = '';

        // Try to find token in state.token or state.user.token
        if (state.token) {
            token = typeof state.token === 'string' ? state.token : (state.token.access_token || state.token.id_token || '');
        }
        if (!token && state.user && state.user.token) {
            token = state.user.token;
        }

        // Method 1: Decode JWT payload if we found a token
        if (token && token.includes('.')) {
            try {
                const parts = token.split('.');
                if (parts.length === 3) {
                    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
                        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                    }).join(''));
                    const payload = JSON.parse(jsonPayload);
                    iin = payload.iin || '';
                    fio = payload.fullName || payload.name || '';
                }
            } catch (e) {
                console.warn('[Admin Auth] JWT decode failed:', e);
            }
        }

        // Method 2: Fallback to state.user data (Keden often stores it here)
        if (state.user) {
            iin = iin || state.user.iin || state.user.username || '';
            fio = fio || state.user.fullName || state.user.name || '';
        }

        // Method 3: Fallback to state.userAccountData
        if (!iin && state.userAccountData) {
            iin = state.userAccountData.iin || '';
            const ud = state.userAccountData;
            fio = fio || [ud.lastName, ud.firstName, ud.middleName].filter(Boolean).join(' ');
        }

        if (!iin && !token) return null;

        return {
            iin: iin || 'unknown',
            fio: fio || iin || 'Пользователь',
            token: token
        };
    } catch (e) {
        console.error('[Admin Auth] Failed to extract user info:', e);
        return null;
    }
}

/**
 * Checks if the current user is authorized to use the extension
 */
async function checkExtensionAccess() {
    const userInfo = extractKedenUserInfo();
    if (!userInfo || !userInfo.token) {
        return { allowed: false, message: 'Не удалось определить сессию Кедена. Убедитесь что вы авторизованы в ИС Кеден.', userInfo: null };
    }

    try {
        console.log('[Admin Auth] Checking access at:', `${ADMIN_API_BASE}/api/ext/auth`);
        const resp = await fetch(`${ADMIN_API_BASE}/api/ext/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userInfo.token })
        });

        const data = await resp.json();
        console.log('[Admin Auth] Server response:', data);
        return { ...data, userInfo };
    } catch (e) {
        console.error('[Admin Auth] Backend unreachable:', e);
        // If admin server is down, allow access (graceful degradation)
        return { allowed: true, message: 'Сервер администрирования недоступен. Работа в автономном режиме.', userInfo, offline: true };
    }
}

/**
 * Sends a log entry to the admin backend
 */
async function logExtensionAction(actionType, description = '') {
    const userInfo = extractKedenUserInfo();
    if (!userInfo) return;

    try {
        await fetch(`${ADMIN_API_BASE}/api/ext/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                iin: userInfo.iin,
                fio: userInfo.fio,
                action_type: actionType,
                description: description
            })
        });
    } catch (e) {
        console.warn('[Admin Auth] Log send failed (offline mode):', e.message);
    }
}
