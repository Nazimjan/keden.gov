/**
 * Тесты на основе реальных документов: 584AEK19-84ADL19 (OMAR NOMAN LTD / YIWU TAMING)
 *
 * Источники:
 *   - CMR.jpg         : CMR 584AEK19, составлена 03.02.2026, Nur Zholy
 *   - INVOICE.jpg     : Инвойс XYHYWB1707 от 24.01.2026 (= Итог1.pdf стр.2)
 *   - ТТН.jpg         : ТТН ГС42840/ГС42160, 24.01.2026
 *   - Итог1.pdf стр.1 : Опись транзитной декларации
 *
 * Структура документов:
 *   Отправитель:  YIWU TAMING TRADING CO., LTD (Китай, Иу)
 *   Получатель:   OMAR NOMAN LTD (Афганистан, Нангархар)
 *   Перевозчик:   ТОО SENIM-PARTS (Казахстан, БИН 250140031008)
 *   Тягач/прицеп: 584AEK19 / 84ADL19
 *   Инвойс:       19 позиций, 1640 мест, 19680 USD, 28420 кг брутто
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { mergeAgentResults } from "../merger.ts";
import { normalizeName, calculateSimilarity } from "../utils.ts";

// ─────────────────────────────────────────────────────────
// ФИКСТУРЫ (данные из реальных документов)
// ─────────────────────────────────────────────────────────

/** Отправитель как его видит AI из CMR (гр.1) */
const CONSIGNOR_FROM_CMR = {
    present: true,
    entityType: "NON_RESIDENT_LEGAL",
    nonResidentLegal: { nameRu: "YIWU TAMING TRADING CO., LTD" },
    legal: { bin: "", nameRu: "" },
    // CONTACT-строка ДОЛЖНА быть вырезана — только физический адрес
    addresses: [{ typeCode: "01", countryCode: "CN", district: "YIWU", fullAddress: "911 9TH FLOOR BUILDING B SHUGUANG INTERNATIONAL BUILDING FUTIAN STREET YIWU ZHEJIANG CHINA" }],
};

/** Отправитель из инвойса (Shipper/Seller) — то же лицо, незначительная опечатка в имени */
const CONSIGNOR_FROM_INVOICE = {
    present: true,
    entityType: "NON_RESIDENT_LEGAL",
    nonResidentLegal: { nameRu: "YIWU TAMING TRADING CO.,LTD" }, // без пробела перед LTD
    legal: { bin: "", nameRu: "" },
    addresses: [{ typeCode: "01", countryCode: "CN", district: "YIWU", fullAddress: "911 9TH FLOOR BUILDING B SHUGUANG INTERNATIONAL BUILDING FUTIAN STREET YIWU ZHEJIANG CHINA" }],
};

/** Получатель как его видит AI из CMR (гр.2) */
const CONSIGNEE_FROM_CMR = {
    present: true,
    entityType: "NON_RESIDENT_LEGAL",
    nonResidentLegal: { nameRu: "OMAR NOMAN LTD" },
    legal: { bin: "", nameRu: "" },
    addresses: [{ typeCode: "01", countryCode: "AF", district: "NANGARHAR", fullAddress: "SABZI MANDI JOI HAFT 5TH DISTRICT JALAL ABAD NANGARHAR AFGHANISTAN" }],
};

/** Получатель из инвойса (Consignee) */
const CONSIGNEE_FROM_INVOICE = {
    present: true,
    entityType: "NON_RESIDENT_LEGAL",
    nonResidentLegal: { nameRu: "OMAR NOMAN LTD" },
    legal: { bin: "", nameRu: "" },
    addresses: [{ typeCode: "01", countryCode: "AF", district: "NANGARHAR", fullAddress: "SABZI MANDI JOI HAFT 5TH DISTRICT JALAL ABAD NANGARHAR AFGHANISTAN" }],
};

/** Перевозчик из CMR (гр.16): ТОО SENIM-PARTS, КЗ, БИН 250140031008 */
const CARRIER_SENIM_PARTS = {
    present: true,
    entityType: "LEGAL",
    legal: { bin: "250140031008", nameRu: "SENIM-PARTS" },
    nonResidentLegal: { nameRu: "" },
    addresses: [{ typeCode: "01", countryCode: "KZ", district: "NUR ZHOLY", fullAddress: "NUR ZHOLY" }],
};

/**
 * Все 19 товарных позиций из инвойса XYHYWB1707.
 * HS коды усечены до 6 цифр (согласно требованию промпта).
 * Суммы верифицированы:
 *   Σ quantity  = 1640
 *   Σ cost      = 19680 USD
 *   Σ grossWeight = 28420 KGS
 */
