/**
 * Validators Service — серверная валидация данных.
 * Мигрировано из keden_extension/popup/tnved.js и bin-checker.js.
 *
 * НЕ содержит UI-кода. Работает как чистые async-функции.
 */

// ─── TNVED Validation ─────────────────────────────────────────────────────────

const TNVED_API_BASE = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea';

/**
 * Валидирует один код ТН ВЭД через официальный API Кеден.
 * @param {string} code - код ТН ВЭД (6+ цифр)
 * @returns {Promise<{valid: boolean, description?: string, reason?: string}>}
 */
async function validateTNVEDCode(code) {
    if (!code || code.length < 6) {
        return { valid: false, reason: 'Code too short' };
    }
    const codePrefix = code.substring(0, 6);

    try {
        const response = await fetch(`${TNVED_API_BASE}/es/tree/by-code/${codePrefix}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
            const data = await response.json();
            return { valid: true, description: data.title || data.description || '' };
        } else {
            return { valid: false, reason: 'Not found in classifier' };
        }
    } catch (error) {
        console.warn(`[TNVED] Ошибка валидации ${codePrefix}:`, error.message);
        return { valid: false, reason: 'Network error' };
    }
}

/**
 * Параллельно валидирует все коды ТН ВЭД из массива товаров.
 * @param {Array}  products   - [{tnvedCode, ...}]
 * @param {Function} [onStatus] - коллбэк для SSE
 * @returns {Promise<Array>} - [{index, code, valid, description?, reason?}]
 */
async function validateProductCodes(products, onStatus) {
    if (!products || products.length === 0) return [];

    if (onStatus) onStatus(`🔍 Проверка ${products.length} кодов ТН ВЭД...`);

    const results = await Promise.all(
        products.map(async (product, index) => {
            const result = await validateTNVEDCode(product.tnvedCode);
            return { index, code: product.tnvedCode, ...result };
        })
    );

    const invalidCount = results.filter(r => !r.valid).length;
    if (onStatus && invalidCount > 0) {
        onStatus(`⚠️ Найдено ${invalidCount} невалидных кодов ТН ВЭД`);
    }

    return results;
}

// ─── BIN / IIN Validation via uchet.kz ───────────────────────────────────────

const UCHET_API_URL = 'https://pk.uchet.kz/api/web/company/search/';

/**
 * Получает информацию о компании с pk.uchet.kz по БИН/ИИН.
 * @param {string} bin - 12-значный БИН или ИИН
 * @returns {Promise<{name: string, address: string, bin: string}|null>}
 */
async function fetchCompanyByBIN(bin) {
    const cleanBin = (bin || '').replace(/\D/g, '');
    if (cleanBin.length !== 12) return null;

    try {
        const response = await fetch(UCHET_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ page: '1', size: 10, value: cleanBin })
        });

        if (!response.ok) return null;
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const r = data.results[0];
            return { name: r.name || '', address: r.address || '', bin: r.bin || cleanBin };
        }
    } catch (error) {
        console.warn(`[BIN] Ошибка запроса uchet.kz для ${cleanBin}:`, error.message);
    }
    return null;
}

/**
 * Разбирает строку адреса из uchet.kz на структуру Кеден.
 * @param {string} addrStr
 * @returns {object|null}
 */
function parseUchetAddress(addrStr) {
    if (!addrStr) return null;

    const parts = addrStr.split(',').map(p => p.trim());
    const res = { countryCode: 'KZ', region: '', city: '', district: '', street: '', house: '', postalCode: '' };

    parts.forEach(part => {
        const p = part.toLowerCase();
        if (p.includes('область')) res.region = part;
        else if (p.includes('город') || p.startsWith('г.')) res.city = part.replace(/^(город|г\.)\s*/i, '');
        else if (p.includes('округ') || p.includes('район')) res.district = part;
        else if (p.includes('улица') || p.startsWith('ул.')) res.street = part.replace(/^(улица|ул\.)\s*/i, '');
        else if (p.includes('дом') || p.startsWith('д.')) res.house = part.replace(/^(дом|д\.)\s*/i, '');
        else if (p.includes('почтовый индекс')) res.postalCode = part.replace(/почтовый индекс/i, '').trim();
    });

    if (!res.street && parts.length > 4) {
        const candidate = parts.find(p =>
            !p.includes('область') && !p.includes('город') &&
            !p.includes('Казахстан') && !p.includes('индекс')
        );
        if (candidate) res.street = candidate;
    }
    return res;
}

/**
 * Обогащает данные контрагентов, проверяя их БИНы через uchet.kz.
 * Если БИН найден — перезаписывает название компании официальным именем из реестра.
 *
 * @param {object} mergedData  - объект mergedData из AI-ответа
 * @param {Function} [onStatus] - коллбэк для SSE
 * @returns {Promise<{mergedData: object, binWarnings: string[]}>}
 */
async function enrichCounterAgentsBIN(mergedData, onStatus) {
    const warnings = [];
    const roles = ['consignor', 'consignee', 'carrier', 'declarant'];

    if (onStatus) onStatus('🔍 Проверка БИН контрагентов через uchet.kz...');

    // Собираем все уникальные БИНы для параллельного запроса
    const binTasks = [];
    for (const role of roles) {
        const agent = mergedData.counteragents?.[role];
        if (agent?.present && agent.entityType === 'LEGAL' && agent.legal?.bin) {
            binTasks.push({ role, bin: agent.legal.bin });
        }
    }

    // Параллельный запрос всех БИНов
    const results = await Promise.all(
        binTasks.map(async ({ role, bin }) => {
            const info = await fetchCompanyByBIN(bin);
            return { role, bin, info };
        })
    );

    // Применяем обогащение
    for (const { role, bin, info } of results) {
        const agent = mergedData.counteragents[role];

        if (info && info.name) {
            // Перезаписываем название официальным из реестра
            const oldName = agent.legal.nameRu || '';
            agent.legal.nameRu = info.name.toUpperCase();

            if (oldName && oldName.toUpperCase() !== info.name.toUpperCase()) {
                warnings.push(`ℹ️ ${role}: AI распознал "${oldName}", uchet.kz даёт "${info.name}" — использовано официальное название`);
            }

            // Генерируем короткое название (для Декларанта и Перевозчика)
            if ((role === 'declarant' || role === 'carrier') && !agent.legal.shortNameRu) {
                let shortName = info.name;
                shortName = shortName.replace(/Товарищество с ограниченной ответственностью/i, 'ТОО');
                shortName = shortName.replace(/Индивидуальный предприниматель/i, 'ИП');
                shortName = shortName.replace(/Акционерное общество/i, 'АО');
                agent.legal.shortNameRu = shortName;
            }

            // Обогащаем адрес
            if (info.address && (!agent.addresses || agent.addresses.length === 0)) {
                const parsed = parseUchetAddress(info.address);
                if (parsed) {
                    agent.addresses = [{
                        addressType: { id: 2014, code: '1', ru: 'Адрес регистрации' },
                        fullAddress: info.address,
                        ...parsed
                    }];
                }
            }

            console.log(`[BIN] ✅ ${role} (${bin}): обогащён из uchet.kz → ${info.name}`);
        } else {
            warnings.push(`⚠️ БИН ${bin} (${role}) не найден в базе uchet.kz. Проверьте корректность.`);
            console.warn(`[BIN] ❌ ${role} (${bin}): не найден`);
        }
    }

    if (onStatus && warnings.length === 0 && binTasks.length > 0) {
        onStatus('✅ Все БИН контрагентов подтверждены');
    } else if (onStatus && binTasks.length === 0) {
        onStatus('ℹ️ Нет резидентных контрагентов с БИН для проверки');
    }

    return { mergedData, binWarnings: warnings };
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────
module.exports = {
    validateProductCodes,
    validateTNVEDCode,
    enrichCounterAgentsBIN
};
