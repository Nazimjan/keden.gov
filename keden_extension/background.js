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
    timestamp: null
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
});

/**
 * Основная логика: Загрузка в Storage + Вызов Edge Function
 */
async function handleExtraction(documents, iin, targetTabId) {
    await updateState({
        status: 'PROCESSING',
        progressMessage: 'Загрузка документов в хранилище...',
        targetTabId,
        result: null,
        error: null
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

                    const { data, error } = await supabaseClient.storage
                        .from('documents')
                        .upload(fileName, blobData, {
                            contentType: mimeType,
                            upsert: true
                        });

                    if (error) throw new Error(`Ошибка загрузки ${doc.fileName}: ${error.message}`);
                    storagePaths.push(data.path);
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

        // Нормализуем структуру: Edge Function возвращает flat-объект,
        // а renderPreview ожидает { counteragents: { consignor, consignee, carrier, declarant }, vehicles, driver, products }
        const aiDocuments = resultData.documents || [];
        const mergedData = {
            counteragents: {
                consignor: resultData.consignor || null,
                consignee: resultData.consignee || null,
                carrier: resultData.carrier || null,
                declarant: resultData.declarant || null,
                filler: resultData.filler || null
            },
            vehicles: resultData.vehicles || { tractorRegNumber: '', tractorCountry: '', trailerRegNumber: '', trailerCountry: '' },
            countries: resultData.countries || { departureCountry: '', destinationCountry: '' },
            products: resultData.products || [],
            registry: resultData.registry || { number: '', date: '' },
            driver: resultData.driver || { present: false, iin: '', firstName: '', lastName: '' },
            shipping: resultData.shipping || { customsCode: '', destCustomsCode: '', transportMode: '' }
        };

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
            validation: { errors: [], warnings: [] },
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

        await updateState({ status: 'SUCCESS', result: finalResult, progressMessage: 'Готово!' });

        if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, {
                action: 'FILL_PI_DATA',
                data: finalResult.mergedData
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

// Keep-alive logic: Service Workers in MV3 can be suspended. 
// Active FETCH/SSE keeps it alive for 30s-5min, but we can also use Alarms if needed.
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        console.log('[Background] Keep-alive tick');
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