const PRODUCTS_19 = [
    { tnvedCode: "640419", commercialName: "SHOES / Одежда для ног",                 grossWeight: 5964, quantity: 573, cost: 6876, currencyCode: "USD" },
    { tnvedCode: "670419", commercialName: "HAIR HEATER / Обогреватель волос",        grossWeight: 1500, quantity: 51,  cost: 612,  currencyCode: "USD" },
    { tnvedCode: "392690", commercialName: "HOT FIX TAPE / Горячий ремонтный лист",  grossWeight: 5680, quantity: 200, cost: 2400, currencyCode: "USD" },
    { tnvedCode: "330410", commercialName: "COSMETIC FASHION / косметика",            grossWeight: 3765, quantity: 225, cost: 2700, currencyCode: "USD" },
    { tnvedCode: "392640", commercialName: "NAILS / Ногти",                           grossWeight: 965,  quantity: 53,  cost: 636,  currencyCode: "USD" },
    { tnvedCode: "640690", commercialName: "SHOE ACCESSORIES / Аксессуары для одежды",grossWeight: 1213, quantity: 56,  cost: 672,  currencyCode: "USD" },
    { tnvedCode: "732399", commercialName: "TEA MAKER / Чайник для заваривания чая", grossWeight: 48,   quantity: 4,   cost: 48,   currencyCode: "USD" },
    { tnvedCode: "950691", commercialName: "KNEE BRACE / Опора для колена",           grossWeight: 1620, quantity: 53,  cost: 636,  currencyCode: "USD" },
    { tnvedCode: "961519", commercialName: "HAIR CLIP / Зажим для волос",             grossWeight: 802,  quantity: 21,  cost: 252,  currencyCode: "USD" },
    { tnvedCode: "950691", commercialName: "SPORTS EQUIPMENT / Спортивное оборудование", grossWeight: 1943, quantity: 164, cost: 1968, currencyCode: "USD" },
    { tnvedCode: "560410", commercialName: "PANTS ELASTIC / Пантографный эластик",   grossWeight: 727,  quantity: 37,  cost: 444,  currencyCode: "USD" },
    { tnvedCode: "580421", commercialName: "CLOTHING LACE / Одежная лента",           grossWeight: 450,  quantity: 18,  cost: 216,  currencyCode: "USD" },
    { tnvedCode: "670410", commercialName: "EYELESHES / Ейлешес",                    grossWeight: 780,  quantity: 40,  cost: 480,  currencyCode: "USD" }, // опечатка в документе, сохранена как есть
    { tnvedCode: "910211", commercialName: "WATCH / Часы",                            grossWeight: 81,   quantity: 3,   cost: 36,   currencyCode: "USD" },
    { tnvedCode: "611710", commercialName: "CLOTHING ACCESSORIES / Одежные аксессуары", grossWeight: 999, quantity: 45, cost: 540, currencyCode: "USD" },
    { tnvedCode: "650500", commercialName: "HAIR NET / Сетка для волос",              grossWeight: 690,  quantity: 42,  cost: 504,  currencyCode: "USD" },
    { tnvedCode: "870899", commercialName: "CAR PARTS / Автозапчасти",               grossWeight: 223,  quantity: 14,  cost: 168,  currencyCode: "USD" },
    { tnvedCode: "732399", commercialName: "WATER JUG / Чайник",                     grossWeight: 780,  quantity: 34,  cost: 408,  currencyCode: "USD" },
    { tnvedCode: "940421", commercialName: "MATTRESS / Матрас",                       grossWeight: 190,  quantity: 7,   cost: 84,   currencyCode: "USD" },
];

/** Полный AI-ответ, имитирующий обработку CMR.jpg */
function makeCmrResult() {
    return {
        schemaVersion: "1.0",
        document: { type: "TRANSPORT_DOC", number: "584AEK19", date: "2026-02-03" },
        filename: "CMR.jpg",
        consignor: CONSIGNOR_FROM_CMR,
        consignee: CONSIGNEE_FROM_CMR,
        carrier: CARRIER_SENIM_PARTS,
        countries: { departureCountry: "CN", destinationCountry: "AF" },
        vehicles: { tractorRegNumber: "584AEK19", tractorCountry: "KZ", trailerRegNumber: "84ADL19", trailerCountry: "KZ" },
        totalWeight: 28420,
        totalPackages: 1640,
        validation: {
            warnings: [],
            errors: [],
            crossChecks: {
                weight: { cmr: 28420 },
                packages: { cmr: 1640 },
                names: {
                    consignee: { cmr: "OMAR NOMAN LTD" },
                    consignor: { cmr: "YIWU TAMING TRADING CO., LTD" },
                },
                vehicles: {
                    tractor: { transportDoc: "584AEK19" },
                    trailer: { transportDoc: "84ADL19" },
                },
            },
        },
    };
}

/**
 * Полный AI-ответ, имитирующий обработку INVOICE.jpg.
 *
 * ВАЖНО: AI в реальности видит ВСЕ документы одновременно и возвращает
 * один JSON с crossChecks, содержащим значения из всех источников (cmr, ttn, invoice).
 * Поэтому здесь включаем и cmr, и invoice — как это делает реальный LLM.
 *
 * merger.ts делает SHALLOW spread crossChecks, поэтому данные из последнего
 * обработанного результата перезаписывают предыдущие на верхнем уровне.
 * Это известное ограничение: если crossChecks приходят по одному ключу
 * от каждого документа отдельно — сравнение не запустится.
 */
