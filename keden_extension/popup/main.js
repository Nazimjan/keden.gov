/**
 * KEDEN Extension - POPUP (Main Entry Point)
 * Swarm Agent Architecture: 2-Phase Processing
 * + Admin Panel Auth Integration
 */

const ADMIN_API = SUPABASE_CONFIG.URL;
const supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);
let currentUserInfo = null; // Will store { iin, fio } after auth check

/**
 * Fetch user info directly from the Keden tab's localStorage via scripting API
 */
async function getKedenUserInfo() {
    try {
        const tabs = await chrome.tabs.query({ url: "*://keden.kgd.gov.kz/*" });
        const kedenTab = tabs.find(t => t.url && t.url.includes('keden.kgd.gov.kz'));
        if (!kedenTab) return null;

        const results = await chrome.scripting.executeScript({
            target: { tabId: kedenTab.id },
            func: () => {
                try {
                    const authStorage = localStorage.getItem('auth-storage');
                    let state = null;
                    if (authStorage) {
                        try {
                            state = JSON.parse(authStorage).state;
                        } catch (e) { }
                    }

                    let iin = '', fio = '', token = '';

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

                    if (!token) {
                        token = localStorage.getItem('token') ||
                            localStorage.getItem('access_token') ||
                            sessionStorage.getItem('token') ||
                            sessionStorage.getItem('access_token');
                    }

                    if (token && token.includes('.')) {
                        try {
                            const parts = token.split('.');
                            if (parts.length === 3) {
                                const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                                const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
                                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                                }).join(''));
                                const payload = JSON.parse(jsonPayload);
                                iin = payload.iin || payload.preferred_username || payload.sub || '';
                                fio = payload.fullName || payload.name || payload.given_name || '';
                            }
                        } catch (e) { }
                    }

                    if (state) {
                        if (state.user) {
                            iin = iin || state.user.iin || state.user.username || '';
                            fio = fio || state.user.fullName || '';
                        }
                        if (state.userAccountData) {
                            iin = iin || state.userAccountData.iin || '';
                            const ud = state.userAccountData;
                            fio = fio || [ud.lastName, ud.firstName, ud.middleName].filter(Boolean).join(' ');
                        }
                    }

                    if (!iin && !token) return null;
                    return { iin: iin || 'unknown', fio: fio || 'Пользователь', token: token };
                } catch (e) { return { error: e.message }; }
            }
        });

        return results && results[0] && results[0].result ? results[0].result : null;
    } catch (e) {
        console.error('[Admin Auth] executeScript failed:', e);
        return null;
    }
}

/**
 * Check authorization against Supabase
 */
async function checkAdminAuth() {
    const userInfo = await getKedenUserInfo();
    if (!userInfo) {
        return { allowed: false, message: 'Не удалось определить пользователя ИС Кеден. Откройте страницу Keden и авторизуйтесь.', userInfo: null };
    }

    try {
        // 1. Пытаемся найти пользователя
        let { data: user, error } = await supabaseClient
            .from('users')
            .select('*')
            .eq('iin', userInfo.iin)
            .maybeSingle();

        // 2. Если пользователь не найден — создаем его автоматически
        if (!user) {
            console.log('[Supabase Auth] User not found, creating new account for IIN:', userInfo.iin);
            const { data: newUser, error: insertError } = await supabaseClient
                .from('users')
                .insert([{
                    iin: userInfo.iin,
                    fio: userInfo.fio,
                    is_allowed: true, // По умолчанию разрешаем (или false, если нужна модерация)
                    credits: 10 // Дарим 10 приветственных кредитов
                }])
                .select()
                .single();

            if (insertError) {
                console.error('[Supabase Auth] Auto-registration failed:', insertError);
                return { allowed: false, message: `Ошибка регистрации. Обратитесь к админу. (Код: ${insertError.code})`, userInfo };
            }
            user = newUser;
        }

        // 3. Проверяем статус доступа существующего или нового пользователя
        if (!user.is_allowed) {
            return { allowed: false, message: 'Ваш доступ заблокирован администратором.', userInfo };
        }

        const now = new Date();
        const hasSubscription = user.subscription_end && new Date(user.subscription_end) > now;

        return {
            allowed: true,
            user: { ...user, hasSubscription },
            userInfo
        };
    } catch (e) {
        console.error('[Supabase Auth] check failed:', e);
        return { allowed: true, message: 'Ошибка связи с облаком.', userInfo, offline: true };
    }
}

