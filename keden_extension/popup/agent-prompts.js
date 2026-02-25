/**
 * KEDEN PI - Промпты для агентов и JS-мерж
 * ==========================================
 * Файл-агенты возвращают данные сразу в формате Keden PI.
 * Мерж происходит на JS без вызова Gemini.
 */

// =====================================================
// ПРОМПТ ДЛЯ ФАЙЛ-АГЕНТА (универсальный)
// =====================================================
const FILE_AGENT_PROMPT = `
Ты — агент-аналитик таможенных документов для системы Keden PI (Предварительное Информирование).
Проанализируй документ и верни данные СРАЗУ в готовом формате Keden PI.

ВАЖНЫЕ ТРЕБОВАНИЯ:
1. СТРАНА: Используй только 2-буквенный код ISO (CN, KZ, AF, RU, TR, KG, UZ...).
2. БИН/ИИН: Группа из 12 цифр. Если в номере есть буквы или знаки — это НЕ БИН.
3. НЕРЕЗИДЕНТЫ: Для иностранных компаний город/населенный пункт пиши ВЕРХНИМ РЕГИСТРОМ в поле "district" (например: "KABUL", "SHANGHAI").
4. АДРЕС (КРИТИЧЕСКИ ВАЖНО): 
   - Используй ТОЛЬКО физическое местоположение (город, улица, номер дома).
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать телефоны, факсы, email, сайты, почтовые индексы.
   - Если видишь "+", "tel:", "fax:", "email:", "@", "www." — удаляй всю строку с этими данными.
   - В поле address должно остаться что-то вроде "KABUL, STREET 4" или просто "SHANGHAI".
5. РОЛИ (КТО ЕСТЬ КТО):
   - INVOICE: Seller/Shipper/Exporter = Отправитель (Consignor). Buyer/Consignee/Importer = Получатель (Consignee).
   - CMR: Графа 1 = Отправитель (Consignor). Графа 2 = Получатель (Consignee). Графа 16/17 = Перевозчик (Carrier).
   - Если получатель в Казахстане (KZ), у него ОБЯЗАТЕЛЬНО должен быть БИН (12 цифр).
6. EXCEL / CSV: Если в таблице 3 колонки контрагентов, обычно они идут в порядке: Перевозчик | Отправитель | Получатель.
19. ТНВЭД: СТРОГО первые 6 цифр. Обрезай лишнее.
20. ОГРОМНЫЕ СПИСКИ: Если в документе (особенно Excel) 20, 50 или 100 товаров — ТЫ ОБЯЗАН ИЗВЛЕЧЬ ИХ ВСЕ. Категорически запрещено останавливаться на середине. Проверяй totalPackages/totalWeight — если они не сходятся с суммой товаров, значит ты что-то пропустил.
21. ОПИСЬ ДОКУМЕНТОВ vs ОПИСЬ ТОВАРОВ: Не путай список приложенных документов (транспортная накладная, инвойс, паспорт) со списком самих товаров. Товары обычно в Excel или в графе 31 CMR.
═══════════════════════════════════════════
КРИТЕРИИ ОПРЕДЕЛЕНИЯ РОЛЕЙ (СУПЕР-ВАЖНО):
═══════════════════════════════════════════

1. ПОЛУЧАТЕЛЬ (CONSIGNEE / 收货人):
   - CMR: СТРОГО ГРАФА 2.
   - INVOICE / EXCEL: Ищи "Buyer", "Consignee", "Ship to", "Importer" или "收货人".
   - ПРИОРИТЕТ: Если "Buyer" и "Ship to" различаются, бери "Ship to" (фактический получатель груза).
   - НЕ ПУТАЙ с брокером! Получатель — это тот, кто ПОКУПАЕТ товар, а не тот, кто штампует документы на границе.

2. ОТПРАВИТЕЛЬ (CONSIGNOR / 发货人):
   - CMR: СТРОГО ГРАФА 1.
   - INVOICE / EXCEL: "Seller", "Shipper", "Exporter", "From" или "发货人".

3. ПЕРЕВОЗЧИК (CARRIER / 承运人):
   - CMR: Графы 16 или 17. Ищи "Carrier", "Transport company" или "承运人".
   - Обычно там стоит большая прямоугольная печать транспортной компании.

4. ДЕКЛАРАНТ / ПРЕДСТАВИТЕЛЬ (DECLARANT / BROKER):
   - Ищи штамп "Таможенный представитель", "Брокер", "Broker" или "Свидетельство №".
   - ЕСЛИ ТЫ ВИДИШЬ ПЕЧАТЬ КОМПАНИИ ВНИЗУ ДОКУМЕНТА (напр. в CMR box 23), но эта компания НЕ указана в графе 2 — значит это БРОКЕР (Декларант), а не Получатель.
   - НЕ КОПИРУЙ Получателя в поле Декларанта, если нет прямой печати брокера от этой компании.

═══════════════════════════════════════════
ОПРЕДЕЛИ ТИП ДОКУМЕНТА (поле "type"):
═══════════════════════════════════════════

- Invoice / Инвойс / Счёт-фактура / Commercial Invoice → type: "INVOICE"
- CMR / ТТН / Товарно-транспортная накладная / Waybill → type: "TRANSPORT_DOC"
- Реестр товаров / Товарный реестр → type: "REGISTRY"
- Упаковочный лист / Packing List → type: "PACKING_LIST"
- Загранпаспорт / Passport / Travel Document → type: "DRIVER_ID"
- Удостоверение личности / ID Card → type: "OTHER"
- Техпаспорт ТС / Свидетельство о регистрации ТС → type: "VEHICLE_DOC"
- Свидетельство о допущении ТС (TIR/CMR approval) → type: "VEHICLE_PERMIT"
- Доверенность / Power of Attorney → type: "POWER_OF_ATTORNEY"
- Договор экспедиции / Договор перевозки / Contract → type: "CONTRACT"
- Свидетельство УЭО / Реестр таможенного представителя → type: "REGISTRY"
- Иное → type: "OTHER"

⚠️ ВАЖНО: Данные водителя (driver) заполняй ТОЛЬКО из ЗАГРАНПАСПОРТА!
Удостоверение личности — НЕ является документом водителя для ПИ.

═══════════════════════════════════════════
ЧТО ИЗВЛЕКАТЬ ИЗ КАЖДОГО ТИПА (ЭКСПЕРТНЫЕ ПРАВИЛА):
═══════════════════════════════════════════

📄 INVOICE / ИНВОЙС / EXCEL:
- НОМЕР И ДАТА инвойса. В Excel ищи "Invoice No" или "发票号码".
- ОБЩАЯ СТОИМОСТЬ: Ищи "Total Amount", "USD", "EUR" или "总金额", "价税合计".
- ВАЛЮТА: Код (USD, CNY, KZT). В китайских файлах "CNY" или "RMB".
- УСЛОВИЯ ПОСТАВКИ (Incoterms): Ищи FOB, CPT, DAP, FCA. В китайских: "贸易术语". Рядом всегда город.
- ТОВАРЫ: commercialName (ОРИГИНАЛ / ПЕРЕВОД), tnvedCode (6 цифр), grossWeight, quantity, cost, currencyCode
- totalWeight, totalPackages, totalCost
- ⛔ ВАЖНО ПО КОЛИЧЕСТВУ: В поле "quantity" (для товаров) и "totalPackages" (для всего документа) пиши ТОЛЬКО КОЛИЧЕСТВО МЕСТ (упаковок, коробок, паллет). 
- Если в инвойсе есть и "места" (packages) и "штуки" (pcs/units) — ВСЕГДА бери "места".
- Ищи слова: "Packages", "Colli", "Cartons", "Places", "件数".
- ⚠️ ПРАВИЛО 3000: Если ты видишь число больше 3000 в поле мест — скорее всего, ты взял "штуки". Перепроверь документ! Количество мест редко превышает 3000.
- Пакетная проверка: Сумма всех quantity в товарах ДОЛЖНА быть строго равна totalPackages документа. Если в списке 30 строк, а ты извлек 9 — это ошибка. Извлекай ВСЕ.

🚛 CMR / ТТН (TRANSPORT_DOC):
- НОМЕР: Правый верхний угол.
- ТРАНСПОРТ (ГРАФА 25): тягач и прицеп через дефис/слэш (584AEK19/84ADL19).
- ПОЛУЧАТЕЛЬ (ГРАФА 2), ПЕРЕВОЗЧИК (ГРАФА 16/17).
- В CMR (Box 18/25) или Excel ищи: "车号" (Тягач), "挂车号" (Прицеп).
- КОЛИЧЕСТВО МЕСТ (ГРАФА 6): Самый важный источник для totalPackages.

📋 РЕЕСТР / ПРЕДСТАВИТЕЛЬ (REGISTRY):
- ТОВАРЫ (ГРАФА 31, 33, 35, 38): "HS Code" или "海关编码", "毛重" (Gross), "数量" (Quantity).
- НОМЕР И ДАТА реестра.
- СВИДЕТЕЛЬСТВО ПРЕДСТАВИТЕЛЯ / УЭО:
  · Если документ содержит "УЭО" или "Таможенный представитель": номер СТРОГО после № (напр. KZ/0044/ТИП1).
  · regKindCode: Тип УЭО. "ТИП 1" = "1", "ТИП 2" = "2", "ТИП 3" = "3".
  · docDate: Дата вступления в силу.

🪪 ПАСПОРТ ВОДИТЕЛЯ (DRIVER_ID):
- driver.iin (12 цифр из поля ЖСН/IIN), lastName, firstName (ЛАТИНИЦЕЙ ЗАГЛАВНЫМИ), document.number.

🚗 ТЕХПАСПОРТ (VEHICLE_DOC):
- tractorRegNumber (3 цифры+3 буквы), trailerRegNumber (2 цифры+3 буквы), страны.

📜 СВИДЕТЕЛЬСТВО О ДОПУЩЕНИИ (VEHICLE_PERMIT):
- document.number: полный номер (напр. 398 55400-030924-00049).
- Кросс-проверка: Средняя часть номера (напр. 030924) — это дата выдачи в формате ДДММГГ.
- document.date: дата ВЫДАЧИ документа (в формате ГГГГ-ММ-ДД).

📜 ДОВЕРЕННОСТЬ (POWER_OF_ATTORNEY):
- document.number, document.date.
- ❌ НЕ извлекай filler — это поле заполняется из настроек расширения

📝 ДОГОВОР (CONTRACT):
- document.number, document.date.

═══════════════════════════════════════════
ПРАВИЛА ФОРМАТИРОВАНИЯ:
═══════════════════════════════════════════
- ДАТЫ: ГГГГ-ММ-ДД.
- ЧИСЛА: Точка как разделитель. Убирай "кг", "шт", "$".
- ГОРОД: В поле "district" пиши только название города ВЕРХНИМ РЕГИСТРОМ.
- БИН: Ровно 12 цифр. 
- ТНВЭД: Строго ПЕРВЫЕ 6 цифр.
- ⛔ ТОВАРЫ: Если видишь строку, где стоит «ИТОГО», «TOTAL», «Сумма» — ПРОПУСТИ ЕЁ. Это не товар.

═══════════════════════════════════════════
КОНТРАГЕНТЫ — ПРАВИЛА entityType:
═══════════════════════════════════════════
LEGAL (резидент KZ): "legal": { "bin": "12цифр", "nameRu": "НАЗВАНИЕ" }
NON_RESIDENT_LEGAL (иностранная): "nonResidentLegal": { "nameRu": "НАЗВАНИЕ" }, в addresses — countryCode страны.

═══════════════════════════════════════════
ФОРМАТ ОТВЕТА (JSON):
═══════════════════════════════════════════

{
  "documents": [
    {
      "filename": "название файла",
      "type": "INVOICE/TRANSPORT_DOC/REGISTRY/DRIVER_ID/VEHICLE_DOC/VEHICLE_PERMIT/PACKING_LIST/POWER_OF_ATTORNEY/CONTRACT/OTHER",
      "number": "номер документа",
      "date": "ГГГГ-ММ-ДД"
    }
  ],
  "countries": {
    "departureCountry": "ISO код",
    "destinationCountry": "ISO код"
  },
  "shipping": {
    "customsCode": "5-значный код поста",
    "destCustomsCode": "5-значный код поста назначения",
    "transportMode": "31"
  },
  "consignor": {
    "present": true,
    "entityType": "NON_RESIDENT_LEGAL",
    "nonResidentLegal": { "nameRu": "ОТПРАВИТЕЛЬ ЗАГЛАВНЫМИ" },
    "legal": { "bin": "", "nameRu": "" },
    "addresses": [{ "typeCode": "01", "countryCode": "ISO_CODE", "district": "ГОРОД", "fullAddress": "ПОЛНЫЙ АДРЕС" }]
  },
  "consignee": {
    "present": true,
    "entityType": "LEGAL",
    "legal": { "bin": "12ЦИФР", "nameRu": "ПОЛУЧАТЕЛЬ" },
    "nonResidentLegal": { "nameRu": "" },
    "addresses": [{ "typeCode": "01", "countryCode": "KZ", "district": "ГОРОД", "fullAddress": "АДРЕС" }]
  },
  "carrier": {
    "present": true,
    "entityType": "LEGAL",
    "legal": { "bin": "12ЦИФР", "nameRu": "" },
    "nonResidentLegal": { "nameRu": "" },
    "addresses": [{ "typeCode": "01", "countryCode": "KZ", "district": "ГОРОД", "fullAddress": "АДРЕС" }]
  },
  "declarant": {
    "present": true,
    "entityType": "LEGAL",
    "legal": { "bin": "", "nameRu": "", "shortNameRu": "" },
    "addresses": [],
    "representativeCertificate": { "docNumber": "", "docDate": "", "regKindCode": "1" }
  },
  "vehicles": {
    "tractorRegNumber": "номер тягача",
    "tractorCountry": "KZ",
    "trailerRegNumber": "номер прицепа",
    "trailerCountry": "KZ"
  },
  "driver": {
    "present": true,
    "iin": "12ЦИФР",
    "firstName": "ИМЯ ЛАТИНИЦЕЙ",
    "lastName": "ФАМИЛИЯ ЛАТИНИЦЕЙ"
  },
  "products": [
    {
      "tnvedCode": "6 цифр",
      "commercialName": "ORIGINAL / ПЕРЕВОД",
      "grossWeight": 0,
      "quantity": 0,
      "cost": 0,
      "currencyCode": "USD"
    }
  ],
  "totalWeight": 0,
  "totalPackages": 0,
  "totalCost": 0,
  "validation": {
    "warnings": [
      "Вес в инвойсе (28000) отличается от CMR (28420) на 1.5%",
      "Номер тягача в CMR (584AEK19) совпадает с техпаспортом ✅"
    ],
    "crossChecks": {
      "weight": { "cmr": 28420, "ttn": 28420, "invoice": 28000, "final": 28420, "source": "CMR" },
      "packages": { "cmr": 7, "ttn": 7, "invoice": 7, "final": 7, "source": "CMR" },
      "tractorNumber": { "cmr": "584AEK19", "techPassport": "584AEK19", "match": true }
    }
  }
}

═══════════════════════════════════════════
ОБЯЗАТЕЛЬНАЯ ВЕРИФИКАЦИЯ ПЕРЕД ФИНАЛЬНЫМ ОТВЕТОМ:
═══════════════════════════════════════════

Перед тем как записать финальное значение — собери его из ВСЕХ документов и примени приоритеты:

1. ВЕСОВАЯ ВЕРИФИКАЦИЯ:
- Инвойс totalWeight: ___
- CMR графа 11: ___
- ТТН графа 10: ___
→ Приоритет: CMR > ТТН > Инвойс.
→ Если разница > 5% — запиши детали расхождения в validation.warnings.

2. КОЛИЧЕСТВО МЕСТ:
- CMR графа 6: ___
- ТТН графа 6: ___
- Инвойс totalPackages: ___
→ Приоритет: CMR > ТТН > Инвойс.

3. ТРАНСПОРТ (номер тягача/прицепа):
- CMR графа 25: ___
- ТТН: ___
- Техпаспорт: ___
→ Приоритет: Техпаспорт > CMR > ТТН.

4. КОНТРАГЕНТЫ (получатель):
- CMR графа 2: ___
- ТТН графа 2: ___
- Инвойс Buyer: ___
→ Приоритет: CMR > ТТН > Инвойс.

5. ОБЩЕЕ ПРАВИЛО:
- ТЫ ВИДИШЬ ВСЕ ФАЙЛЫ СРАЗУ. Делай MERGE данных в единую картину.
- ТОВАРЫ: Извлекай КАЖДУЮ физическую строку. Сумма quantity/grossWeight in products ДОЛЖНА строго совпадать с totalPackages/totalWeight документа.
- Если в одном файле есть БИН, а в другом только адрес — объедини их.
`;