function makeInvoiceResult() {
    return {
        schemaVersion: "1.0",
        document: { type: "INVOICE", number: "XYHYWB1707", date: "2026-01-24" },
        filename: "INVOICE.jpg",
        consignor: CONSIGNOR_FROM_INVOICE,
        consignee: CONSIGNEE_FROM_INVOICE,
        countries: { departureCountry: "CN", destinationCountry: "AF" },
        products: PRODUCTS_19.map((p) => ({ ...p })), // копия, чтобы мутации в тестах не влияли на PRODUCTS_19
        totalWeight: 28420,
        totalPackages: 1640,
        totalCost: 19680,
        validation: {
            warnings: [],
            errors: [],
            crossChecks: {
                // Оба источника в одном объекте — как делает реальный AI
                weight: { cmr: 28420, invoice: 28420, ttn: 28420 },
                packages: { cmr: 1640, invoice: 1640, ttn: 1640 },
                names: {
                    consignee: { cmr: "OMAR NOMAN LTD", invoice: "OMAR NOMAN LTD" },
                    consignor: { cmr: "YIWU TAMING TRADING CO., LTD", invoice: "YIWU TAMING TRADING CO.,LTD" },
                },
                finances: { invoiceTotal: 19680, calculatedSum: 19680 },
            },
        },
    };
}

/** Ответ ТТН — подтверждает данные CMR */
function makeTtnResult() {
    return {
        schemaVersion: "1.0",
        document: { type: "TRANSPORT_DOC", number: "ГС42840", date: "2026-01-24" },
        filename: "ТТН.jpg",
        consignor: CONSIGNOR_FROM_CMR,
        consignee: CONSIGNEE_FROM_CMR,
        countries: { departureCountry: "CN", destinationCountry: "AF" },
        totalWeight: 28420,
        totalPackages: 1640,
        validation: {
            warnings: [],
            errors: [],
            crossChecks: {
                weight: { ttn: 28420 },
                packages: { ttn: 1640 },
            },
        },
    };
}

// ═══════════════════════════════════════════════════════════
// ЧАСТЬ 1: normalizeName — реальные названия из документов
// ═══════════════════════════════════════════════════════════

Deno.test("normalizeName: YIWU TAMING TRADING CO., LTD → удаляет правовые формы", async () => {
    // TRADING, CO, LTD — все три должны быть удалены
    assertEquals(normalizeName("YIWU TAMING TRADING CO., LTD"), "YIWUTAMING");
});

Deno.test("normalizeName: YIWU TAMING TRADING CO.,LTD (без пробела) — идентичен варианту с пробелом", async () => {
    // В документах встречаются оба формата — нормализация должна давать одинаковый результат
    assertEquals(
        normalizeName("YIWU TAMING TRADING CO.,LTD"),
        normalizeName("YIWU TAMING TRADING CO., LTD"),
    );
});

Deno.test("normalizeName: OMAR NOMAN LTD → удаляет LTD", async () => {
    assertEquals(normalizeName("OMAR NOMAN LTD"), "OMARNOMAN");
});

Deno.test("normalizeName: OMAR NOMAN LTD === OMAR NOMAN LIMITED (разные формы записи)", async () => {
    assertEquals(normalizeName("OMAR NOMAN LTD"), normalizeName("OMAR NOMAN LIMITED"));
});

Deno.test("normalizeName: ТОО SENIM-PARTS → удаляет ТОО, оставляет SENIMPARTS", async () => {
    assertEquals(normalizeName("ТОО SENIM-PARTS"), "SENIMPARTS");
});

Deno.test("normalizeName: SENIM-PARTS (без ТОО) === ТОО SENIM-PARTS (с ТОО)", async () => {
    // Перевозчик в CMR может быть написан и так и так
    assertEquals(normalizeName("SENIM-PARTS"), normalizeName("ТОО SENIM-PARTS"));
});

// ═══════════════════════════════════════════════════════════
// ЧАСТЬ 2: calculateSimilarity — опечатки и вариации
// ═══════════════════════════════════════════════════════════

Deno.test("calculateSimilarity: EYELESHES vs EYELASHES — опечатка в инвойсе, схожесть > 0.8", async () => {
    // В документе написано EYELESHES (вместо EYELASHES) — система должна это поймать
    const sim = calculateSimilarity("EYELESHES", "EYELASHES");
    assertEquals(sim > 0.8, true, `Ожидалось > 0.8, получено ${sim}`);
});

Deno.test("calculateSimilarity: YIWU TAMING CO LTD vs YIWU TAMING CO.,LTD после нормализации = 1.0", async () => {
    const a = normalizeName("YIWU TAMING TRADING CO., LTD");
    const b = normalizeName("YIWU TAMING TRADING CO.,LTD");
    assertEquals(calculateSimilarity(a, b), 1.0);
});

