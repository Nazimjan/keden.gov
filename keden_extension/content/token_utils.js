/**
 * KEDEN Extension - Shared Token Utilities
 * Single source of truth for extracting the Keden auth token.
 * Must be loaded BEFORE api.js and keep_alive.js in manifest.json.
 */

/**
 * Extracts the current Keden token from various storage locations.
 * Priority: auth-storage → state.token → localStorage/sessionStorage fallback.
 * Returns a clean token string (strips surrounding quotes) or null.
 */
function getKedenToken() {
    try {
        const authStorage = localStorage.getItem('auth-storage');
        let token = null;

        if (authStorage) {
            const state = JSON.parse(authStorage).state;
            if (state) {
                token =
                    (state.token && (
                        state.token.access_token ||
                        state.token.id_token ||
                        (typeof state.token === 'string' ? state.token : null)
                    )) ||
                    (state.user && state.user.token) ||
                    (state.userAccountData && state.userAccountData.token);
            }
        }

        if (!token) {
            token =
                localStorage.getItem('token') ||
                localStorage.getItem('access_token') ||
                sessionStorage.getItem('token') ||
                sessionStorage.getItem('access_token');
        }

        if (token) {
            token = token.replace(/^"|"$/g, '');
        }

        return token || null;
    } catch (e) {
        console.warn('[Keden] getKedenToken: failed to read token', e.message);
        return null;
    }
}
