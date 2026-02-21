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
        if (!authStorage) return null;

        const state = JSON.parse(authStorage).state;
        if (!state || !state.token) return null;

        let iin = '';
        let fio = '';

        // Method 1: Decode JWT payload
        const accessToken = state.token.access_token;
        if (accessToken) {
            try {
                const parts = accessToken.split('.');
                if (parts.length === 3) {
                    // Correctly decode UTF-8 from Base64
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

        // Method 2: Fallback to state.user
        if (!iin && state.user) {
            iin = state.user.iin || state.user.username || '';
            fio = fio || state.user.fullName || state.user.name || '';
        }

        // Method 3: Fallback to state.userAccountData
        if (!iin && state.userAccountData) {
            iin = state.userAccountData.iin || '';
            const ud = state.userAccountData;
            fio = fio || [ud.lastName, ud.firstName, ud.middleName].filter(Boolean).join(' ');
        }

        if (!iin) return null;

        return { iin, fio: fio || iin };
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
    if (!userInfo || !userInfo.iin) {
        return { allowed: false, message: 'Не удалось определить пользователя ИС Кеден. Убедитесь что вы авторизованы в системе.', userInfo: null };
    }

    try {
        const resp = await fetch(`${ADMIN_API_BASE}/api/ext/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ iin: userInfo.iin, fio: userInfo.fio })
        });

        const data = await resp.json();
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