Deno.test("calculateSimilarity: OMAR NOMAN vs OMARNOMAN — полное совпадение после нормализации", async () => {
    const a = normalizeName("OMAR NOMAN LTD");
    const b = normalizeName("OMAR NOMAN LIMITED");
    assertEquals(calculateSimilarity(a, b), 1.0);
});

// ═══════════════════════════════════════════════════════════
// ЧАСТЬ 3: mergeAgentResults — интеграция CMR + Invoice
// ═══════════════════════════════════════════════════════════

Deno.test("merge[CMR+Invoice]: consignor — YIWU TAMING", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const consignor = result.mergedData.counteragents.consignor;
    assertExists(consignor);
    assertEquals(consignor.present, true);
    assertEquals(consignor.entityType, "NON_RESIDENT_LEGAL");
    // Нормализованное имя должно содержать YIWUTAMING
    const rawName = consignor.nonResidentLegal?.nameRu || "";
    assertEquals(normalizeName(rawName), "YIWUTAMING");
});

Deno.test("merge[CMR+Invoice]: consignee — OMAR NOMAN LTD, страна AF", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const consignee = result.mergedData.counteragents.consignee;
    assertExists(consignee);
    assertEquals(consignee.present, true);
    assertEquals(consignee.entityType, "NON_RESIDENT_LEGAL");
    assertEquals(normalizeName(consignee.nonResidentLegal?.nameRu || ""), "OMARNOMAN");
    assertEquals(consignee.addresses[0]?.countryCode, "AF");
});

Deno.test("merge[CMR+Invoice]: carrier — SENIM-PARTS с БИН 250140031008", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const carrier = result.mergedData.counteragents.carrier;
    assertExists(carrier);
    assertEquals(carrier.present, true);
    assertEquals(carrier.entityType, "LEGAL");
    assertEquals(carrier.legal?.bin, "250140031008");
    assertEquals(normalizeName(carrier.legal?.nameRu || ""), "SENIMPARTS");
});

Deno.test("merge[CMR+Invoice]: страны — CN отправка, AF назначение", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    assertEquals(result.mergedData.countries.departureCountry, "CN");
    assertEquals(result.mergedData.countries.destinationCountry, "AF");
});

Deno.test("merge[CMR+Invoice]: страны берутся из CMR когда source содержит 'cmr'", async () => {
    // CMR указывает CN→AF, Invoice тоже CN→AF — но приоритет у CMR
    const cmr = makeCmrResult();
    const inv = makeInvoiceResult();
    // Симулируем расхождение: Invoice говорит другую страну
    inv.countries.departureCountry = "TR";
    const result = await mergeAgentResults([cmr, inv]);
    // CMR должен выиграть, так как source = "Транспортный dok. (CMR.jpg)" содержит "cmr"
    assertEquals(result.mergedData.countries.departureCountry, "CN");
});

Deno.test("merge[Invoice]: 19 товаров, все извлечены", async () => {
    const result = await mergeAgentResults([makeInvoiceResult()]);
    assertEquals(result.mergedData.products.length, 19);
});

Deno.test("merge[Invoice]: realTechnicalSum = 19680 USD", async () => {
    const result = await mergeAgentResults([makeInvoiceResult()]);
    assertEquals(result.validation.realTechnicalSum, 19680);
});

Deno.test("merge[Invoice]: финансовая проверка ПРОЙДЕНА (invoiceTotal == calculatedSum)", async () => {
    const result = await mergeAgentResults([makeInvoiceResult()]);
    const successMsg = result.validation.warnings.some(
        (w: any) => (w.message || String(w)).includes("подтвержден") || (w.message || String(w)).includes("19680"),
    );
    assertEquals(successMsg, true);
    // Нет финансовых ошибок
    const financeError = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("ОШИБКА В СУММЕ"),
    );
    assertEquals(financeError, false);
});

Deno.test("merge[CMR+Invoice]: кол-во мест совпадает (CMR=1640, Invoice=1640) → SUCCESS", async () => {
    // makeInvoiceResult() уже содержит crossChecks.packages = { cmr:1640, invoice:1640, ttn:1640 }
    // После shallow-merge Invoice перезаписывает crossChecks CMR, поэтому все 3 ключа видны
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const packagesOk = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("1640") || (msg.includes("Количество мест") && msg.includes("✅"));
        },
    );
    assertEquals(packagesOk, true);
});

Deno.test("merge[CMR+Invoice]: вес совпадает (CMR=28420, Invoice=28420) → SUCCESS", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const weightOk = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("28420") || (msg.includes("Вес") && msg.includes("✅"));
        },
    );
    assertEquals(weightOk, true);
});

