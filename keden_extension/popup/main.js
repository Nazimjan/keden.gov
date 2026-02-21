/**
 * KEDEN Extension - POPUP (Main Entry Point)
 * Swarm Agent Architecture: 2-Phase Processing
 * + Admin Panel Auth Integration
 */

const ADMIN_API = 'http://localhost:3001';
let currentUserInfo = null; // Will store { iin, fio } after auth check

/**
 * Fetch user info directly from the Keden tab's localStorage via scripting API
 */
async function getKedenUserInfo() {
    try {
        const tabs = await chrome.tabs.query({ url: "*://test-keden.kgd.gov.kz/*" });
        const kedenTab = tabs.find(t => t.url && t.url.includes('keden.kgd.gov.kz'));
        if (!kedenTab) return null;

        const results = await chrome.scripting.executeScript({
            target: { tabId: kedenTab.id },
            func: () => {
                try {
                    const authStorage = localStorage.getItem('auth-storage');
                    if (!authStorage) return null;
                    const state = JSON.parse(authStorage).state;
                    if (!state || !state.token) return null;

                    let iin = '', fio = '';
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
                        } catch (e) { }
                    }
                    if (!iin && state.user) {
                        iin = state.user.iin || '';
                        fio = fio || state.user.fullName || '';
                    }
                    if (!iin && state.userAccountData) {
                        iin = state.userAccountData.iin || '';
                        const ud = state.userAccountData;
                        fio = fio || [ud.lastName, ud.firstName, ud.middleName].filter(Boolean).join(' ');
                    }
                    if (!iin) return null;
                    return { iin, fio: fio || iin };
                } catch (e) { return null; }
            }
        });

        return results && results[0] && results[0].result ? results[0].result : null;
    } catch (e) {
        console.error('[Admin Auth] executeScript failed:', e);
        return null;
    }
}

/**
 * Check authorization against admin backend
 */
async function checkAdminAuth() {
    const userInfo = await getKedenUserInfo();
    if (!userInfo || !userInfo.iin) {
        return { allowed: false, message: 'Не удалось определить пользователя ИС Кеден. Откройте страницу Keden и авторизуйтесь.', userInfo: null };
    }

    try {
        const resp = await fetch(`${ADMIN_API}/api/ext/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ iin: userInfo.iin, fio: userInfo.fio })
        });
        const data = await resp.json();
        return { ...data, userInfo };
    } catch (e) {
        // Admin server offline — allow access (graceful degradation)
        return { allowed: true, message: 'Сервер администрирования недоступен.', userInfo, offline: true };
    }
}

/**
 * Send action log to admin backend
 */
async function sendAdminLog(actionType, description = '') {
    if (!currentUserInfo) return;
    try {
        await fetch(`${ADMIN_API}/api/ext/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                iin: currentUserInfo.iin,
                fio: currentUserInfo.fio,
                action_type: actionType,
                description
            })
        });
    } catch (e) { /* offline */ }
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
    const result = await checkAdminAuth();
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

        authStatusDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color:#94a3b8; font-weight: 600;">${result.user.fio || result.user.iin}</span>
            </div>
            <div>Статус: ${subText}</div>
        `;
        authStatusDiv.style.display = 'block';
    }

    // Log successful auth check
    if (!result.offline) {
        sendAdminLog('AUTH_CHECK', 'Расширение открыто');
    }
})();

document.getElementById('openTabBtn').onclick = () => {
    logButtonClick('openTabBtn');
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
};

document.getElementById('startBtn').onclick = async () => {
    logButtonClick('startBtn');
    const files = window.appExtensionFiles || [];

    if (files.length === 0) {
        alert('Пожалуйста, выберите хотя бы один файл');
        return;
    }

    showLoading(true);

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
                    console.log(`📊 ${file.name}: Excel, отправляем в MiniMax...`);
                    const text = await readExcel(file);
                    if (!text || text.length < 10) {
                        throw new Error("Файл Excel пустой или не читается");
                    }
                    filePart = { text: `--- FILE: ${file.name} (Excel Content) ---\n${text}\n` };
                } else if (isImage) {
                    console.log(`🖼️ ${file.name}: изображение, отправляем в Qwen 3.5...`);
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
        // ФАЗА 2: Анализ всех файлов единым запросом (Batching)
        // =====================================================
        setStatus(`🤖 Отправка ${files.length} файлов единым пакетом для анализа...`);

        const allParts = fileJobs.map(job => job.filePart);
        const fileNames = fileJobs.map(job => job.file.name);

        let finalData;
        try {
            finalData = await analyzeAllFilesAgent(allParts, fileNames);
        } catch (err) {
            throw new Error(`Ошибка пакетного анализа: ${err.message}`);
        }

        const processedFiles = fileJobs.map(job => {
            const fp = job.filePart;
            const base64 = fp.inlineData ? fp.inlineData.data :
                btoa(unescape(encodeURIComponent(fp.text || '')));
            return {
                name: job.file.name,
                base64: base64,
                mimeType: job.mimeType,
                isBinary: !!fp.inlineData
            };
        });

        // =====================================================
        // ФАЗА 3: Отрисовка результатов
        // =====================================================
        finalData.rawFiles = processedFiles; // Attach raw files for later use

        showLoading(false);
        // Pass everything to renderPreview (data + validation + documents list)
        renderPreview(finalData);
        setStatus('✅ Анализ завершен. Проверьте данные и ошибки ниже.');

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
        alert('Пожалуйста, исправьте ошибки перед заполнением. ' + currentAIData.validation.errors[0].message);
        return;
    }
    */

    const scrapedData = scrapePreviewData();
    if (!scrapedData) return;

    showLoading(true);
    setStatus('🚀 Заполнение ПИ...');

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('keden.kgd.gov.kz')) {
            const tabs = await chrome.tabs.query({ url: "*://test-keden.kgd.gov.kz/*" });
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