/**
 * Send action log to Supabase
 */
async function sendAdminLog(actionType, description = '') {
    if (!currentUserInfo) return;
    try {
        await supabaseClient.from('logs').insert({
            user_iin: currentUserInfo.iin,
            user_fio: currentUserInfo.fio,
            action_type: actionType,
            description
        });
    } catch (e) { /* silent fail */ }
}

/**
 * Show access denied overlay
 */
function showAccessDenied(message) {
    const overlay = document.createElement('div');
    overlay.id = 'access-denied-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(10,14,26,0.95);z-index:10000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px;text-align:center;';
    overlay.innerHTML = `
        <div style="font-size:64px">🔒</div>
        <h2 style="color:#f1f5f9;font-size:1.5rem;">Доступ запрещён</h2>
        <p style="color:#94a3b8;max-width:400px;line-height:1.6;">${message}</p>
        <p style="color:#64748b;font-size:0.8rem;margin-top:20px;">Обратитесь к администратору для получения доступа</p>
    `;
    document.body.appendChild(overlay);
}

// ===== MAIN INIT: Auth Check =====
(async function initAuth() {
    let result = await checkAdminAuth();
    if (result.userInfo) {
        currentUserInfo = result.userInfo;
    }
    if (!result.allowed) {
        showAccessDenied(result.message || 'Доступ запрещён');
        return; // Don't attach button handlers
    }

    // Display auth status
    const authStatusDiv = document.getElementById('authStatus');
    if (authStatusDiv && result.user) {
        let subText = '';
        if (result.user.hasSubscription) {
            subText = `<span style="color: #4ade80;">Безлимит до: ${result.user.subscription_end.split('T')[0]}</span>`;
        } else {
            subText = `<span style="color: #4ade80;">Кредитов: ${result.user.credits || 0} ПИ</span>`;
        }

        const fio = result.user.fio || result.user.iin || '';
        // Показываем Фамилию + Инициалы (напр. Турлубеков М.Т.)
        const fioParts = fio.trim().split(/\s+/);
        const shortFio = fioParts.length >= 2
            ? fioParts[0] + ' ' + fioParts.slice(1).map(p => p[0] ? p[0] + '.' : '').join('')
            : fio;

        authStatusDiv.innerHTML = `
            <div style="font-size: 10px; color: #64748b; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Добро пожаловать</div>
            <div style="font-weight: 700; font-size: 13px; color: #f1f5f9; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${fio}">${shortFio}</div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #4ade80;"></span>
                <span style="font-size: 11px;">${subText}</span>
            </div>
        `;
        authStatusDiv.style.display = 'block';
    }

    // Register state listener for background process
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.extractionState) {
            console.log('[Popup] State changed in storage:', changes.extractionState.newValue.status);
            handleStateUpdate(changes.extractionState.newValue);
        }
    });

    // Backup: explicit message from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'STATE_UPDATED') {
            console.log('[Popup] Received direct state update message:', msg.state.status);
            handleStateUpdate(msg.state);
        }
    });



    // Initial state check
    const { extractionState } = await chrome.storage.local.get('extractionState');
    if (extractionState) {
        // Если статус висит в PROCESSING более 5 минут — считаем его зависшим и сбрасываем
        const now = Date.now();
        const isStuck = extractionState.status === 'PROCESSING' &&
            extractionState.timestamp &&
            (now - extractionState.timestamp > 300000); // 5 минут

        if (isStuck) {
            console.log('[Init] Detected stuck extraction state, resetting...');
            chrome.runtime.sendMessage({ action: 'RESET_STATE' });
        } else {
            handleStateUpdate(extractionState);
        }
    }

    // Auto-expand if opened in a large window (standalone/tab)
    if (window.innerWidth > 500) {
        const container = document.getElementById('mainContainer');
        if (container) {
            container.classList.add('expanded');
            document.body.style.width = '100vw';
        }
    }

    // Log successful auth check
    if (!result.offline) {
        sendAdminLog('AUTH_CHECK', 'Расширение открыто');
    }
})();

/**
 * Handle state changes from background process
 */