// =====================================================
// JS-МЕРЖ: объединение результатов без Gemini
// С полной кросс-валидацией между документами
// =====================================================

/**
 * Объединяет результаты всех файл-агентов в единый объект Keden PI.
 * 1. Собирает ВСЕ упоминания каждого контрагента из всех документов
 * 2. Сверяет данные — названия, БИНы, адреса
 * 3. Если совпадают — объединяет (берёт самый полный)
 * 4. Если расходятся — записывает ошибку и берёт лучший
 * 5. Также сверяет транспорт, водителя, общий вес
 *
 * @param {Array} agentResults - массив JSON-объектов от файл-агентов
 * @returns {object} - объединённый результат в формате Keden PI
 */
function mergeAgentResultsJS(agentResults) {
    console.log(`🔧 JS-мерж: объединяем ${agentResults.length} результатов...`);

    const merged = {
        documents: [],
        validation: { errors: [], warnings: [] },
        mergedData: {
            counteragents: {
                consignor: null,
                consignee: null,
                carrier: null,
                declarant: null,
                filler: _emptyFiller()
            },
            vehicles: { tractorRegNumber: '', tractorCountry: '', trailerRegNumber: '', trailerCountry: '' },
            countries: { departureCountry: '', destinationCountry: '' },
            products: [],
            registry: { number: '', date: '' },
            driver: { present: false, iin: '', firstName: '', lastName: '' },
            shipping: { customsCode: '', destCustomsCode: '', transportMode: '' }
        }
    };

    // =======================================================
    // ФАЗА 1: Собрать ВСЕ упоминания по каждой категории
    // =======================================================
    const mentions = {
        consignor: [],  // [{source: "Invoice", data: {...}}, ...]
        consignee: [],
        carrier: [],
        declarant: [],
        vehicles: [],
        driver: [],
        countries: [],
        productCandidates: [], // {source, docType, priority, products[]}
        docTotals: [], // [{source, type, weight, packages, cost}]
        shipping: []
    };

    // Приоритет типов документов для товаров: REGISTRY > EXCEL_INVOICE > остальные
    // Приоритет типов документов для товаров: REGISTRY > EXCEL_INVOICE > другие
    const productPriority = {
        'REGISTRY': 4,
        'INVOICE_EXCEL': 3,
        'CMR': 2,
        'TTN': 2,
        'TRANSPORT_DOC': 2,
        'PACKING_LIST': 1.5,
        'INVOICE': 1,
        'OTHER': 0
    };
    let bestProductSource = 0;
    let bestProductSourceName = '';

    for (const result of agentResults) {
        if (!result || result.error) continue;

        const docType = result.document?.type || 'OTHER';
        const isInvoice = (docType === 'INVOICE' || docType === '04021');
        const docName = _docTypeName(docType);
        const fileName = result.filename || 'Неизвестный файл';
        const sourceLabel = `${docName} (${fileName})`;

        // --- КРИТИЧЕСКАЯ ПРОВЕРКА: Инвойсы только в EXCEL ---
        if (isInvoice && !fileName.toLowerCase().endsWith('.xlsx')) {
            merged.validation.errors.push({
                field: 'document.type',
                message: `❌ КРИТИЧЕСКАЯ ОШИБКА: Инвойс «${fileName}» должен быть СТРОГО в формате Excel (.xlsx). PDF или изображения не принимаются для инвойсов.`,
                severity: 'ERROR'
            });
            // Не прерываем совсем, чтобы показать пользователю ошибку, но этот инвойс будет помечен как ошибочный
        }

        // --- Документы ---
        if (result.documents && Array.isArray(result.documents) && result.documents.length > 0) {
            result.documents.forEach(doc => {
                merged.documents.push({
                    filename: doc.filename || doc.name || fileName,
                    type: doc.type || 'OTHER',
                    number: doc.number || '',
                    date: doc.date || ''
                });
            });
        } else if (result.document && result.document.type) {
            merged.documents.push({
                filename: fileName,
                type: docType,
                number: result.document.number || '',
                date: result.document.date || ''
            });
        }

        // --- Собираем ВСЕ упоминания контрагентов ---
        if (result.consignor && result.consignor.present) {
            mentions.consignor.push({ source: sourceLabel, docType, data: result.consignor });
        }
        if (result.consignee && result.consignee.present) {
            mentions.consignee.push({ source: sourceLabel, docType, data: result.consignee });
        }
        if (result.carrier && result.carrier.present) {
            mentions.carrier.push({ source: sourceLabel, docType, data: result.carrier });
        }
        if (result.declarant && result.declarant.present) {
            mentions.declarant.push({ source: sourceLabel, docType, data: result.declarant });
        }

        // --- Собираем ВСЕ упоминания транспорта ---
        if (result.vehicles && (result.vehicles.tractorRegNumber || result.vehicles.trailerRegNumber)) {
            mentions.vehicles.push({ source: sourceLabel, docType, data: result.vehicles });
        }

        // --- Собираем ВСЕ упоминания водителя ---
        if (result.driver && result.driver.present) {
            mentions.driver.push({ source: sourceLabel, docType, data: result.driver });
        }

        // --- Общий вес из ЛЮБОГО документа (для сверки) ---
        const tw = parseFloat(result.totalWeight || 0);
        const tp = parseInt(result.totalPackages || 0);
        const tc = parseFloat(result.totalCost || 0);

        if (tw > 0 || tp > 0 || tc > 0) {
            mentions.docTotals.push({
                source: sourceLabel,
                type: docType,
                weight: tw,
                packages: tp,
                cost: tc
            });
        }

        // --- Товары: собираем ВСЕ кандидаты с приоритетами ---
        if (result.products && result.products.length > 0) {
            let actualDocType = docType;
            // КРИТИЧЕСКОЕ ПРАВИЛО: Инвойс-товар из Excel в приоритете
            if (docType === 'INVOICE' && fileName.toLowerCase().endsWith('.xlsx')) {
                actualDocType = 'INVOICE_EXCEL';
            } else if (docType === 'INVOICE') {
                // Если это инвойс НЕ из экселя — понижаем приоритет, но НЕ игнорируем совсем.
                // Это позволяет подтянуть товары из PDF/JPG инвойсов, если нет Excel.
                actualDocType = 'INVOICE';
            }

            const priority = productPriority[actualDocType] || 0;
            const normalized = _normalizeProducts(result.products);
            if (normalized.length > 0 && priority > 0) {
                mentions.productCandidates.push({
                    source: sourceLabel,
                    docType: actualDocType,
                    priority: priority,
                    products: normalized
                });
            } else {
                console.log(`📦 Все товары из ${sourceLabel} отфильтрованы или имеют нулевой приоритет`);
            }
        }

        // --- Реестр ---
        if (result.registry && result.registry.number) {
            merged.mergedData.registry = {
                number: result.registry.number,
                date: result.registry.date || ''
            };
        }

        // --- Страны ---
        if (result.countries) {
            mentions.countries.push({ source: sourceLabel, data: result.countries });
        }

        // --- Доставка / Таможня ---
        if (result.shipping) {
            mentions.shipping.push({ source: sourceLabel, data: result.shipping });
        }
    }

    // =======================================================
    // ФАЗА 1.2: Объединить страны
    // =======================================================
    if (mentions.countries.length > 0) {
        // Приоритет CMR для стран
        const best = mentions.countries.find(m => m.source.includes('CMR')) || mentions.countries[0];
        merged.mergedData.countries.departureCountry = (best.data.departureCountry || '').toUpperCase();
        merged.mergedData.countries.destinationCountry = (best.data.destinationCountry || '').toUpperCase();
    }

    // Доставка / Таможня
    if (mentions.shipping.length) {
        // Приоритет CMR для таможенных кодов
        const best = mentions.shipping.find(m => m.source.toLowerCase().includes('cmr')) || mentions.shipping[0];
        if (best.data.customsCode) merged.mergedData.shipping.customsCode = best.data.customsCode;
        if (best.data.destCustomsCode) merged.mergedData.shipping.destCustomsCode = best.data.destCustomsCode;
        if (best.data.transportMode) merged.mergedData.shipping.transportMode = best.data.transportMode;
    }

    // =======================================================
    // ФАЗА 1.5: Выбрать лучший источник товаров
    // =======================================================
    if (mentions.productCandidates.length > 0) {
        // Сортируем по приоритету (от высшего к низшему), при равном — по кол-ву товаров
        mentions.productCandidates.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return b.products.length - a.products.length; // больше товаров = лучше
        });

        // Берём лучший источник
        const best = mentions.productCandidates[0];
        merged.mergedData.products = best.products;
        bestProductSourceName = best.docType;
        console.log(`📦 Товары взяты из: ${best.source} (приоритет ${best.priority}, ${best.products.length} позиций)`);

        // Если есть другие кандидаты с таким же приоритетом (напр. 2 инвойса), добавляем их товары
        for (let i = 1; i < mentions.productCandidates.length; i++) {
            const candidate = mentions.productCandidates[i];
            if (candidate.priority === best.priority && candidate.priority > 0) {
                merged.mergedData.products.push(...candidate.products);
                console.log(`📦 Дополнительные товары из: ${candidate.source} (${candidate.products.length} позиций)`);
            }
        }
    }

    // =======================================================
    // ФАЗА 2: Сверить и объединить контрагентов
    // =======================================================
    for (const role of ['consignor', 'consignee', 'carrier', 'declarant']) {
        const roleName = _roleNameRu(role);
        const allMentions = mentions[role];

        if (allMentions.length === 0) {
            merged.mergedData.counteragents[role] = _emptyCounteragent();
            continue;
        }

        // Сверяем все упоминания между собой
        _validateAndMergeCounteragent(merged, role, roleName, allMentions);
    }

    // =======================================================
    // ФАЗА 3: Сверить и объединить транспорт
    // =======================================================
    _validateAndMergeVehicles(merged, mentions.vehicles);

    // =======================================================
    // ФАЗА 4: Сверить и объединить водителя
    // =======================================================
    _validateAndMergeDriver(merged, mentions.driver);


    // =======================================================
    // ФАЗА 5: Дедупликация товаров + валидация
    // =======================================================
    merged.mergedData.products = _deduplicateProducts(merged.mergedData.products);

    // =======================================================
    // ФАЗА 5.5: ГЛУБОКАЯ СВЕРКА ИТОГОВ (Document Reconciliation)
    // =======================================================
    const itemsWeight = merged.mergedData.products.reduce((s, p) => s + p.grossWeight, 0);
    const itemsPackages = merged.mergedData.products.reduce((s, p) => s + p.quantity, 0);
    const itemsCost = merged.mergedData.products.reduce((s, p) => s + p.cost, 0);

    const invoiceTotals = mentions.docTotals.filter(t => t.type === 'INVOICE' || t.type === 'INVOICE_EXCEL');
    const transportTotals = mentions.docTotals.filter(t => t.type === 'TRANSPORT_DOC');

    const sumInvoices = {
        weight: invoiceTotals.reduce((s, t) => s + t.weight, 0),
        packages: invoiceTotals.reduce((s, t) => s + t.packages, 0),
        cost: invoiceTotals.reduce((s, t) => s + t.cost, 0)
    };

    // 1. Линии товаров vs Итоги инвойсов (проверка качества распознавания строк)
    if (sumInvoices.weight > 0 && Math.abs(sumInvoices.weight - itemsWeight) > 1) {
        merged.validation.warnings.push({
            field: 'products.grossWeight',
            message: `⚠️ ВНИМАНИЕ: Сумма строк (${itemsWeight.toFixed(1)} кг) != Итогу в инвойсах (${sumInvoices.weight.toFixed(1)} кг). Проверьте Excel на наличие скрытых строк или ошибок AI.`,
            severity: 'WARNING'
        });
    }

    // 2. Инвойсы vs Транспорт (CMR/ТТН) - Проверка соответствия документов
    for (const transport of transportTotals) {
        if (transport.weight > 0 && Math.abs(transport.weight - sumInvoices.weight) > 2) {
            const diff = Math.abs(transport.weight - sumInvoices.weight);
            merged.validation.warnings.push({
                field: 'products.grossWeight',
                message: `❌ КОНФЛИКТ ВЕСА: Сумма Инвойсов (${sumInvoices.weight.toFixed(1)} кг) НЕ СОВПАДАЕТ с ${transport.source} (${transport.weight.toFixed(1)} кг). Разница: ${diff.toFixed(1)} кг`,
                severity: 'ERROR'
            });
        }
        if (transport.packages > 0 && transport.packages !== sumInvoices.packages) {
            merged.validation.warnings.push({
                field: 'products.quantity',
                message: `❌ КОНФЛИКТ МЕСТ: Сумма Инвойсов (${sumInvoices.packages}) НЕ СОВПАДАЕТ с ${transport.source} (${transport.packages})`,
                severity: 'ERROR'
            });
        }
    }

    merged.mergedData.reconciliation = {
        items: { weight: itemsWeight, packages: itemsPackages, cost: itemsCost },
        invoices: sumInvoices,
        transport: transportTotals[0] || null
    };

    // =======================================================
    // ФАЗА 6: Финальные проверки
    // =======================================================
    _finalValidation(merged);

    console.log(`✅ JS-мерж завершён: ${merged.documents.length} документов, ${merged.mergedData.products.length} товаров, ${merged.validation.errors.length} ошибок, ${merged.validation.warnings.length} предупреждений`);
    if (bestProductSourceName) {
        console.log(`📦 Товары взяты из: ${bestProductSourceName}`);
    }

    return merged;
}