Deno.test("merge[CMR+Invoice]: транспорт — тягач 584AEK19, прицеп 84ADL19", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    assertEquals(result.mergedData.vehicles.tractorRegNumber, "584AEK19");
    assertEquals(result.mergedData.vehicles.trailerRegNumber, "84ADL19");
    assertEquals(result.mergedData.vehicles.tractorCountry, "KZ");
    assertEquals(result.mergedData.vehicles.trailerCountry, "KZ");
});

Deno.test("merge[CMR+Invoice]: отправитель — незначительная опечатка (CO., vs CO.,) не создает ERROR", async () => {
    // Два варианта написания: "CO., LTD" vs "CO.,LTD" — нормализуются одинаково → не конфликт
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const consignorConflict = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("РАСХОЖДЕНИЕ У ОТПРАВИТЕЛЯ"),
    );
    assertEquals(consignorConflict, false);
});

Deno.test("merge[CMR+Invoice]: получатель совпадает во всех документах → нет КОНФЛИКТ-предупреждений", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const consigneeConflict = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("КОНФЛИКТ") && msg.includes("получател");
        },
    );
    assertEquals(consigneeConflict, false);
});

// ═══════════════════════════════════════════════════════════
// ЧАСТЬ 4: граничные случаи из этих документов
// ═══════════════════════════════════════════════════════════

Deno.test("merge[Invoice]: дублирующийся HS код 950691 → оба товара сохранены (KNEE BRACE и SPORTS EQUIPMENT)", async () => {
    const result = await mergeAgentResults([makeInvoiceResult()]);
    const with950691 = result.mergedData.products.filter(
        (p: any) => p.tnvedCode === "950691",
    );
    assertEquals(with950691.length, 2, "Оба товара с одинаковым HS кодом должны быть сохранены");
});

Deno.test("merge[Invoice]: дублирующийся HS 732399 → два товара (TEA MAKER и WATER JUG)", async () => {
    // Оба переводятся как «чайник», но это разные товары
    const result = await mergeAgentResults([makeInvoiceResult()]);
    const with732399 = result.mergedData.products.filter(
        (p: any) => p.tnvedCode === "732399",
    );
    assertEquals(with732399.length, 2);
    const names = with732399.map((p: any) => p.commercialName);
    assertEquals(names.some((n: string) => n.includes("TEA MAKER")), true);
    assertEquals(names.some((n: string) => n.includes("WATER JUG")), true);
});

Deno.test("merge[Invoice]: опечатка EYELESHES сохранена как есть в commercialName", async () => {
    const result = await mergeAgentResults([makeInvoiceResult()]);
    const eyelash = result.mergedData.products.find(
        (p: any) => p.commercialName.includes("EYELESHES"),
    );
    assertExists(eyelash, "Товар с опечаткой EYELESHES должен быть в списке");
    assertEquals(eyelash.tnvedCode, "670410");
    assertEquals(eyelash.cost, 480);
});

Deno.test("merge[CMR+Invoice+ТТН]: три документа — документы собираются все 3", async () => {
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult(), makeTtnResult()]);
    assertEquals(result.documents.length, 3);
});

Deno.test("merge[CMR+Invoice+ТТН]: ТТН не перебивает товары из инвойса (Invoice priority=1 > TTN данные)", async () => {
    // ТТН не содержит список товаров — продукты берутся из Invoice
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult(), makeTtnResult()]);
    assertEquals(result.mergedData.products.length, 19);
});

Deno.test("merge: если финансы не совпадают — ОШИБКА в validation.errors", async () => {
    // Симулируем расхождение: AI извлёк сумму 19680, а товары считаются в 15000
    const inv = makeInvoiceResult();
    // Портим стоимость первого товара
    inv.products[0].cost = 100; // было 6876, теперь 100 → итог = 19680 - 6776 = 12904
    const result = await mergeAgentResults([inv]);
    const hasFinanceError = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("ОШИБКА В СУММЕ"),
    );
    assertEquals(hasFinanceError, true);
});

Deno.test("merge[CMR]: получатель — адрес без CONTACT-строки (контакт вырезан)", async () => {
    // Проверяем что fullAddress не содержит телефонный номер получателя
    // (0093791888777 — должен быть вырезан на стороне AI согласно промпту)
    const result = await mergeAgentResults([makeCmrResult()]);
    const addr = result.mergedData.counteragents.consignee?.addresses[0]?.fullAddress || "";
    assertEquals(addr.includes("0093791888777"), false, "Телефон не должен попасть в адрес");
    assertEquals(addr.includes("NANGARHAR") || addr.includes("JALAL ABAD"), true, "Адрес должен содержать город");
});

Deno.test("merge[CMR]: отправитель — адрес без CONTACT-строки", async () => {
    // CONTACT: 15057904307-15057941852 должен быть вырезан
    const result = await mergeAgentResults([makeCmrResult()]);
    const addr = result.mergedData.counteragents.consignor?.addresses[0]?.fullAddress || "";
    assertEquals(addr.includes("15057904307"), false, "Телефон отправителя не должен попасть в адрес");
    assertEquals(addr.includes("YIWU") || addr.includes("ZHEJIANG"), true, "Адрес должен содержать город");
});

