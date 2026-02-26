/**
 * Extracts current Keden user info from the auth-storage in localStorage
 * The token is a JWT that contains user info (iin, fullName, etc.)
 * Also falls back to state.user and state.userAccountData
 */
async function extractKedenUserInfo() {
    try {
        const authStorage = localStorage.getItem('auth-storage');
        let state = null;
        if (authStorage) {
            try {
                state = JSON.parse(authStorage).state;
            } catch (e) {
                console.warn('[Admin Auth] Failed to parse auth-storage');
            }
        }

        let iin = '';
        let fio = '';
        let token = '';

        // Try to find token in state or directly in localStorage/sessionStorage
        if (state) {
            if (state.token) {
                token = typeof state.token === 'string' ? state.token : (state.token.access_token || state.token.id_token || '');
            }
            if (!token && state.user && state.user.token) {
                token = state.user.token;
            }
            if (!token && state.userAccountData && state.userAccountData.token) {
                token = state.userAccountData.token;
            }
        }

        // Fallback to standard names
        if (!token) {
            token = localStorage.getItem('token') ||
                localStorage.getItem('access_token') ||
                sessionStorage.getItem('token') ||
                sessionStorage.getItem('access_token');
        }

        // Method 1: Decode JWT payload if we found a token
        if (token) {
            token = token.replace(/^"|"$/g, ''); // Keden often stores token with quotes
        }

        if (token && token.includes('.')) {
            try {
                const parts = token.split('.');
                if (parts.length === 3) {
                    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
                        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                    }).slice(0).join(''));
                    const payload = JSON.parse(jsonPayload);
                    iin = payload.iin || payload.preferred_username || payload.sub || '';
                    fio = payload.fullName || payload.name || payload.given_name || '';
                }
            } catch (e) {
                console.warn('[Admin Auth] JWT decode failed:', e);
            }
        }

        // Method 2: Fallback to state data (Keden often stores it here)
        if (state) {
            if (state.user) {
                iin = iin || state.user.iin || state.user.username || '';
                fio = fio || state.user.fullName || state.user.name || '';
            }
            if (!iin && state.userAccountData) {
                iin = state.userAccountData.iin || '';
                const ud = state.userAccountData;
                fio = fio || [ud.lastName, ud.firstName, ud.middleName].filter(Boolean).join(' ');
            }
        }

        // Method 3: Fetch profile directly using the token to get actual FIO
        if (token) {
            try {
                const res = await fetch('https://keden.kgd.gov.kz/api/v1/auth/user-profile', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.iin) iin = data.iin;
                    if (data.lastName || data.firstName) {
                        fio = [data.lastName, data.firstName, data.middleName].filter(Boolean).join(' ');
                    }
                }
            } catch (e) {
                console.warn('[Admin Auth] Profile fetch failed:', e);
            }
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
    let userInfo = null;
    let retries = 5;

    // Retry loop to wait for Keden to initialize its localStorage
    while (!userInfo && retries > 0) {
        userInfo = await extractKedenUserInfo();
        if (!userInfo) {
            retries--;
            if (retries > 0) {
                console.log(`[Admin Auth] Session not found, retrying in 1s... (${retries} left)`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    if (!userInfo || !userInfo.token) {
        return { allowed: false, message: 'Не удалось определить сессию Кедена. Убедитесь что вы авторизованы в ИС Кеден.', userInfo: null };
    }

    try {
        // Now calling background script which communicates with Supabase Cloud
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'CHECK_ACCESS',
                payload: { iin: userInfo.iin, fio: userInfo.fio }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ allowed: true, message: 'Ошибка связи с фоновым скриптом. Режим офлайн.', userInfo, offline: true });
                    return;
                }
                if (response && response.success) {
                    resolve({ ...response, userInfo });
                } else {
                    resolve({ allowed: false, message: response?.error || 'Доступ отклонен облачным сервером.', userInfo });
                }
            });
        });
    } catch (e) {
        console.error('[Admin Auth] Cloud access check failed:', e);
        return { allowed: true, message: 'Ошибка проверки доступа. Работа в автономном режиме.', userInfo, offline: true };
    }
}

/**
 * Sends a log entry to the admin backend
 */
async function logExtensionAction(actionType, description = '') {
    const userInfo = await extractKedenUserInfo();
    if (!userInfo) return;

    try {
        chrome.runtime.sendMessage({
            action: 'LOG_ACTION',
            payload: {
                iin: userInfo.iin,
                action_type: actionType,
                description: description
            }
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn('[Admin Auth] Log send failed (background offline)');
            }
        });
    } catch (e) {
        console.warn('[Admin Auth] Log send failed:', e.message);
    }
}