// =====================================================
// Кросс-валидация контрагентов
// =====================================================

/**
 * Сверяет все упоминания одного контрагента по разным документам.
 * Если данные совпадают — объединяет. Если нет — ошибка + берёт самый полный.
 */
function _validateAndMergeCounteragent(merged, role, roleName, allMentions) {
    // Собираем уникальные имена и БИНы (нормализованные)
    const names = [];   // {name, source}
    const bins = [];    // {bin, source}

    for (const m of allMentions) {
        const name = _getCounteragentName(m.data);
        const bin = m.data.legal?.bin || '';

        if (name) names.push({ name: name.toUpperCase().trim(), source: m.source });
        if (bin) bins.push({ bin: bin.trim(), source: m.source });
    }

    // --- Проверяем совпадение имён ---
    const uniqueNames = [...new Set(names.map(n => n.name))];
    if (uniqueNames.length > 1) {
        // Умное сравнение: если имена похожи на 80% (дистанция Левенштейна), не считаем ошибкой
        let hasRealConflict = false;
        const baseName = uniqueNames[0];
        for (let i = 1; i < uniqueNames.length; i++) {
            const similarity = _calculateSimilarity(baseName, uniqueNames[i]);
            if (similarity < 0.8) {
                hasRealConflict = true;
                break;
            }
        }

        if (hasRealConflict) {
            const details = names.map(n => `«${n.name}» в ${n.source}`).join(', ');
            // Меняем ERROR на WARNING, чтобы не блокировать ввод
            merged.validation.warnings.push({
                field: `${role}.name`,
                message: `⚠️ ${roleName} различается в документах: ${details}`,
                severity: 'WARNING'
            });
        }
    }

    // --- Проверяем совпадение БИНов ---
    const uniqueBins = [...new Set(bins.map(b => b.bin))];
    if (uniqueBins.length > 1) {
        const details = bins.map(b => `${b.bin} в ${b.source}`).join(', ');
        merged.validation.errors.push({
            field: `${role}.bin`,
            message: `⚠️ БИН ${roleName.toLowerCase()} различается: ${details}`,
            severity: 'ERROR'
        });
    }

    // --- Объединяем: берём самый "полный" ---
    // Считаем "полноту" по количеству заполненных полей
    let best = null;
    let bestScore = -1;

    for (const m of allMentions) {
        const score = _counteragentCompleteness(m.data, role, m.docType);
        if (score > bestScore) {
            bestScore = score;
            best = m.data;
        }
    }

    // Формируем итоговый объект
    const result = {
        present: true,
        entityType: best.entityType || 'LEGAL',
        legal: best.legal || { bin: '', nameRu: '' },
        nonResidentLegal: best.nonResidentLegal || { nameRu: '' },
        addresses: best.addresses || [],
        representativeCertificate: best.representativeCertificate || undefined
    };

    // Дополняем из других упоминаний то, чего нет в лучшем
    for (const m of allMentions) {
        if (m.data === best) continue;

        // Дополняем БИН
        if (result.entityType === 'LEGAL' && !result.legal.bin && m.data.legal?.bin) {
            result.legal.bin = m.data.legal.bin;
        }
        // Дополняем название
        if (result.entityType === 'LEGAL' && !result.legal.nameRu && m.data.legal?.nameRu) {
            result.legal.nameRu = m.data.legal.nameRu;
        }
        if (result.entityType === 'NON_RESIDENT_LEGAL' && !result.nonResidentLegal.nameRu && m.data.nonResidentLegal?.nameRu) {
            result.nonResidentLegal.nameRu = m.data.nonResidentLegal.nameRu;
        }
        // Дополняем адрес
        if ((!result.addresses || result.addresses.length === 0) && m.data.addresses?.length > 0) {
            result.addresses = m.data.addresses;
        }
        // Дополняем свидетельство
        if (m.data.representativeCertificate) {
            if (!result.representativeCertificate) result.representativeCertificate = {};
            if (!result.representativeCertificate.docNumber) result.representativeCertificate.docNumber = m.data.representativeCertificate.docNumber;
            if (!result.representativeCertificate.docDate) result.representativeCertificate.docDate = m.data.representativeCertificate.docDate;
            if (!result.representativeCertificate.regKindCode) result.representativeCertificate.regKindCode = m.data.representativeCertificate.regKindCode;
        }
    }

    // Названия — в верхний регистр
    if (result.legal?.nameRu) result.legal.nameRu = result.legal.nameRu.toUpperCase();
    if (result.nonResidentLegal?.nameRu) result.nonResidentLegal.nameRu = result.nonResidentLegal.nameRu.toUpperCase();

    merged.mergedData.counteragents[role] = result;
}


