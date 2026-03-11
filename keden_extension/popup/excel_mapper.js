/**
 * excel_mapper.js — Двухфазный парсер больших Excel-инвойсов.
 *
 * Фаза 1: AI получает только «скелет» (заголовки + 3 примера) → возвращает JSON-маппинг колонок.
 * Фаза 2: XLSX.js итерирует ВСЕ строки по маппингу — без лимита токенов, без AI.
 *
 * Используется когда в Excel ≥ EXCEL_LARGE_THRESHOLD строк данных.
 */

const EXCEL_LARGE_THRESHOLD = 25;

// ─── Фаза 1: построение скелета ───────────────────────────────────────────────

/**
 * Находит строку с заголовками среди первых 50 строк.
 * Логика: строка заголовков имеет МАКСИМАЛЬНОЕ количество непустых текстовых ячеек.
 * Ищем через первые 50 строк (таблица может начинаться после шапки документа).
 */
function _findHeaderRowIdx(rows) {
    let bestIdx = 0;
    let bestScore = 0;
    const limit = Math.min(rows.length, 50);

    for (let i = 0; i < limit; i++) {
        const nonEmpty = rows[i].filter(c => c !== '' && c !== null && c !== undefined);
        const textCells = nonEmpty.filter(c => isNaN(Number(String(c).replace(',', '.'))));
        // Заголовок = много текстовых ячеек И много непустых в целом
        const score = textCells.length * 2 + nonEmpty.length;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/**
 * Строит компактный «скелет» Excel: заголовки + 3 примера строк + 2 последних строки.
 * Возвращает null если файл маленький (< EXCEL_LARGE_THRESHOLD строк данных).
 */
function buildExcelSkeleton(workbook, fileName) {
    // Выбираем лист с наибольшим числом строк
    let bestSheetName = workbook.SheetNames[0];
    let maxRows = 0;
    for (const name of workbook.SheetNames) {
        const s = workbook.Sheets[name];
        if (!s['!ref']) continue;
        const range = XLSX.utils.decode_range(s['!ref']);
        const count = range.e.r - range.s.r + 1;
        if (count > maxRows) { maxRows = count; bestSheetName = name; }
    }

    const sheet = workbook.Sheets[bestSheetName];
    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });

    const headerRowIdx = _findHeaderRowIdx(allRows);
    const dataRows = allRows.slice(headerRowIdx + 1).filter(r => r.some(c => c !== ''));

    // Двухфазный режим для всех файлов

    const headerRow = allRows[headerRowIdx];
    const samples = dataRows.slice(0, 3);
    const tail = dataRows.slice(-2);

    let text = `Файл: ${fileName} | Лист: "${bestSheetName}" | Строк данных: ${dataRows.length}\n\n`;
    text += `ЗАГОЛОВКИ (строка ${headerRowIdx + 1}):\n`;
    text += headerRow.map((c, i) => `  [${i}] "${c}"`).join('\n');
    text += `\n\nПРИМЕРЫ (первые 3 строки данных):\n`;
    for (const row of samples) {
        text += row.map((c, i) => `[${i}]:${c}`).join(' | ') + '\n';
    }
    text += `\nПОСЛЕДНИЕ СТРОКИ (могут содержать ИТОГО):\n`;
    for (const row of tail) {
        text += row.map((c, i) => `[${i}]:${c}`).join(' | ') + '\n';
    }

    return { text, sheetName: bestSheetName, headerRowIdx, totalDataRows: dataRows.length, allRows };
}

// ─── Фаза 1: запрос маппинга у AI ─────────────────────────────────────────────

/**
 * Отправляет скелет в edge function (action: excel-map) и получает маппинг колонок.
 */
