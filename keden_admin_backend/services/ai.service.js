/**
 * AI Service — серверная оркестрация запросов к OpenRouter.
 * Ключи API хранятся ТОЛЬКО здесь, никогда не передаются клиенту.
 *
 * Стратегия маршрутизации:
 *   - Документы с картинками (сканы, PDF → base64) → Qwen 3.5 (vision capable)
 *   - Все документы (Batch или индивидуально) -> Qwen 3.5 (лучшее качество)
 */

const { FILE_AGENT_PROMPT, getBatchPrompt } = require('./prompts');

// ─── Конфигурация (переменные окружения → env-файл на сервере) ────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_VISION = process.env.AI_MODEL_VISION || 'qwen/qwen3.5-plus-02-15';
const MODEL_TEXT = process.env.AI_MODEL_TEXT || 'qwen/qwen3.5-plus-02-15'; // Ранее был minimax
const MAX_RETRIES = 3;
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Выдерживает паузу (мс)
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * HTTP-запрос к OpenRouter с логикой повторных попыток (exponential backoff).
 */
async function fetchWithRetry(body, attempt = 1) {
    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://keden.kgd.gov.kz',
                'X-Title': 'Keden AI Server'
            },
            body: JSON.stringify(body)
        });

        let data;
        try { data = await response.json(); }
        catch (e) {
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            throw e;
        }

        // Rate-limit
        if (response.status === 429 || data?.error?.code === 429) {
            const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
            if (attempt >= MAX_RETRIES) throw new Error('Лимит запросов OpenRouter исчерпан');
            console.warn(`[AI] 429 Rate-limit, ожидаем ${delay / 1000}s...`);
            await sleep(delay);
            return fetchWithRetry(body, attempt + 1);
        }

        if (data?.error) throw new Error(`OpenRouter API Error: ${data.error.message || JSON.stringify(data.error)}`);
        if (!response.ok) throw new Error(`API failed: ${response.status}`);

        return data;
    } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
        console.warn(`[AI] Попытка ${attempt}/${MAX_RETRIES} провалилась: ${err.message}. Retry...`);
        await sleep(3000);
        return fetchWithRetry(body, attempt + 1);
    }
}

/**
 * Определяет тип модели по наличию изображений в частях документа.
 * @param {Array} parts - массив частей [{text: '...'} | {inlineData: {mimeType, data}}]
 * @returns {'vision'|'text'}
 */
function normalizeParts(parts) {
    if (!parts) return [];
    if (!Array.isArray(parts)) return [parts];
    return parts.flat();
}

/**
 * Определяет тип модели по наличию изображений в частях документа.
 * @param {Array|object} parts - массив частей [{text: '...'} | {inlineData: {mimeType, data}}] или объект
 * @returns {'vision'|'text'}
 */
function detectDocumentType(parts) {
    const flatParts = normalizeParts(parts);
    return flatParts.some(p => p && p.inlineData) ? 'vision' : 'text';
}

const fs = require('fs');

/**
 * Конвертирует внутренние "parts" в формат OpenAI-compatible content для OpenRouter.
 */
function buildOpenAIContent(parts, prompt, docType) {
    const flatParts = normalizeParts(parts);

    if (docType === 'text') {
        let combinedText = prompt + '\n\n';
        for (const part of flatParts) {
            if (part.text) combinedText += part.text + '\n\n';
        }
        return combinedText;
    }

    // Для Vision моделей
    const content = [{ type: 'text', text: prompt }];
    for (const part of flatParts) {
        if (part.text) {
            content.push({ type: 'text', text: part.text });
        } else if (part.inlineData) {
            // Читаем файл с диска СЕЙЧАС, чтобы не держать его в ОЗУ всё время
            let base64Data;
            if (part.inlineData.path) {
                base64Data = fs.readFileSync(part.inlineData.path).toString('base64');
            } else {
                base64Data = part.inlineData.data;
            }

            content.push({
                type: 'image_url',
                image_url: { url: `data:${part.inlineData.mimeType};base64,${base64Data}` }
            });
        }
    }
    return content;
}

/**
 * Восстанавливает обрезанный AI-ответ в валидный JSON.
 */