// =====================================================
// Кросс-валидация транспорта
// =====================================================

function _validateAndMergeVehicles(merged, vehicleMentions) {
    if (vehicleMentions.length === 0) return;

    // ПРИОРИТЕТ: Техпаспорт (VEHICLE_DOC) > остальные (CMR и т.д.)
    const primaryMentions = vehicleMentions.filter(m => m.docType === 'VEHICLE_DOC');
    const secondaryMentions = vehicleMentions.filter(m => m.docType !== 'VEHICLE_DOC');

    const v = merged.mergedData.vehicles;

    // Сначала заполняем из техпаспортов (всех найденных)
    for (const m of primaryMentions) {
        if (!v.tractorRegNumber && m.data.tractorRegNumber) {
            v.tractorRegNumber = m.data.tractorRegNumber.toUpperCase().replace(/\s/g, '');
            v.tractorCountry = (m.data.tractorCountry || v.tractorCountry || '').toUpperCase();
        }
        if (!v.trailerRegNumber && m.data.trailerRegNumber) {
            v.trailerRegNumber = m.data.trailerRegNumber.toUpperCase().replace(/\s/g, '');
            v.trailerCountry = (m.data.trailerCountry || v.trailerCountry || '').toUpperCase();
        }
    }

    // Если что-то осталось пустым, добираем из других документов (CMR)
    for (const m of secondaryMentions) {
        if (!v.tractorRegNumber && m.data.tractorRegNumber) {
            v.tractorRegNumber = m.data.tractorRegNumber.toUpperCase().replace(/\s/g, '');
            v.tractorCountry = (m.data.tractorCountry || '').toUpperCase();
        }
        if (!v.trailerRegNumber && m.data.trailerRegNumber) {
            v.trailerRegNumber = m.data.trailerRegNumber.toUpperCase().replace(/\s/g, '');
            v.trailerCountry = (m.data.trailerCountry || '').toUpperCase();
        }
    }

    // ВАЛИДАЦИЯ: Если в разных документах номера РЕАЛЬНО разные
    const tractors = vehicleMentions.filter(m => m.data.tractorRegNumber).map(m => ({
        num: m.data.tractorRegNumber.toUpperCase().replace(/\s/g, ''),
        src: m.source
    }));
    const uniqueTractors = [...new Set(tractors.map(t => t.num))];

    if (uniqueTractors.length > 1) {
        const details = tractors.map(t => `${t.num} (${t.src})`).join(', ');
        merged.validation.warnings.push({
            field: 'vehicles.tractorRegNumber',
            message: `⚠️ Номер тягача различается: ${details}. Использован номер из приоритетного документа.`,
            severity: 'WARNING'
        });
    }

    const trailers = vehicleMentions.filter(m => m.data.trailerRegNumber).map(m => ({
        num: m.data.trailerRegNumber.toUpperCase().replace(/\s/g, ''),
        src: m.source
    }));
    const uniqueTrailers = [...new Set(trailers.map(t => t.num))];

    if (uniqueTrailers.length > 1) {
        const details = trailers.map(t => `${t.num} (${t.src})`).join(', ');
        merged.validation.warnings.push({
            field: 'vehicles.trailerRegNumber',
            message: `⚠️ Номер прицепа различается: ${details}. Использован номер из приоритетного документа.`,
            severity: 'WARNING'
        });
    }
}