Deno.test("merge[Invoice]: Σ quantity товаров = 1640 мест (совпадает с CMR/ТТН)", async () => {
    const result = await mergeAgentResults([makeInvoiceResult()]);
    const totalQty = result.mergedData.products.reduce(
        (acc: number, p: any) => acc + (p.quantity || 0), 0,
    );
    assertEquals(totalQty, 1640);
});

Deno.test("merge[Invoice]: Σ grossWeight товаров = 28420 кг", async () => {
    const result = await mergeAgentResults([makeInvoiceResult()]);
    const totalGross = result.mergedData.products.reduce(
        (acc: number, p: any) => acc + (p.grossWeight || 0), 0,
    );
    assertEquals(totalGross, 28420);
});

// ═══════════════════════════════════════════════════════════
// ЧАСТЬ 5: Новые программные проверки кросс-валидации
// ═══════════════════════════════════════════════════════════

Deno.test("crossChecks[deepMerge]: два документа с разными ключами weight объединяются без потери", async () => {
    // CMR даёт weight.cmr, Invoice даёт weight.invoice — после deep merge оба должны быть
    const cmr = makeCmrResult();
    // @ts-ignore: тестируем частичный crossChecks
    cmr.validation.crossChecks = { weight: { cmr: 28420 }, packages: { cmr: 1640 } };
    const inv = makeInvoiceResult();
    // Invoice crossChecks уже содержит { weight: { cmr:28420, invoice:28420 }, ... }
    // Тест: после merge оба ключа присутствуют
    const result = await mergeAgentResults([cmr, inv]);
    const w = result.validation.crossChecks?.weight;
    assertEquals(typeof w?.cmr, "number", "cmr должен сохраниться");
    assertEquals(typeof w?.invoice, "number", "invoice должен сохраниться");
});

Deno.test("crossChecks[deepMerge]: names сохраняются от обоих документов", async () => {
    // CMR даёт names.consignee.cmr, Invoice даёт names.consignee.invoice
    const cmr = makeCmrResult();
    // @ts-ignore: тестируем частичный crossChecks
    cmr.validation.crossChecks = {
        names: { consignee: { cmr: "OMAR NOMAN LTD" }, consignor: { cmr: "YIWU TAMING" } },
    };
    const inv = makeInvoiceResult();
    // makeInvoiceResult уже включает names.consignee.invoice и names.consignee.cmr
    const result = await mergeAgentResults([cmr, inv]);
    const consigneeNames = result.validation.crossChecks?.names?.consignee;
    assertExists(consigneeNames?.cmr, "имя получателя из CMR должно сохраниться");
    assertExists(consigneeNames?.invoice, "имя получателя из Invoice должно сохраниться");
});

Deno.test("programmatic: Σ quantity=totalPackages → SUCCESS warning", async () => {
    // Invoice: 19 товаров, Σ quantity=1640. CMR: totalPackages=1640
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const ok = result.validation.warnings.some(
        (w: any) => (w.message || String(w)).includes("Кол-во мест") && (w.message || String(w)).includes("✅"),
    );
    assertEquals(ok, true, "Должен быть SUCCESS о совпадении кол-ва мест");
});

Deno.test("programmatic: Σ quantity ≠ totalPackages → ERROR", async () => {
    // CMR говорит 1640, но в products только 1 позиция с qty=5
    const cmr = makeCmrResult();
    const inv = makeInvoiceResult();
    // Подменяем товары: только одна позиция с qty=5 (вместо 1640)
    inv.products = [{ tnvedCode: "640419", commercialName: "SHOES", grossWeight: 100, quantity: 5, cost: 100, currencyCode: "USD" }];
    const result = await mergeAgentResults([cmr, inv]);
    const hasError = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("ОШИБКА КОЛ-ВА МЕСТ"),
    );
    assertEquals(hasError, true);
});

Deno.test("programmatic: Σ grossWeight=totalWeight → SUCCESS warning", async () => {
    // Invoice: Σ grossWeight=28420. CMR: totalWeight=28420
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const ok = result.validation.warnings.some(
        (w: any) => (w.message || String(w)).includes("Вес брутто") && (w.message || String(w)).includes("✅"),
    );
    assertEquals(ok, true, "Должен быть SUCCESS о весе брутто");
});

Deno.test("programmatic: Σ grossWeight ≠ totalWeight → ERROR", async () => {
    const cmr = makeCmrResult(); // totalWeight=28420
    const inv = makeInvoiceResult();
    // Подменяем товар с сильно другим весом
    inv.products = [{ tnvedCode: "640419", commercialName: "SHOES", grossWeight: 100, quantity: 1640, cost: 19680, currencyCode: "USD" }];
    const result = await mergeAgentResults([cmr, inv]);
    const hasError = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("ОШИБКА ВЕСА БРУТТО"),
    );
    assertEquals(hasError, true);
});

