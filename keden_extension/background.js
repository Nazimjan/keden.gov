/**
 * background.js — Service Worker расширения (Manifest V3).
 * Отвечает за долгие сетевые запросы к Supabase.
 */

importScripts('lib/supabase.js');
importScripts('supabase_config.js');

const supabaseClient = supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);
const EXTRACT_URL = SUPABASE_CONFIG.EDGE_FUNCTION_URL;

// При клике на иконку расширения — открываем в новой вкладке
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

// Состояние по умолчанию
const INITIAL_STATE = {
    status: 'IDLE', // IDLE, PROCESSING, SUCCESS, ERROR
    progressMessage: '',
    result: null,
    targetTabId: null,
    error: null,
    timestamp: null,
    extractionStartTime: null,
    extractionDuration: null
};

/**
 * Обновляет состояние в chrome.storage.local
 */
async function updateState(updates) {
    const data = await chrome.storage.local.get('extractionState');
    const newState = { ...(data.extractionState || INITIAL_STATE), ...updates, timestamp: Date.now() };
    await chrome.storage.local.set({ extractionState: newState });

    // Notify open popup or other pages
    chrome.runtime.sendMessage({ action: 'STATE_UPDATED', state: newState }).catch(() => { });

    return newState;
}

let currentAbortController = null;

/**
 * Слушатель сообщений от Popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_EXTRACTION') {
        const { documents, iin, targetTabId } = request.payload;

        // Запускаем процесс асинхронно
        handleExtraction(documents, iin, targetTabId).catch(err => {
            if (err.name === 'AbortError') {
                console.log('[Background] Extraction aborted by user');
                return;
            }
            console.error('[Background] Extraction error:', err);
            updateState({ status: 'ERROR', error: err.message });
        });

        // Отвечаем сразу, что процесс пошел
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'RESET_STATE') {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }
        updateState(INITIAL_STATE).then(() => sendResponse({ success: true }));
        return true;
    }

    if (request.action === 'CHECK_ACCESS') {
        const { iin } = request.payload;
        supabaseClient.functions.invoke('extract-ai', {
            body: { action: 'check_access', iin }
        })
            .then(res => {
                if (res.error) throw new Error(res.error.message);
                sendResponse({ success: true, ...res.data });
            })
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'LOG_ACTION') {
        const { iin, action_type, description } = request.payload;
        supabaseClient.functions.invoke('extract-ai', {
            body: { action: 'log', iin, action_type, description }
        })
            .then(res => sendResponse({ success: true, ...res.data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'ANALYZE_SINGLE') {
        const { document, iin } = request.payload;
        handleSingleExtraction(document, iin)
            .then(result => sendResponse({ success: true, result }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'ANALYZE_BATCH') {
        const { fileParts, fileNames, iin } = request.payload;
        // In Supabase, we already have handleExtraction which does storage upload + AI.
        // But gemini.js might be sending parts directly.
        // For simplicity, let's just use the existing START_EXTRACTION logic if we can,
        // or a similar one here if it only expects result without state update.
        handleExtraction(fileParts.map((p, i) => ({ parts: Array.isArray(p) ? p : [p], fileName: fileNames[i] })), iin)
            .then(finalResult => sendResponse({ success: true, result: finalResult.mergedData }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
});


async function handleSingleExtraction(doc, iin) {
    const storagePaths = [];
    const originalFileNames = [];

    for (const part of doc.parts) {
        let blobData, mimeType;
        if (part.inlineData) {
            const byteCharacters = atob(part.inlineData.data);
            blobData = new Uint8Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                blobData[i] = byteCharacters.charCodeAt(i);
            }
            mimeType = part.inlineData.mimeType;
        } else if (part.text) {
            blobData = new TextEncoder().encode(part.text);
            mimeType = 'text/plain';
        }

        if (blobData) {
            const fileExt = mimeType === 'text/plain' ? '.txt' : '';
            const sanitizedBaseName = doc.fileName.replace(/\s+/g, '_').replace(/[^\w.-]/gi, '');
            const fileName = `${iin}_${Date.now()}_${sanitizedBaseName || 'document'}${fileExt}`;
            const { data, error } = await supabaseClient.storage.from('documents').upload(fileName, blobData, { contentType: mimeType, upsert: true });
            if (error) throw new Error(`Ошибка загрузки: ${error.message}`);
            storagePaths.push(data.path);
            originalFileNames.push(doc.fileName);
        }
    }

    const { data: resultData, error: funcError } = await supabaseClient.functions.invoke('extract-ai', {
        body: { storagePaths, iin, originalFileNames }
    });
    if (funcError) throw new Error(funcError.message);

    return resultData;
}

/**
 * Загрузка файла в Supabase Storage с retry при ошибках 5xx (например, HTTP 520 от Cloudflare).
 * Параметры: до maxRetries попыток, задержка удваивается каждый раз (exponential backoff).
 */