// =====================================================
// Кросс-валидация водителя
// =====================================================

function _validateAndMergeDriver(merged, driverMentions) {
    if (driverMentions.length === 0) return;

    // Собираем все данные о водителе
    const iins = [];
    const names = [];

    for (const m of driverMentions) {
        const iin = (m.data.iin || '').trim();
        const fullName = `${(m.data.lastName || '').toUpperCase()} ${(m.data.firstName || '').toUpperCase()}`.trim();

        if (iin) iins.push({ iin, source: m.source });
        if (fullName) names.push({ name: fullName, source: m.source });
    }

    // Сверяем ИИНы
    const uniqueIINs = [...new Set(iins.map(i => i.iin))];
    if (uniqueIINs.length > 1) {
        const details = iins.map(i => `${i.iin} в ${i.source}`).join(', ');
        merged.validation.errors.push({
            field: 'driver.iin',
            message: `⚠️ ИИН водителя различается: ${details}`,
            severity: 'ERROR'
        });
    }

    // Сверяем имена
    const uniqueNames = [...new Set(names.map(n => n.name))];
    if (uniqueNames.length > 1) {
        const details = names.map(n => `«${n.name}» в ${n.source}`).join(', ');
        merged.validation.warnings.push({
            field: 'driver.name',
            message: `ФИО водителя различается: ${details}`,
            severity: 'WARNING'
        });
    }

    // ПРИОРИТЕТ: Загранпаспорт (DRIVER_ID) > все остальные
    const passportMentions = driverMentions.filter(m => m.docType === 'DRIVER_ID');
    const otherMentions = driverMentions.filter(m => m.docType !== 'DRIVER_ID');

    // Если есть загранпаспорт — берём ТОЛЬКО из него
    const pool = passportMentions.length > 0 ? passportMentions : otherMentions;

    if (passportMentions.length === 0 && otherMentions.length > 0) {
        merged.validation.warnings.push({
            field: 'driver',
            message: `⚠️ Данные водителя взяты НЕ из загранпаспорта (${otherMentions[0].source}). Загрузите загранпаспорт водителя.`,
            severity: 'WARNING'
        });
    }

    let best = pool[0].data;
    let bestScore = 0;

    for (const m of pool) {
        let score = 0;
        if (m.data.iin) score += 3;
        if (m.data.firstName) score += 1;
        if (m.data.lastName) score += 1;
        if (score > bestScore) {
            bestScore = score;
            best = m.data;
        }
    }

    // Сохраняем результат
    merged.mergedData.driver = {
        present: true,
        iin: (best.iin || '').trim(),
        lastName: (best.lastName || '').toUpperCase().trim(),
        firstName: (best.firstName || '').toUpperCase().trim()
    };
}