Deno.test("programmatic: номер инвойса в CMR совпадает с инвойсом → SUCCESS", async () => {
    const cmr = makeCmrResult();
    // @ts-ignore: добавляем invoiceRef к crossChecks
    cmr.validation.crossChecks = { ...cmr.validation.crossChecks, invoiceRef: { cmr: "XYHYWB1707" } };
    // Invoice document.number = "XYHYWB1707"
    const result = await mergeAgentResults([cmr, makeInvoiceResult()]);
    const ok = result.validation.warnings.some(
        (w: any) => (w.message || String(w)).includes("XYHYWB1707") && (w.message || String(w)).includes("✅"),
    );
    assertEquals(ok, true);
});

Deno.test("programmatic: номер инвойса в CMR НЕ совпадает → ERROR", async () => {
    const cmr = makeCmrResult();
    // @ts-ignore: добавляем invoiceRef к crossChecks
    cmr.validation.crossChecks = { ...cmr.validation.crossChecks, invoiceRef: { cmr: "XYHYWB9999" } };
    const result = await mergeAgentResults([cmr, makeInvoiceResult()]);
    const hasError = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("РАСХОЖДЕНИЕ НОМЕРА ИНВОЙСА"),
    );
    assertEquals(hasError, true);
});

Deno.test("programmatic: дата CMR (03.02.2026) ≥ дата инвойса (24.01.2026) → SUCCESS", async () => {
    // CMR: 2026-02-03, Invoice: 2026-01-24 → порядок правильный
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const ok = result.validation.warnings.some(
        (w: any) => (w.message || String(w)).includes("Порядок дат корректен") && (w.message || String(w)).includes("✅"),
    );
    assertEquals(ok, true);
});

Deno.test("programmatic: дата CMR раньше инвойса → ERROR", async () => {
    const cmr = makeCmrResult();
    // Подделываем: CMR датируется 2025-12-01, Invoice 2026-01-24 → ошибка
    cmr.document = { type: "TRANSPORT_DOC", number: "584AEK19", date: "2025-12-01" };
    const result = await mergeAgentResults([cmr, makeInvoiceResult()]);
    const hasError = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("ОШИБКА ДАТ"),
    );
    assertEquals(hasError, true);
});

Deno.test("programmatic: страна отправителя (CN) совпадает с departureCountry (CN) → SUCCESS", async () => {
    // YIWU TAMING → countryCode: "CN", departureCountry: "CN"
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const ok = result.validation.warnings.some(
        (w: any) => (w.message || String(w)).includes("Страна отправителя") && (w.message || String(w)).includes("✅"),
    );
    assertEquals(ok, true);
});

Deno.test("programmatic: страна получателя (AF) совпадает с destinationCountry (AF) → SUCCESS", async () => {
    // OMAR NOMAN → countryCode: "AF", destinationCountry: "AF"
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const ok = result.validation.warnings.some(
        (w: any) => (w.message || String(w)).includes("Страна получателя") && (w.message || String(w)).includes("✅"),
    );
    assertEquals(ok, true);
});

Deno.test("programmatic: страна отправителя ≠ departureCountry → WARNING о транзите", async () => {
    // Симулируем: отправитель из KZ, но departureCountry = CN (транзитный кейс)
    const cmr = makeCmrResult();
    cmr.consignor = {
        ...CONSIGNOR_FROM_CMR,
        addresses: [{ typeCode: "01", countryCode: "KZ", district: "ALMATY", fullAddress: "ALMATY" }],
    };
    const result = await mergeAgentResults([cmr]);
    const hasTransitWarning = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("Возможен транзит") || (msg.includes("Страна отправителя") && msg.includes("≠"));
        },
    );
    assertEquals(hasTransitWarning, true);
});

// ═══════════════════════════════════════════════════════════
// ЧАСТЬ 6: Majority vote по именам контрагентов
// ═══════════════════════════════════════════════════════════