async function fetchColumnMapping(skeletonText, fileName, iin) {
    const resp = await fetch(SUPABASE_CONFIG.EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            'apikey': SUPABASE_CONFIG.ANON_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'excel-map',
            iin: iin || '000000000000',
            skeleton: skeletonText,
            fileName,
        }),
    });

    if (!resp.ok) throw new Error(`excel-map HTTP ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();
    if (data.error) throw new Error(`excel-map: ${data.error}`);
    if (!data.mapping?.columns) throw new Error('excel-map: неверный формат маппинга');
    return data.mapping;
}

// ─── Фаза 1.5: валидация маппинга ─────────────────────────────────────────────

/**
 * Проверяет и исправляет очевидные ошибки маппинга:
 * — Если в колонке commercialName сплошь числа (HS-коды) → переставляем с tnvedCode.
 * — Если quantity содержит дробные числа (явно вес) → переставляем с grossWeight.
 */
function validateAndFixMapping(allRows, headerRowIdx, mapping) {
    const cols = mapping.columns;
    const startIdx = headerRowIdx + 1 + (mapping.dataStartOffset || 0);
    const sampleRows = allRows.slice(startIdx, startIdx + 5).filter(r => r.some(c => c !== ''));
    if (sampleRows.length === 0) return mapping;

    const fixed = JSON.parse(JSON.stringify(mapping)); // deep copy
    const fc = fixed.columns;

    // --- Проверка 1: commercialName содержит HS-коды (6-10 цифр) → swap с tnvedCode ---
    const nameIsHsCode = sampleRows.filter(row => {
        const v = String(row[fc.commercialName] ?? '').trim();
        return /^\d{6,10}$/.test(v);
    }).length;

    if (nameIsHsCode >= Math.ceil(sampleRows.length * 0.6)) {
        console.warn(`[ExcelMapper] ⚠️ commercialName[${fc.commercialName}] содержит HS-коды → swap с tnvedCode[${fc.tnvedCode}]`);
        [fc.commercialName, fc.tnvedCode] = [fc.tnvedCode, fc.commercialName];
    }

    // --- Проверка 2: quantity содержит дробные значения (скорее всего вес) → swap с grossWeight ---
    if (fc.quantity != null && fc.grossWeight != null) {
        const qtyHasDecimals = sampleRows.filter(row => {
            const v = String(row[fc.quantity] ?? '').replace(',', '.');
            return /\.\d+/.test(v) && Number(v) > 0;
        }).length;

        if (qtyHasDecimals >= Math.ceil(sampleRows.length * 0.6)) {
            console.warn(`[ExcelMapper] ⚠️ quantity[${fc.quantity}] содержит дроби (вес?) → swap с grossWeight[${fc.grossWeight}]`);
            [fc.quantity, fc.grossWeight] = [fc.grossWeight, fc.quantity];
        }
    }

    return fixed;
}

// ─── Фаза 2: извлечение всех строк по маппингу ────────────────────────────────

/**
 * Итерирует ВСЕ строки данных по маппингу колонок. Возвращает массив товаров.
 * Пропускает пустые строки и строки с итогами (ИТОГО/TOTAL/合计).
 */
function extractProductsByMapping(allRows, headerRowIdx, mapping) {
    const cols = mapping.columns;
    const skipPatterns = mapping.skipRowPatterns || ['ИТОГО', 'TOTAL', 'Total', 'Итого', '合计', 'ВСЕГО', 'Всего'];
    const startIdx = headerRowIdx + 1 + (mapping.dataStartOffset || 0);

    const products = [];

    for (let r = startIdx; r < allRows.length; r++) {
        const row = allRows[r];

        // Пропускаем пустые строки
        const nameVal = String(row[cols.commercialName] ?? '').trim();
        if (!nameVal) continue;

        // Пропускаем итоговые строки
        if (skipPatterns.some(p => nameVal.includes(p))) continue;

        const toNum = (idx) => {
            if (idx == null) return 0;
            return Number(String(row[idx] ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
        };

        const quantity   = toNum(cols.quantity);
        const grossWeight = toNum(cols.grossWeight);

        let cost = cols.cost != null ? toNum(cols.cost) : 0;
        // Если нет итоговой стоимости — считаем из unitPrice × quantity
        // unitPriceDivisor: 100 если колонка "PRICE PER 100", 1 если обычная цена за единицу
        if (!cost && cols.unitPrice != null && quantity) {
            const divisor = mapping.unitPriceDivisor || 1;
            cost = Math.round(toNum(cols.unitPrice) / divisor * quantity * 100) / 100;
        }

        // Пропускаем строки где все числовые поля = 0 (декоративные строки)
        if (quantity === 0 && grossWeight === 0 && cost === 0) continue;

        const tnved = cols.tnvedCode != null
            ? String(row[cols.tnvedCode] ?? '').replace(/[^\d]/g, '').substring(0, 6)
            : '';

        products.push({
            commercialName: nameVal,
            tnvedCode: tnved,
            grossWeight,
            quantity,
            cost,
            currencyCode: mapping.currency || 'USD',
        });
    }

    return products;
}

// ─── Главная функция ──────────────────────────────────────────────────────────

/**
 * Читает Excel: для большого файла (≥ 25 строк) использует AI-маппинг + код-экстракцию.
 * Возвращает pre-parsed объект или null (для маленьких файлов → использовать readExcel()).
 * При ошибке маппинга → null (fallback на readExcel).
 */
async function readExcelLarge(file, iin) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { cellFormula: false, cellNF: false });

    const skeleton = buildExcelSkeleton(workbook, file.name);
    if (!skeleton) {
        console.log(`[ExcelMapper] ${file.name}: маленький файл → обычный режим`);
        return null;
    }

    console.log(`[ExcelMapper] ${file.name}: ${skeleton.totalDataRows} строк → структурный режим`);

    let mapping;
    try {
        mapping = await fetchColumnMapping(skeleton.text, file.name, iin);
        console.log('[ExcelMapper] Маппинг:', mapping);
    } catch (e) {
        console.warn(`[ExcelMapper] Ошибка маппинга (${e.message}) → fallback`);
        return null;
    }

    const validatedMapping = validateAndFixMapping(skeleton.allRows, skeleton.headerRowIdx, mapping);
    const products = extractProductsByMapping(skeleton.allRows, skeleton.headerRowIdx, validatedMapping);

    const totalWeight   = Math.round(products.reduce((s, p) => s + p.grossWeight, 0) * 100) / 100;
    const totalPackages = products.reduce((s, p) => s + p.quantity, 0);
    const totalCost     = Math.round(products.reduce((s, p) => s + p.cost, 0) * 100) / 100;

    console.log(`[ExcelMapper] Извлечено ${products.length} товаров | Вес: ${totalWeight} кг | Мест: ${totalPackages} | Сумма: ${totalCost}`);

    return {
        preParsed: true,
        fileName: file.name,
        docType: 'INVOICE',
        products,
        totalWeight,
        totalPackages,
        totalCost,
        currency: mapping.currency || 'USD',
    };
}