// =====================================================
// Финальная валидация
// =====================================================

function _finalValidation(merged) {
    // Есть ли товары
    if (merged.mergedData.products.length === 0) {
        merged.validation.warnings.push({
            field: 'products',
            message: 'Не найдено ни одного товара в документах',
            severity: 'WARNING'
        });
    }

    // БИН получателя
    const consignee = merged.mergedData.counteragents.consignee;
    if (consignee?.present && consignee.entityType === 'LEGAL' && (!consignee.legal?.bin || consignee.legal.bin.length !== 12)) {
        merged.validation.warnings.push({
            field: 'consignee.legal.bin',
            message: 'БИН получателя отсутствует или неверной длины',
            severity: 'WARNING'
        });
    }

    // БИН перевозчика
    const carrier = merged.mergedData.counteragents.carrier;
    if (carrier?.present && carrier.entityType === 'LEGAL' && (!carrier.legal?.bin || carrier.legal.bin.length !== 12)) {
        merged.validation.warnings.push({
            field: 'carrier.legal.bin',
            message: 'БИН перевозчика отсутствует или неверной длины',
            severity: 'WARNING'
        });
    }

    // ИИН водителя
    const driver = merged.mergedData.driver;
    if (driver.present && driver.iin && driver.iin.length !== 12) {
        merged.validation.warnings.push({
            field: 'driver.iin',
            message: `ИИН водителя неверной длины: ${driver.iin.length} цифр (должно быть 12)`,
            severity: 'WARNING'
        });
    }

    // Нет транспорта
    if (!merged.mergedData.vehicles.tractorRegNumber) {
        merged.validation.warnings.push({
            field: 'vehicles.tractorRegNumber',
            message: 'Номер тягача не найден ни в одном документе',
            severity: 'WARNING'
        });
    }

    // Нет отправителя
    const consignor = merged.mergedData.counteragents.consignor;
    if (!consignor?.present) {
        merged.validation.warnings.push({
            field: 'consignor',
            message: 'Отправитель не найден ни в одном документе',
            severity: 'WARNING'
        });
    }

    // Нет получателя
    if (!consignee?.present) {
        merged.validation.warnings.push({
            field: 'consignee',
            message: 'Получатель не найден ни в одном документе',
            severity: 'WARNING'
        });
    }
}


