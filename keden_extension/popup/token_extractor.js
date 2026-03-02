/**
 * KEDEN Extension - Token Extractor
 * Extracts user credentials (IIN, FIO, token) from the Keden page context.
 * This function is injected via chrome.scripting.executeScript and must be self-contained.
 */
async function extractKedenTokenData() {
    // Step 1: Parse auth state from localStorage
    function getAuthState() {
        try {
            const raw = localStorage.getItem('auth-storage');
            if (raw) return JSON.parse(raw).state || null;
        } catch (e) { }
        return null;
    }

    // Step 2: Find token in auth state object
    function findTokenInState(state) {
        if (!state) return '';
        if (state.token) {
            return typeof state.token === 'string'
                ? state.token
                : (state.token.access_token || state.token.id_token || '');
        }
        if (state.user && state.user.token) return state.user.token;
        if (state.userAccountData && state.userAccountData.token) return state.userAccountData.token;
        return '';
    }

    // Step 3: Fallback — search token in localStorage/sessionStorage
    function findTokenInStorage() {
        return localStorage.getItem('token') ||
            localStorage.getItem('access_token') ||
            sessionStorage.getItem('token') ||
            sessionStorage.getItem('access_token') || '';
    }

    // Step 4: Decode JWT payload, extract IIN and FIO
    function decodeJWT(token) {
        if (!token || !token.includes('.')) return { iin: '', fio: '' };
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return { iin: '', fio: '' };
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            const payload = JSON.parse(jsonPayload);
            return {
                iin: payload.iin || payload.preferred_username || payload.sub || '',
                fio: payload.fullName || payload.name || payload.given_name || ''
            };
        } catch (e) {
            return { iin: '', fio: '' };
        }
    }

    // Step 5: Extract IIN/FIO from state.user and state.userAccountData
    function extractUserFromState(state) {
        let iin = '', fio = '';
        if (!state) return { iin, fio };
        if (state.user) {
            iin = state.user.iin || state.user.username || '';
            fio = state.user.fullName || '';
        }
        if (state.userAccountData) {
            iin = iin || state.userAccountData.iin || '';
            const ud = state.userAccountData;
            fio = fio || [ud.lastName, ud.firstName, ud.middleName].filter(Boolean).join(' ');
        }
        return { iin, fio };
    }

    // Step 6: Fetch user profile from API
    async function fetchProfile(token) {
        if (!token) return { iin: '', fio: '' };
        try {
            const res = await fetch('https://keden.kgd.gov.kz/api/v1/auth/user-profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                return {
                    iin: data.iin || '',
                    fio: (data.lastName || data.firstName)
                        ? [data.lastName, data.firstName, data.middleName].filter(Boolean).join(' ')
                        : ''
                };
            }
        } catch (e) {
            console.warn('[Admin Auth] Profile fetch failed:', e);
        }
        return { iin: '', fio: '' };
    }

    // Orchestration
    try {
        const state = getAuthState();
        let token = findTokenInState(state) || findTokenInStorage();
        if (token) token = token.replace(/^"|"$/g, '');

        const jwt = decodeJWT(token);
        let iin = jwt.iin, fio = jwt.fio;

        const stateUser = extractUserFromState(state);
        iin = iin || stateUser.iin;
        fio = fio || stateUser.fio;

        const profile = await fetchProfile(token);
        if (profile.iin) iin = profile.iin;
        if (profile.fio) fio = profile.fio;

        if (!iin && !token) return null;
        return { iin: iin || 'unknown', fio: fio || 'Пользователь', token: token };
    } catch (e) {
        return { error: e.message };
    }
}
