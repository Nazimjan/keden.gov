/**
 * KEDEN Extension - Keep Alive Module
 * Prevents session timeout on keden.kgd.gov.kz by periodically sending lightweight requests
 */

(function () {
    // Avoid double initialization
    if (window.kedenKeepAliveStarted) return;
    window.kedenKeepAliveStarted = true;

    console.log("[Keden Keep-Alive] Module active (Session auto-refresh)");

    const PING_INTERVAL = 1 * 60 * 1000; // 1 minute
    let lastRefresh = 0;

    /**
     * Extracts the current Keden token from various storage locations
     */
    function getKedenToken() {
        try {
            const authStorage = localStorage.getItem('auth-storage');
            let token = null;

            if (authStorage) {
                const state = JSON.parse(authStorage).state;
                if (state) {
                    token = (state.token && (state.token.access_token || state.token.id_token || (typeof state.token === 'string' ? state.token : null))) ||
                        (state.user && state.user.token) ||
                        (state.userAccountData && state.userAccountData.token);
                }
            }

            if (!token) {
                token = localStorage.getItem('token') ||
                    localStorage.getItem('access_token') ||
                    sessionStorage.getItem('token') ||
                    sessionStorage.getItem('access_token');
            }

            return token;
        } catch (e) {
            return null;
        }
    }

    /**
     * Simulates a tiny user activity to fool client-side idle timers
     */
    function simulateActivity() {
        try {
            // Dispatch a native-like event that doesn't disrupt the user
            window.dispatchEvent(new CustomEvent('keden-keep-alive-activity'));

            // Some systems check for mousemove, but we don't want to flicker the cursor
            // A tiny scroll (0 pixels) or a focus event can sometimes help
            const activeEl = document.activeElement;
            if (activeEl) {
                activeEl.dispatchEvent(new Event('focus', { bubbles: true }));
            }
        } catch (e) { }
    }

    /**
     * Sends a lightweight request to the Keden API
     */
    async function refreshSession() {
        const now = Date.now();
        // Prevent accidental rapid pings
        if (now - lastRefresh < 10000) return;

        simulateActivity();
        const token = getKedenToken();
        const headers = {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        if (token) {
            headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
        }

        try {
            // Using a more standard endpoint that should be available to any logged-in user
            const response = await fetch('/api/v1/handbook/entries/search/customs_post_classifier?pageSize=1', {
                method: 'GET',
                headers: headers
            });

            if (response.ok) {
                console.log(`[Keden Keep-Alive] Session active. Tick at ${new Date().toLocaleTimeString()}`);
                lastRefresh = now;
            } else if (response.status === 401 || response.status === 403) {
                console.warn(`[Keden Keep-Alive] Auth fail (Status ${response.status}). Token prefix: ${token ? token.substring(0, 10) + '...' : 'none'}`);
                // If it failed with 401, maybe we can try to find a new token in 30 seconds
                lastRefresh = now - (PING_INTERVAL - 30000);
            } else {
                console.warn(`[Keden Keep-Alive] Unexpected status: ${response.status}`);
            }
        } catch (error) {
            console.error("[Keden Keep-Alive] Network error:", error.message);
        }
    }

    // Set up the interval
    const intervalId = setInterval(refreshSession, PING_INTERVAL);

    // Initial ping
    setTimeout(refreshSession, 2000);

    // Refresh when user returns to tab
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const now = Date.now();
            if (now - lastRefresh > 60000) { // If it's been more than a minute
                refreshSession();
            }
        }
    });
})();