// =====================================================
// Утилиты
// =====================================================

/** Извлекает имя контрагента из объекта */
function _getCounteragentName(data) {
    if (data.entityType === 'LEGAL' && data.legal?.nameRu) return data.legal.nameRu;
    if (data.entityType === 'NON_RESIDENT_LEGAL' && data.nonResidentLegal?.nameRu) return data.nonResidentLegal.nameRu;
    // Fallback: попробовать оба
    return data.legal?.nameRu || data.nonResidentLegal?.nameRu || '';
}

/** Считает "полноту" контрагента — больше = полнее */
function _counteragentCompleteness(data, role, docType) {
    let score = 0;
    if (data.legal?.bin) score += 3;
    if (data.legal?.nameRu || data.nonResidentLegal?.nameRu) score += 2;
    if (data.addresses?.length > 0) score += 1;
    if (data.addresses?.[0]?.fullAddress) score += 1;

    // ПРИОРИТЕТЫ: CMR (TRANSPORT_DOC) — самый надежный источник для ролей
    if (role === 'consignee' && docType === 'TRANSPORT_DOC') score += 20; // Огромный бонус для CMR Box 2
    if (role === 'consignor' && docType === 'TRANSPORT_DOC') score += 20; // Огромный бонус для CMR Box 1
    if (role === 'carrier' && docType === 'TRANSPORT_DOC') score += 20;   // Огромный бонус для CMR Box 16/17
    if (role === 'declarant' && data.representativeCertificate?.docNumber) score += 30; // Свидетельство — 100% признак брокера

    return score;
}