function repairAndParseJSON(text) {
    if (!text) throw new Error('Получен пустой ответ от AI');

    // Прямой парсинг
    try { return JSON.parse(text); } catch (_) { }

    let cleaned = text.trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = cleaned.substring(firstBrace, lastBrace + 1);
        try { return JSON.parse(candidate); } catch (_) { }
        cleaned = cleaned.substring(firstBrace);
    } else if (firstBrace !== -1) {
        cleaned = cleaned.substring(firstBrace);
    }

    // Базовая очистка
    cleaned = cleaned
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

    // Достраиваем скобки
    let stack = [], insideString = false, escaped = false;
    for (const c of cleaned) {
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') { insideString = !insideString; continue; }
        if (!insideString) {
            if (c === '{') stack.push('}');
            else if (c === '[') stack.push(']');
            else if (c === '}' || c === ']') { if (stack.at(-1) === c) stack.pop(); }
        }
    }
    if (insideString) cleaned += '"';
    cleaned = cleaned.replace(/[:,\s]+$/, '');
    cleaned += stack.reverse().join('');

    try { return JSON.parse(cleaned); }
    catch (e) { throw new Error(`Не удалось разобрать JSON от AI: ${e.message}`); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Публичные функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Анализирует ОДИН файл.
 * Маршрутизация: vision → Qwen 3.5, text → MiniMax M2.5.
 *
 * @param {Array}  parts    - части файла [{text}|{inlineData}]
 * @param {string} fileName - имя файла (для логов и промпта)
 * @param {Function} [onStatus] - коллбэк(msg: string) для SSE-трансляции статусов
 * @returns {Promise<object>} - распарсенный JSON от AI
 */
async function analyzeFile(parts, fileName, onStatus) {
    const docType = detectDocumentType(parts);
    const model = docType === 'vision' ? MODEL_VISION : MODEL_TEXT;
    const prompt = `Анализируй файл "${fileName}".\n\n${FILE_AGENT_PROMPT}`;

    if (onStatus) onStatus(`🤖 [${docType === 'vision' ? 'Скан' : 'Таблица'}] Анализируем: ${fileName}...`);
    console.log(`[AI] ${model} → ${fileName}`);

    const content = buildOpenAIContent(parts, prompt, docType);
    const data = await fetchWithRetry({
        model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 8192
    });

    if (!data?.choices?.[0]) throw new Error('Некорректный ответ от OpenRouter');
    const result = repairAndParseJSON(data.choices[0].message.content);
    result.filename = fileName;
    return result;
}

/**
 * Анализирует ПАКЕТ файлов в одном запросе (batch-режим).
 * Использует Qwen если хотя бы один файл — скан.
 *
 * @param {Array[]}  fileParts  - массив массивов частей [[...], [...]]
 * @param {string[]} fileNames  - имена файлов
 * @param {Function} [onStatus] - коллбэк для SSE
 * @returns {Promise<object>} - нормализованный Keden PI JSON
 */
async function analyzeAllFiles(fileParts, fileNames, onStatus) {
    const hasVision = fileParts.some(parts => detectDocumentType(parts) === 'vision');
    const model = hasVision ? MODEL_VISION : MODEL_TEXT;
    const prompt = getBatchPrompt(fileNames);

    if (onStatus) onStatus(`🤖 [Batch] Пакетный анализ ${fileParts.length} файлов...`);
    console.log(`[AI] Batch ${model} → [${fileNames.join(', ')}]`);

    const flatParts = fileParts.flat();
    const content = buildOpenAIContent(flatParts, prompt, hasVision ? 'vision' : 'text');

    const data = await fetchWithRetry({
        model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 8192
    });

    if (!data?.choices?.[0]) throw new Error('Некорректный ответ от OpenRouter');
    const result = repairAndParseJSON(data.choices[0].message.content);

    // Нормализуем в ожидаемый формат
    const docTypesFound = (result.documents || []).map(d => ({
        filename: d.filename || d.name || 'Объединенные данные',
        type: d.type || 'OTHER',
        number: d.number || '',
        date: d.date || ''
    }));

    return {
        documents: docTypesFound,
        validation: { errors: [], warnings: [] },
        mergedData: {
            counteragents: {
                consignor: result.consignor || { present: false },
                consignee: result.consignee || { present: false },
                carrier: result.carrier || { present: false },
                declarant: result.declarant || { present: false },
                filler: result.filler || { present: false, role: 'FILLER_DECLARANT' }
            },
            vehicles: result.vehicles || {},
            countries: result.countries || {},
            products: result.products || [],
            registry: result.registry || { number: '', date: '' },
            driver: result.driver || { present: false }
        }
    };
}

module.exports = { analyzeFile, analyzeAllFiles };