async function uploadWithRetry(fileName, blobData, mimeType, originalName, maxRetries = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const { data, error } = await supabaseClient.storage
            .from('documents')
            .upload(fileName, blobData, {
                contentType: mimeType,
                upsert: true
            });

        if (!error) return data; // успех

        lastError = error;
        const is5xx = error.message && (
            error.message.includes('520') ||
            error.message.includes('502') ||
            error.message.includes('503') ||
            error.message.includes('504') ||
            error.message.includes('500')
        );

        if (!is5xx || attempt === maxRetries) {
            // Не 5xx или исчерпаны попытки — сразу бросаем
            throw new Error(`Ошибка загрузки ${originalName}: ${error.message}`);
        }

        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
        console.warn(`[Background] Upload attempt ${attempt}/${maxRetries} failed (${error.message}). Retry in ${delay}ms...`);
        await updateState({ progressMessage: `Повтор загрузки "${originalName}" (попытка ${attempt + 1})...` });
        await new Promise(r => setTimeout(r, delay));
    }
    throw new Error(`Ошибка загрузки ${originalName}: ${lastError?.message}`);
}

/**
 * Основная логика: Загрузка в Storage + Вызов Edge Function
 */
async function handleExtraction(documents, iin, targetTabId) {
    await updateState({
        status: 'PROCESSING',
        progressMessage: 'Загрузка документов в хранилище...',
        targetTabId,
        result: null,
        error: null,
        extractionStartTime: Date.now(),
        extractionDuration: null
    });

    try {
        const storagePaths = [];
        // Маппинг: индекс пути → оригинальное имя файла
        const originalFileNames = [];

        // 1. Загрузка файлов в Supabase Storage
        for (const doc of documents) {
            for (const part of doc.parts) {
                let blobData, mimeType;
                if (part.inlineData) {
                    const byteCharacters = atob(part.inlineData.data);
                    blobData = new Uint8Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        blobData[i] = byteCharacters.charCodeAt(i);
                    }
                    mimeType = part.inlineData.mimeType;
                } else if (part.text) {
                    blobData = new TextEncoder().encode(part.text);
                    mimeType = 'text/plain';
                }

                if (blobData) {
                    const fileExt = mimeType === 'text/plain' ? '.txt' : '';
                    const sanitizedBaseName = doc.fileName
                        .replace(/\s+/g, '_')
                        .replace(/[^\w.-]/gi, '');

                    const fileName = `${iin}_${Date.now()}_${sanitizedBaseName || 'document'}${fileExt}`;

                    const uploadedData = await uploadWithRetry(fileName, blobData, mimeType, doc.fileName);
                    storagePaths.push(uploadedData.path);
                    // Запоминаем оригинальное имя в том же порядке
                    originalFileNames.push(doc.fileName);
                }
            }
        }

        await updateState({ progressMessage: 'ИИ анализирует документы...' });

        // 2. Вызов Edge Function — передаём originalFileNames чтобы ИИ мог вернуть их в документах
        const { data: resultData, error: funcError } = await supabaseClient.functions.invoke('extract-ai', {
            body: { storagePaths, iin, originalFileNames }
        });

        if (funcError) {
            console.error('[Background] Functions error:', funcError);
            let moreInfo = '';
            if (funcError.context) {
                try {
                    const text = await funcError.context.text();
                    const body = JSON.parse(text);
                    moreInfo = body.error || body.message || text;
                } catch (e) {
                    moreInfo = funcError.context.statusText || '';
                }
            }
            throw new Error(`Ошибка ИИ: ${moreInfo || funcError.message}`);
        }

        // Server-side merging logic (merger.ts) already returned a complete structured object:
        // { documents, validation, mergedData }
        const mergedData = resultData.mergedData || {
            counteragents: { consignor: null, consignee: null, carrier: null, declarant: null, filler: null },
            vehicles: { tractorRegNumber: '', tractorCountry: '', trailerRegNumber: '', trailerCountry: '' },
            countries: { departureCountry: '', destinationCountry: '' },
            products: [],
            registry: { number: '', date: '' },
            driver: { present: false, iin: '', firstName: '', lastName: '' },
            shipping: { customsCode: '', destCustomsCode: '', transportMode: '' }
        };

        const validation = resultData.validation || { errors: [], warnings: [] };
        const aiDocuments = resultData.documents || [];

        const finalResult = {
            documents: documents.map((d, idx) => {
                let aiDoc = aiDocuments[idx];
                if (!aiDoc) {
                    aiDoc = aiDocuments.find(ad =>
                        ad.filename && (
                            ad.filename === d.fileName ||
                            d.fileName.toLowerCase().includes(ad.filename.toLowerCase()) ||
                            ad.filename.toLowerCase().includes(d.fileName.toLowerCase())
                        )
                    );
                }
                return {
                    filename: d.fileName,
                    type: aiDoc?.type || '',
                    number: aiDoc?.number || '',
                    date: aiDoc?.date || ''
                };
            }),
            validation,
            mergedData,
            rawFiles: documents.map(doc => {
                const part = doc.parts[0];
                return {
                    name: doc.fileName,
                    base64: part.inlineData ? part.inlineData.data : btoa(unescape(encodeURIComponent(part.text || ''))),
                    mimeType: part.inlineData ? part.inlineData.mimeType : 'text/plain',
                    isBinary: !!part.inlineData
                };
            })
        };

        const storedData = await chrome.storage.local.get('extractionState');
        const startTime = storedData.extractionState?.extractionStartTime;
        let durationStr = null;
        if (startTime) {
            const diffSeconds = (Date.now() - startTime) / 1000;
            const mins = Math.floor(diffSeconds / 60);
            const secs = Math.floor(diffSeconds % 60);
            const ms = Math.floor((diffSeconds % 1) * 10);
            durationStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
        }

        const historyItem = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            duration: durationStr,
            files: documents.map(d => d.fileName),
            result: {
                ...finalResult,
                rawFiles: [] // Don't store large base64 files in history
            }
        };

        await addToHistory(historyItem);

        await updateState({
            status: 'SUCCESS',
            result: finalResult,
            progressMessage: 'Готово!',
            extractionDuration: durationStr
        });

        if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, {
                action: 'FILL_PI_DATA',
                data: finalResult
            }).catch(e => console.warn('Could not inject to tab:', e));
        }

    } catch (err) {
        console.error('[Supabase Extraction] Error:', err);
        await updateState({ status: 'ERROR', error: err.message });
        throw err;
    } finally {
        currentAbortController = null;
    }
}

async function addToHistory(item) {
    try {
        const { history = [] } = await chrome.storage.local.get('history');
        // Prepend new item
        const newHistory = [item, ...history].slice(0, 50); // Keep last 50
        await chrome.storage.local.set({ history: newHistory });

    } catch (e) {
        console.error('[Background] Failed to save history:', e);
    }
}

// Keep-alive logic: Service Workers in MV3 can be suspended. 
// Active FETCH/SSE keeps it alive for 30s-5min, but we can also use Alarms if needed.
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {

    }
});

// Периодический "будильник" для поддержания жизни во время долгого процесса
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.extractionState) {
        const state = changes.extractionState.newValue;
        if (state.status === 'PROCESSING') {
            chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
        } else {
            chrome.alarms.clear('keepAlive');
        }
    }
});