function handleStateUpdate(state) {
    if (!state) return;

    if (state.status === 'PROCESSING') {
        showLoading(true, state.progressMessage, state.extractionStartTime);
        setStatus(state.progressMessage || 'Обработка документов...');
    } else if (state.status === 'SUCCESS') {
        const localDuration = showLoading(false);
        const duration = state.extractionDuration || localDuration;
        if (state.result) {
            renderPreview(state.result);
            setStatus(`✅ Время обработки заняло ${duration} времени`);
        }
    } else if (state.status === 'ERROR') {
        showLoading(false);
        const errorMsg = state.error || 'Произошла ошибка';
        setStatus('❌ ' + errorMsg);
        showError(errorMsg);
    } else if (state.status === 'IDLE') {
        showLoading(false);
        // Do not clear status if we have files selected
        if (!window.appExtensionFiles || window.appExtensionFiles.length === 0) {
            setStatus('');
        }
    }
}

let _pollingTimer = null;

/**
 * Активно опрашивает storage каждые 2 сек пока не получит SUCCESS/ERROR.
 * Нужен для tab-режима, где chrome.storage.onChanged может не сработать.
 */
function startPollingForResult() {
    if (_pollingTimer) clearInterval(_pollingTimer);

    _pollingTimer = setInterval(async () => {
        const { extractionState } = await chrome.storage.local.get('extractionState');
        if (!extractionState) return;

        const status = extractionState.status;
        if (status === 'SUCCESS' || status === 'ERROR') {
            clearInterval(_pollingTimer);
            _pollingTimer = null;
            handleStateUpdate(extractionState);
        } else if (status === 'PROCESSING') {
            // Обновляем прогресс-сообщение
            if (extractionState.progressMessage) {
                setStatus(extractionState.progressMessage);
            }
        }
    }, 2000);

    // Автоматически останавливаем через 10 минут (safety)
    setTimeout(() => {
        if (_pollingTimer) {
            clearInterval(_pollingTimer);
            _pollingTimer = null;
        }
    }, 600000);
}

document.getElementById('resetBtn').onclick = () => {
    chrome.runtime.sendMessage({ action: 'RESET_STATE' });
    // Останавливаем polling если был запущен
    if (_pollingTimer) { clearInterval(_pollingTimer); _pollingTimer = null; }
    window.appExtensionFiles = [];
    if (typeof renderFileList === 'function') renderFileList();
    if (typeof setStatus === 'function') setStatus('');
    if (typeof showLoading === 'function') showLoading(false);
    currentAIData = null;

    // Hide preview and validation if open
    const previewArea = document.getElementById('previewArea');
    if (previewArea) previewArea.style.display = 'none';
    const mainContainer = document.getElementById('mainContainer');
    if (mainContainer) {
        mainContainer.classList.remove('expanded');
        document.body.style.width = '380px';
    }
    const validationSummary = document.getElementById('validationSummary');
    if (validationSummary) validationSummary.innerHTML = '';
};

const openTabBtn = document.getElementById('openTabBtn');
if (openTabBtn) {
    openTabBtn.onclick = () => {
        logButtonClick('openTabBtn');
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    };
}

