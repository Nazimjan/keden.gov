/**
 * background.js — Service Worker расширения (Manifest V3).
 * Отвечает за долгие сетевые запросы (SSE) к бэкенду.
 * Не зависит от жизни окна Popup.
 */

const EXTRACT_URL = 'http://localhost:3001/api/v1/extract';

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
 * Основная логика получения данных по SSE
 */
async function handleExtraction(documents, iin, targetTabId) {
    await updateState({
        status: 'PROCESSING',
        progressMessage: 'Подключение к серверу...',
        targetTabId,
        result: null,
        error: null
    });

    let reader, decoder;

    try {
        const formData = new FormData();
        formData.append('iin', iin);
        formData.append('targetTabId', targetTabId);

        const metadata = [];
        documents.forEach((doc, index) => {
            const docMeta = { fileName: doc.fileName, parts: [] };

            doc.parts.forEach(part => {
                if (part.inlineData) {
                    const byteCharacters = atob(part.inlineData.data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: part.inlineData.mimeType });

                    // Добавляем файл в FormData под именем 'files'
                    formData.append('files', blob, doc.fileName);
                    // В метаданных помечаем, что здесь должен быть файл (по индексу в массиве files)
                    docMeta.parts.push({ type: 'file' });
                } else if (part.text) {
                    docMeta.parts.push({ type: 'text', text: part.text });
                }
            });
            metadata.push(docMeta);
        });

        formData.append('metadata', JSON.stringify(metadata));

        if (currentAbortController) currentAbortController.abort();
        currentAbortController = new AbortController();

        const response = await fetch(EXTRACT_URL, {
            method: 'POST',
            body: formData,
            headers: { 'Accept': 'text/event-stream' },
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Сервер вернул ошибку ${response.status}: ${errData.message || response.statusText}`);
        }

        reader = response.body.getReader();
        decoder = new TextDecoder('utf-8');
        let buffer = '';

        let lastUpdate = 0;
        const UPDATE_THROTTLE = 200; // ms

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const messages = buffer.split('\n\n');
            buffer = messages.pop() || '';

            for (const message of messages) {
                if (!message.trim()) continue;

                const lines = message.split('\n');
                let eventType = 'message', data = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) eventType = line.slice(7).trim();
                    if (line.startsWith('data: ')) data = line.slice(6).trim();
                }

                if (!data) continue;

                if (eventType === 'status') {
                    // Троттлинг обновлений статуса, чтобы не забивать chrome.storage
                    const now = Date.now();
                    if (now - lastUpdate > UPDATE_THROTTLE) {
                        await updateState({ progressMessage: data });
                        lastUpdate = now;
                    }
                } else if (eventType === 'complete') {
                    const resultData = JSON.parse(data);
                    if (resultData.success && resultData.payload) {
                        const finalResult = {
                            documents: resultData.documents || [],
                            validation: {
                                errors: resultData.errors || [],
                                warnings: resultData.warnings || []
                            },
                            mergedData: resultData.payload,
                            credits: resultData.credits,
                            // Reconstruct rawFiles for content script (TЗ Box 44 automation)
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

                        // Прямая инъекция во вкладку пользователя
                        if (targetTabId) {
                            chrome.tabs.sendMessage(targetTabId, {
                                action: 'FILL_PI_DATA',
                                data: finalResult.mergedData
                            }).catch(e => console.warn('Could not inject to tab:', e));
                        }
                    } else {
                        throw new Error(resultData.message || 'Сервер не вернул данные');
                    }
                    return;
                } else if (eventType === 'error') {
                    let errObj;
                    try { errObj = JSON.parse(data); } catch (_) { errObj = { message: data }; }
                    throw new Error(errObj.message || 'Ошибка на сервере');
                }
            }
        }

        throw new Error('Сервер закрыл соединение без ответа');

    } catch (err) {
        await updateState({ status: 'ERROR', error: err.message });
        throw err;
    } finally {
        try { reader?.cancel(); } catch (_) { }
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
