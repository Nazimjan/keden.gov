const fs = require('fs').promises;
const path = require('path');

const { analyzeFile } = require('../services/ai.service');
const { validateProductCodes, enrichCounterAgentsBIN } = require('../services/validators');
const db = require('../db');
const { mergeAgentResultsJS } = require('../services/merger');

function sendSSE(res, eventType, data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
}

async function handleExtract(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const emit = (msg) => {
        console.log(`[SSE] ${msg}`);
        sendSSE(res, 'status', msg);
    };
    const done = (data) => { sendSSE(res, 'complete', data); res.end(); };
    const fail = (msg) => { sendSSE(res, 'error', { message: msg }); res.end(); };

    console.log('--- NEW EXTRACT REQUEST (Multipart) ---');

    let tempFilePaths = (req.files || []).map(f => f.path);

    try {
        // ─── 1. Валидация и парсинг метаданных ────────────────────────────────────
        const { iin } = req.body;
        let metadata;
        try {
            metadata = JSON.parse(req.body.metadata || '[]');
        } catch (e) {
            return fail('Ошибка парсинга метаданных');
        }

        if (!iin) return fail('ИИН пользователя обязателен');
        if (!metadata || metadata.length === 0) {
            return fail('Необходимо передать хотя бы один документ (метаданные)');
        }

        // ─── 2. Проверка пользователя ─────────────────────────────────────────────
        const user = db.getUserByIin(iin);
        if (!user) return fail('Пользователь не найден.');
        if (!user.is_allowed) return fail('Доступ заблокирован.');

        const now = new Date();
        const hasSubscription = user.subscription_end && new Date(user.subscription_end) > now;
        if (!hasSubscription && user.credits <= 0) {
            return fail('Закончились кредиты.');
        }

        // ─── 3. Реконструкция массива documents для ИИ ────────────────────────────
        // Мы сопоставляем 'file' в метаданных с файлами в req.files
        let filePtr = 0;
        const documents = metadata.map(doc => {
            return {
                fileName: doc.fileName,
                parts: doc.parts.map(part => {
                    if (part.type === 'file') {
                        const file = req.files[filePtr++];
                        return {
                            inlineData: {
                                mimeType: file.mimetype,
                                path: file.path // Передаем путь вместо данных в base64!
                            }
                        };
                    }
                    return part; // {type: 'text', text: '...'}
                })
            };
        });

        // ─── 4. Пайплайн: ИИ-анализ (BATCH MODE) ──────────────────────────────────
        emit('🤖 Запуск пакетного анализа всех документов...');

        const { analyzeAllFiles } = require('../services/ai.service');
        const filePartsArray = documents.map(d => d.parts);
        const fileNameArray = documents.map(d => d.fileName);

        // В пакетном режиме ИИ видит все файлы сразу и сам делает мерж по промпту
        const aiResult = await analyzeAllFiles(filePartsArray, fileNameArray, emit);

        // ─── 5. Валидация ────────────────────────────────────────────────────────
        emit('🔍 Серверная валидация...');
        const allWarnings = [...(aiResult.validation?.warnings || [])];

        console.log(`[Extract] Starting product/BIN validation...`);
        try {
            const [tnvedResults, { binWarnings }] = await Promise.all([
                validateProductCodes(aiResult.mergedData?.products || [], emit),
                enrichCounterAgentsBIN(aiResult.mergedData || {}, emit)
            ]);
            console.log(`[Extract] Validation finished. TNVED: ${tnvedResults.length}, BIN: ${binWarnings.length}`);

            binWarnings.forEach(w => allWarnings.push({ field: 'counteragent.bin', message: w, severity: 'WARNING' }));

            if (aiResult.mergedData?.products) {
                tnvedResults.forEach(({ index, valid, description, reason }) => {
                    if (aiResult.mergedData.products[index]) {
                        aiResult.mergedData.products[index].tnvedValid = valid;
                        if (valid && description) aiResult.mergedData.products[index].tnvedDescription = description;
                        if (!valid) allWarnings.push({ field: `products[${index}].tnvedCode`, message: `Код ТН ВЭД не найден`, severity: 'WARNING' });
                    }
                });
            }
        } catch (vErr) {
            console.warn('[Extract] Validation error:', vErr.message);
        }

        // ─── 6. Биллинг ─────────────────────────────────────────────────────────
        console.log(`[Extract] Processing billing for ${iin}...`);
        let remainingCredits = user.credits;
        if (!hasSubscription && user.credits > 0) {
            db.updateUser(user.id, { credits: user.credits - 1 });
            remainingCredits = user.credits - 1;
            console.log(`[Extract] Credits deducted. Remaining: ${remainingCredits}`);
        }

        db.addLog({
            user_iin: iin,
            user_fio: user.fio || '',
            action_type: 'AI_EXTRACT',
            description: `Обработано документов: ${documents.length}`
        });
        console.log(`[Extract] Log entry added.`);

        // ─── 7. Ответ ───────────────────────────────────────────────────────────
        emit('✅ Готово!');
        console.log(`[Extract] Sending complete event...`);
        done({
            success: true,
            payload: aiResult.mergedData,
            documents: aiResult.documents,
            warnings: allWarnings,
            credits: remainingCredits
        });
        console.log(`[Extract] Request handled successfully.`);

    } catch (err) {
        console.error('[Extract] Critical Error:', err);
        fail(`Ошибка сервера: ${err.message}`);
    } finally {
        // ГАРАНТИРОВАННАЯ ОЧИСТКА ВРЕМЕННЫХ ФАЙЛОВ
        for (const filePath of tempFilePaths) {
            try {
                await fs.unlink(filePath);
                console.log(`[Cleanup] Deleted temp file: ${filePath}`);
            } catch (e) {
                console.error(`[Cleanup] Failed to delete ${filePath}:`, e.message);
            }
        }
    }
}

module.exports = { handleExtract };