document.getElementById('startBtn').onclick = async () => {
    logButtonClick('startBtn');
    const files = window.appExtensionFiles || [];

    if (files.length === 0) {
        showToast('Пожалуйста, выберите хотя бы один файл', 'error');
        return;
    }

    showLoading(true, 'Подготовка файлов...');

    try {
        // =====================================================
        // ФАЗА 1: Подготовка файлов (последовательно, быстро)
        // =====================================================
        const fileJobs = [];

        for (const file of files) {
            const fileName = file.name.toLowerCase();
            const isImage = /\.(png|jpe?g|webp)$/.test(fileName);
            const isExcel = /\.(xlsx|xls)$/.test(fileName);
            let filePart = null;
            let mimeType = file.type || 'application/octet-stream';

            try {
                if (fileName.endsWith('.pdf')) {
                    try {
                        let text = await readPDF(file);
                        // Если PDF цифровой (есть текст), используем текст - это быстрее и дешевле
                        if (text.trim().length < 100) throw new Error('Scan detected');

                        const MAX_CHARS = 30000;
                        if (text.length > MAX_CHARS) {
                            text = text.substring(0, MAX_CHARS) + '\n... [TRUNCATED]';
                        }
                        filePart = { text: `--- FILE: ${file.name} (PDF Content) ---\n${text}\n` };
                    } catch (pdfErr) {
                        console.log(`📎 ${file.name}: скан PDF, рендерим страницы как изображения...`);
                        filePart = await renderPDFPagesAsImages(file, 5); // рендерим первые 5 страниц
                    }
                } else if (isExcel) {
                    console.log(`📊 ${file.name}: Excel, отправляем на анализ...`);
                    const text = await readExcel(file);
                    if (!text || text.length < 10) {
                        throw new Error("Файл Excel пустой или не читается");
                    }
                    filePart = { text: `--- FILE: ${file.name} (Excel Content) ---\n${text}\n` };
                } else if (isImage) {
                    console.log(`🖼️ ${file.name}: изображение, отправляем на анализ...`);
                    const base64 = await fileToOptimizedBase64(file);
                    filePart = { inlineData: { data: base64, mimeType: 'image/jpeg' } };
                } else {
                    let text = await file.text();
                    const MAX_CHARS = 30000;
                    if (text.length > MAX_CHARS) {
                        text = text.substring(0, MAX_CHARS) + '\n... [TRUNCATED]';
                    }
                    filePart = { text: `--- FILE: ${file.name} (Text Content) ---\n${text}\n` };
                }
            } catch (prepErr) {
                console.warn(`Ошибка подготовки ${file.name}:`, prepErr);
                filePart = { text: `--- FILE: ${file.name} (Could not read) ---\n` };
            }

            fileJobs.push({ file, filePart, mimeType });
        }

        // =====================================================
        // ФАЗА 2: Передача в Background для SSE (Transport Layer v2)
        // =====================================================
        setStatus(`🚀 Передача ${files.length} файлов в фоновый поток...`);

        // Нам нужно знать ID текущей вкладки, чтобы background мог отправить туда FILL_PI_DATA
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('keden.kgd.gov.kz')) {
            const tabs = await chrome.tabs.query({ url: "*://keden.kgd.gov.kz/*" });
            const kedenTab = tabs.find(t => t.url && t.url.includes('keden.kgd.gov.kz'));
            if (kedenTab) tab = kedenTab;
        }

        const documents = fileJobs.map(job => ({
            fileName: job.file.name,
            parts: Array.isArray(job.filePart) ? job.filePart : [job.filePart]
        }));

        chrome.runtime.sendMessage({
            action: 'START_EXTRACTION',
            payload: {
                documents,
                iin: currentUserInfo ? currentUserInfo.iin : '000000000000',
                targetTabId: tab ? tab.id : null
            }
        });

        // Активный polling — garantiert рендеринг даже если storage.onChanged не сработал
        startPollingForResult();

    } catch (error) {
        console.error(error);
        setStatus('❌ ' + error.message);
        showLoading(false);
    }
};

// fileInput.onchange is handled globally in ui.js now

document.getElementById('confirmFillBtn').onclick = async () => {
    logButtonClick('confirmFillBtn');

    // Validation errors check removed as per user request to never block filling
    /*
    if (currentAIData && currentAIData.validation && currentAIData.validation.errors && currentAIData.validation.errors.length > 0) {
        showToast('Пожалуйста, исправьте ошибки перед заполнением. ' + currentAIData.validation.errors[0].message, 'error');
        return;
    }
    */

    const scrapedData = scrapePreviewData();
    if (!scrapedData) return;
    if (currentUserInfo && currentUserInfo.iin) {
        if (!scrapedData.counteragents) scrapedData.counteragents = {};
        scrapedData.counteragents.filler = { iin: currentUserInfo.iin };
    }
    showLoading(true, '🚀 Заполнение ПИ...');
    setStatus('🚀 Заполнение ПИ...');

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('keden.kgd.gov.kz')) {
            const tabs = await chrome.tabs.query({ url: "*://keden.kgd.gov.kz/*" });
            const kedenTab = tabs.find(t => t.url && t.url.includes('keden.kgd.gov.kz'));
            if (kedenTab) tab = kedenTab;
            else throw new Error('Откройте вкладку Keden с ПИ декларацией');
        }

        chrome.tabs.sendMessage(tab.id, { action: 'FILL_PI_DATA', data: scrapedData }, (response) => {
            if (chrome.runtime.lastError) {
                setStatus('❌ Ошибка: Обновите страницу Keden');
                showLoading(false);
                return;
            }
            if (response && response.success) {
                setStatus('✅ Готово! Данные успешно отправлены.');
                sendAdminLog('FILL_PI', `Заполнение ПИ декларации`);
            } else {
                setStatus('❌ ' + (response ? response.error : 'Ошибка'));
            }
            showLoading(false);
        });
    } catch (error) {
        console.error(error);
        setStatus('❌ ' + error.message);
        showLoading(false);
    }
};