Deno.test("majority vote: 2 документа с правильным именем, 1 с опечаткой → опечатка с указанием источника", async () => {
    // CMR и Invoice говорят "OMAR NOMAN LTD", ТТН говорит "OMAR NOMAN LMT" (опечатка)
    const input = [
        {
            schemaVersion: "1.0",
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.jpg",
            consignee: { present: true, entityType: "NON_RESIDENT_LEGAL", nonResidentLegal: { nameRu: "OMAR NOMAN LTD" }, legal: { bin: "", nameRu: "" }, addresses: [{ countryCode: "AF" }] },
        },
        {
            schemaVersion: "1.0",
            document: { type: "INVOICE" },
            filename: "invoice.jpg",
            consignee: { present: true, entityType: "NON_RESIDENT_LEGAL", nonResidentLegal: { nameRu: "OMAR NOMAN LTD" }, legal: { bin: "", nameRu: "" }, addresses: [{ countryCode: "AF" }] },
        },
        {
            schemaVersion: "1.0",
            document: { type: "TRANSPORT_DOC" },
            filename: "ttn.jpg",
            consignee: { present: true, entityType: "NON_RESIDENT_LEGAL", nonResidentLegal: { nameRu: "OMAR NOMAN LMT" }, legal: { bin: "", nameRu: "" }, addresses: [{ countryCode: "AF" }] }, // опечатка
        },
    ];
    const result = await mergeAgentResults(input);

    // Должно быть предупреждение с указанием ttn.jpg как источника опечатки
    const typoWarning = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return (msg.includes("ОПЕЧАТКА") || msg.includes("КОНФЛИКТ")) && msg.includes("ПОЛУЧАТЕЛ");
        },
    );
    assertEquals(typoWarning, true, "Должно быть предупреждение об опечатке получателя");

    // Принятое имя — "OMAR NOMAN LTD" (большинство, 2 из 3)
    const accepted = result.mergedData.counteragents.consignee?.nonResidentLegal?.nameRu || "";
    assertEquals(normalizeName(accepted), "OMARNOMAN", "Должно быть принято имя от большинства");
});

Deno.test("majority vote: источник опечатки указан в сообщении (имя файла)", async () => {
    const input = [
        {
            schemaVersion: "1.0",
            document: { type: "INVOICE" },
            filename: "invoice.jpg",
            consignor: { present: true, entityType: "NON_RESIDENT_LEGAL", nonResidentLegal: { nameRu: "YIWU TAMING TRADING CO., LTD" }, legal: { bin: "", nameRu: "" }, addresses: [{ countryCode: "CN" }] },
        },
        {
            schemaVersion: "1.0",
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.jpg",
            consignor: { present: true, entityType: "NON_RESIDENT_LEGAL", nonResidentLegal: { nameRu: "YIWU TAMING TRADING CO., LTD" }, legal: { bin: "", nameRu: "" }, addresses: [{ countryCode: "CN" }] },
        },
        {
            schemaVersion: "1.0",
            document: { type: "TRANSPORT_DOC" },
            filename: "ttn.jpg",
            consignor: { present: true, entityType: "NON_RESIDENT_LEGAL", nonResidentLegal: { nameRu: "YIWU TMING TRADING CO., LTD" }, legal: { bin: "", nameRu: "" }, addresses: [{ countryCode: "CN" }] }, // опечатка TMING
        },
    ];
    const result = await mergeAgentResults(input);

    // Предупреждение должно содержать имя файла с опечаткой
    const warningWithSource = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("ttn.jpg") || msg.includes("ТТН");
        },
    );
    assertEquals(warningWithSource, true, "Источник опечатки (ttn.jpg) должен быть указан в сообщении");
});

Deno.test("majority vote: все документы согласны — нет конфликтных предупреждений", async () => {
    // CMR и Invoice оба говорят OMAR NOMAN LTD — нет конфликта
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const hasConflict = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("КОНФЛИКТ") || msg.includes("ОПЕЧАТКА");
        },
    );
    assertEquals(hasConflict, false);
});

// ═══════════════════════════════════════════════════════════
// ЧАСТЬ 7: Программная проверка стоимости (check #14)
// ═══════════════════════════════════════════════════════════

Deno.test("programmatic: totalCost берётся из Invoice, а не из CMR (per-field best-source)", async () => {
    // CMR не содержит totalCost=0, Invoice содержит totalCost=19680
    // Баг: если брать best-document глобально, CMR побеждает по приоритету но его cost=0
    // Fix: per-field — для cost берём лучший источник у которого cost>0 (Invoice)
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    assertEquals(result.mergedData.totalCost, 19680, "totalCost должен равняться 19680 из Invoice");
});

Deno.test("programmatic: Σ cost товаров = totalCost → SUCCESS warning", async () => {
    // Invoice: Σ cost=19680, totalCost=19680 → совпадает
    const result = await mergeAgentResults([makeCmrResult(), makeInvoiceResult()]);
    const ok = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("Стоимость") && msg.includes("✅");
        },
    );
    assertEquals(ok, true, "Должен быть SUCCESS о совпадении стоимости");
});

Deno.test("programmatic: Σ cost товаров ≠ totalCost → ERROR", async () => {
    // Invoice говорит totalCost=19680, но товары подменяем на 1 позицию с cost=100
    const inv = makeInvoiceResult();
    inv.products = [{
        tnvedCode: "640419", commercialName: "SHOES", grossWeight: 100,
        quantity: 1640, cost: 100, currencyCode: "USD",
    }];
    // totalCost=19680 остаётся в inv, но realTechnicalSum теперь = 100
    const result = await mergeAgentResults([makeCmrResult(), inv]);
    const hasError = result.validation.errors.some(
        (e: any) => (e.message || String(e)).includes("ОШИБКА СТОИМОСТИ"),
    );
    assertEquals(hasError, true, "Должна быть ошибка о расхождении стоимости");
});