/** Русское название роли контрагента */
function _roleNameRu(role) {
    const map = {
        consignor: 'Отправитель',
        consignee: 'Получатель',
        carrier: 'Перевозчик',
        declarant: 'Декларант'
    };
    return map[role] || role;
}

/** Человекочитаемое название типа документа */
function _docTypeName(docType) {
    const map = {
        '04021': 'Инвойс',
        'INVOICE': 'Инвойс',
        '02015': 'CMR/ТТН',
        'TRANSPORT_DOC': 'CMR/ТТН',
        '09011': 'Реестр',
        'REGISTRY': 'Реестр',
        '04131': 'Упаковочный лист',
        'PACKING_LIST': 'Упаковочный лист',
        '10022': 'Паспорт/Довер/Тех',
        'DRIVER_ID': 'Паспорт водителя',
        'VEHICLE_DOC': 'Техпаспорт ТС',
        'POWER_OF_ATTORNEY': 'Доверенность',
        '09024': 'Допущение ТС',
        'VEHICLE_PERMIT': 'Допущение ТС',
        '11005': 'Договор эксп.',
        '04033': 'Договор перев.',
        'OTHER': 'Другой документ'
    };
    return map[docType] || docType;
}

/** Пустой контрагент */
function _emptyCounteragent() {
    return {
        present: false,
        entityType: 'LEGAL',
        legal: { bin: '', nameRu: '' },
        nonResidentLegal: { nameRu: '' },
        addresses: []
    };
}

/** Нормализует массив товаров */
/** Чёрный список обобщённых строк — это НЕ товары */
const GENERIC_PRODUCT_BLACKLIST = [
    'ТОВАРЫ ПО ОПИСИ',
    'CARGO AS PER',
    'GOODS AS PER',
    'ГРУЗ ПО ИНВОЙСУ',
    'ГРУЗ ПО ОПИСИ',
    'ПОЗИЦИИ СОГЛАСНО',
    'ACCORDING TO INVOICE',
    'AS PER INVENTORY',
    'AS PER PACKING',
    'ИТОГО',
    'TOTAL',
    'ВСЕГО',
    'SUBTOTAL',
    '货物按清单',
    'SUMMARY',
];

function _isGenericProduct(name) {
    const upper = String(name || '').toUpperCase().trim();
    if (!upper || upper.length < 3) return true;
    return GENERIC_PRODUCT_BLACKLIST.some(pattern => upper.includes(pattern));
}

function _normalizeProducts(products) {
    return products
        .filter(p => !_isGenericProduct(p.commercialName))
        .map(p => ({
            tnvedCode: String(p.tnvedCode || '').replace(/\D/g, '').substring(0, 6),
            commercialName: String(p.commercialName || ''),
            grossWeight: parseFloat(p.grossWeight) || 0,
            quantity: parseInt(p.quantity) || 0,
            cost: parseFloat(p.cost) || 0,
            currencyCode: String(p.currencyCode || 'USD').toUpperCase()
        }));
}

/** Дедупликация товаров (ОТКЛЮЧЕНА для сохранения структуры документов) */
function _deduplicateProducts(products) {
    // Пользователь просил не "склеивать" товары. Возвращаем как есть.
    return products;
}

/** Считает коэффициент схожести строк (0..1) по Левенштейну */
function _calculateSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    const editDistance = _levenshteinDistance(longer, shorter);
    return (longerLength - editDistance) / longerLength;
}

function _levenshteinDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

/** Пустой подписант */
function _emptyFiller() {
    return {
        present: false,
        role: 'FILLER_DECLARANT',
        iin: '',
        firstName: '',
        lastName: '',
        patronymic: '',
        powerOfAttorney: {
            docNumber: '',
            docDate: '',
            startDate: '',
            endDate: '',
            typeCode: '11004'
        }
    };
}
