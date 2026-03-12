import { assertEquals, assertExists } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { mergeAgentResults, getDocLabel } from "../merger.ts";
import { normalizeName, calculateSimilarity } from "../utils.ts";

// ═══════════════════════════════════════════════════
// ТЕСТЫ utils.ts
// ═══════════════════════════════════════════════════

Deno.test("normalizeName: удаляет LTD и пунктуацию", () => {
    assertEquals(normalizeName("ACME LTD."), "ACME");
});

Deno.test("normalizeName: удаляет ТОО", () => {
    assertEquals(normalizeName("ТОО Ромашка"), "РОМАШКА");
});

Deno.test("normalizeName: пустая строка", () => {
    assertEquals(normalizeName(""), "");
});

Deno.test("normalizeName: null/undefined", () => {
    // @ts-ignore: testing runtime safety
    assertEquals(normalizeName(null), "");
});

Deno.test("calculateSimilarity: идентичные строки = 1.0", () => {
    assertEquals(calculateSimilarity("ACME", "ACME"), 1.0);
});

Deno.test("calculateSimilarity: опечатка в 1 букву > 0.8", () => {
    const sim = calculateSimilarity("TAMING", "TMING");
    assertEquals(sim > 0.8, true);
});

Deno.test("calculateSimilarity: полностью разные строки < 0.3", () => {
    const sim = calculateSimilarity("ABCDEF", "ZYXWVU");
    assertEquals(sim < 0.3, true);
});

Deno.test("calculateSimilarity: пустые строки → 0", () => {
    assertEquals(calculateSimilarity("", ""), 0);
    assertEquals(calculateSimilarity("ABC", ""), 0);
});

// ═══════════════════════════════════════════════════
// ТЕСТЫ merger.ts
// ═══════════════════════════════════════════════════

Deno.test("mergeAgentResults: пустой массив → пустая структура", async () => {
    const result = await mergeAgentResults([]);
    assertExists(result.mergedData);
    assertExists(result.validation);
    assertEquals(result.mergedData.products.length, 0);
    assertEquals(result.mergedData.counteragents.consignor.present, false);
    assertEquals(result.mergedData.counteragents.consignee.present, false);
});

Deno.test("mergeAgentResults: один результат с consignor → заполняет counteragents", async () => {
    const input = [{
        consignor: {
            present: true,
            entityType: "NON_RESIDENT_LEGAL",
            nonResidentLegal: { nameRu: "SHANGHAI TRADING CO" },
            addresses: [{ countryCode: "CN", district: "SHANGHAI" }],
        },
        document: { type: "INVOICE", number: "INV-001", date: "2025-01-15" },
        filename: "invoice.pdf",
    }];
    const result = await mergeAgentResults(input);
    assertEquals(result.mergedData.counteragents.consignor.present, true);
    assertEquals(
        result.mergedData.counteragents.consignor.nonResidentLegal?.nameRu,
        "SHANGHAI TRADING CO",
    );
});

Deno.test("mergeAgentResults: приоритет товаров — REGISTRY(4) > INVOICE(1)", async () => {
    const input = [
        {
            document: { type: "INVOICE" },
            filename: "invoice.pdf",
            products: [
                { tnvedCode: "123456", commercialName: "Product from invoice", grossWeight: 100, quantity: 1, cost: 500, currencyCode: "USD" },
            ],
        },
        {
            document: { type: "REGISTRY" },
            filename: "registry.xlsx",
            products: [
                { tnvedCode: "654321", commercialName: "Product from registry", grossWeight: 200, quantity: 2, cost: 1000, currencyCode: "USD" },
                { tnvedCode: "111111", commercialName: "Product 2 from registry", grossWeight: 50, quantity: 1, cost: 300, currencyCode: "USD" },
            ],
        },
    ];
    const result = await mergeAgentResults(input);
    assertEquals(result.mergedData.products.length, 2);
    assertEquals(result.mergedData.products[0].commercialName, "Product from registry");
});

Deno.test("mergeAgentResults: конфликт имён получателя → предупреждение", async () => {
    const input = [
        {
            document: { type: "INVOICE" },
            filename: "invoice.pdf",
            consignee: { present: true, entityType: "LEGAL", legal: { bin: "123456789012", nameRu: "ТОО АЛЬФА" } },
        },
        {
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.pdf",
            consignee: { present: true, entityType: "LEGAL", legal: { bin: "123456789012", nameRu: "ТОО БЕТА" } },
        },
    ];
    const result = await mergeAgentResults(input);
    const hasConflictWarning = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("КОНФЛИКТ") || msg.includes("различаются") || msg.includes("отличается");
        },
    );
    assertEquals(hasConflictWarning, true);
});

Deno.test("mergeAgentResults: realTechnicalSum вычисляется как сумма cost товаров", async () => {
    const input = [{
        document: { type: "INVOICE" },
        filename: "invoice.pdf",
        products: [
            { tnvedCode: "111111", commercialName: "A", grossWeight: 10, quantity: 1, cost: 100.50, currencyCode: "USD" },
            { tnvedCode: "222222", commercialName: "B", grossWeight: 20, quantity: 2, cost: 200.25, currencyCode: "USD" },
        ],
    }];
    const result = await mergeAgentResults(input);
    assertEquals(result.validation.realTechnicalSum, 300.75);
});

Deno.test("mergeAgentResults: транспорт — VEHICLE_DOC имеет приоритет над TRANSPORT_DOC", async () => {
    const input = [
        {
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.pdf",
            vehicles: { tractorRegNumber: "111AAA01", tractorCountry: "KZ", trailerRegNumber: "22BBB02", trailerCountry: "KZ" },
        },
        {
            document: { type: "VEHICLE_DOC" },
            filename: "techpassport.pdf",
            vehicles: { tractorRegNumber: "333CCC03", tractorCountry: "KZ", trailerRegNumber: "44DDD04", trailerCountry: "KZ" },
        },
    ];
    const result = await mergeAgentResults(input);
    // handleVehicles: picks VEHICLE_DOC if present
    assertEquals(result.mergedData.vehicles.tractorRegNumber, "333CCC03");
});

Deno.test("mergeAgentResults: водитель из DRIVER_ID — driver.present=true", async () => {
    const input = [{
        document: { type: "DRIVER_ID" },
        filename: "passport.pdf",
        driver: { present: true, iin: "990101350123", firstName: "IVAN", lastName: "PETROV" },
    }];
    const result = await mergeAgentResults(input);
    assertEquals(result.mergedData.driver.present, true);
    assertEquals(result.mergedData.driver.iin, "990101350123");
    assertEquals(result.mergedData.driver.firstName, "IVAN");
});

// ПРИМЕЧАНИЕ: Известный баг в merger.ts — поиск CMR по source.includes("CMR"),
// но source формируется как "Транспортный dok. (cmr.pdf)" (lowercase "cmr").
// Из-за этого merger не находит CMR-запись и берёт первый элемент (INVOICE).
// Тест зафиксирован с РЕАЛЬНЫМ поведением. Исправление: сделать проверку
// case-insensitive: m.source.toLowerCase().includes("cmr")
Deno.test("mergeAgentResults: страны — CMR-приоритет работает (кейс-инсенситив)", async () => {
    const input = [
        {
            document: { type: "INVOICE" },
            filename: "invoice.pdf",
            countries: { departureCountry: "CN", destinationCountry: "KZ" },
        },
        {
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.pdf",
            countries: { departureCountry: "AF", destinationCountry: "KZ" },
        },
    ];
    const result = await mergeAgentResults(input);
    // Теперь source "Транспортный док. (cmr.pdf)".toLowerCase().includes("cmr") = true
    // Берётся второй элемент (CMR): "AF"
    assertEquals(result.mergedData.countries.departureCountry, "AF");
});

Deno.test("mergeAgentResults: документы собираются из всех результатов", async () => {
    const input = [
        { document: { type: "INVOICE", number: "INV-1", date: "2025-01-01" }, filename: "inv.pdf" },
        { document: { type: "TRANSPORT_DOC", number: "CMR-1", date: "2025-01-02" }, filename: "cmr.pdf" },
        { document: { type: "DRIVER_ID", number: "N12345", date: "2020-05-01" }, filename: "pass.pdf" },
    ];
    const result = await mergeAgentResults(input);
    assertEquals(result.documents.length, 3);
});

// ═══════════════════════════════════════════════════
// ТЕСТЫ составных ключей crossChecks
// ═══════════════════════════════════════════════════

Deno.test("getDocLabel: составные ключи 'тип:файл' → читаемая метка", async () => {
    assertEquals(getDocLabel("invoice:ИНВОИС.jpg"), "Инвойс (ИНВОИС.jpg)");
    assertEquals(getDocLabel("cmr:CMR.jpg"), "CMR (CMR.jpg)");
    assertEquals(getDocLabel("ttn:ттн.jpg"), "ТТН (ттн.jpg)");
    // Обратная совместимость: старые ключи без ":" работают
    assertEquals(getDocLabel("invoice"), "Инвойс");
    assertEquals(getDocLabel("cmr"), "CMR");
});

Deno.test("crossChecks: составные ключи 'invoice:file.jpg' и 'invoice:file.xlsx' сохраняются", async () => {
    const input = [{
        schemaVersion: "1.0",
        document: { type: "INVOICE" },
        filename: "ИНВОИС.jpg",
        validation: {
            warnings: [], errors: [],
            crossChecks: {
                names: {
                    consignor: {
                        "cmr:CMR.jpg": "ZHE JIANG GLOBAL LIMITED",
                        "invoice:ИНВОИС.jpg": "ZHE JIANG GLOBAL LIMITED",
                        "invoice:240随车资料.xlsx": "THE JIANG GLONAL LIMITED",
                        "ttn:ттн.jpg": "ZHE JIANG GLOBAL LIMITED",
                    },
                },
            },
        },
    }];
    const result = await mergeAgentResults(input);
    const consignorNames = result.validation.crossChecks?.names?.consignor;
    // Все 4 ключа должны сохраниться (deepMergeCrossChecks не теряет их)
    assertEquals(Object.keys(consignorNames).length, 4);
});

Deno.test("crossChecks: Excel-инвойс с опечаткой порождает ошибку ОПЕЧАТКА/КОНФЛИКТ", async () => {
    const input = [{
        schemaVersion: "1.0",
        document: { type: "INVOICE" },
        filename: "ИНВОИС.jpg",
        consignor: {
            present: true, entityType: "NON_RESIDENT_LEGAL",
            nonResidentLegal: { nameRu: "ZHE JIANG GLOBAL LIMITED" },
            legal: { bin: "", nameRu: "" },
            addresses: [{ countryCode: "CN" }],
        },
        validation: {
            warnings: [], errors: [],
            crossChecks: {
                names: {
                    consignor: {
                        "cmr:CMR.jpg": "ZHE JIANG GLOBAL LIMITED",
                        "invoice:ИНВОИС.jpg": "ZHE JIANG GLOBAL LIMITED",
                        "invoice:240随车资料.xlsx": "THE JIANG GLONAL LIMITED",
                        "ttn:ттн.jpg": "ZHE JIANG GLOBAL LIMITED",
                    },
                },
            },
        },
    }];
    const result = await mergeAgentResults(input);
    // Должна быть ошибка с упоминанием Excel-файла
    const allMessages = [
        ...result.validation.errors.map((e: any) => e.message || String(e)),
        ...result.validation.warnings.map((w: any) => w.message || String(w)),
    ];
    const hasExcelError = allMessages.some((msg) =>
        msg.includes("240随车资料.xlsx") || msg.includes("THE JIANG GLONAL")
    );
    assertEquals(hasExcelError, true, "Ошибка в Excel-инвойсе должна быть обнаружена");
});

Deno.test("mergeAgentResults: schemaVersion unknown → validation warning", async () => {
    const input = [{
        schemaVersion: "99.0",
        document: { type: "INVOICE" },
        filename: "invoice.pdf",
        products: [],
    }];
    const result = await mergeAgentResults(input);
    const hasSchemaWarning = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("99.0") || msg.includes("schemaVersion") || msg.includes("версия схемы");
        },
    );
    assertEquals(hasSchemaWarning, true);
});

// ═══════════════════════════════════════════════════
// ТЕСТЫ параллельного режима (buildProgrammaticCrossChecks)
// ═══════════════════════════════════════════════════

Deno.test("parallel: buildProgrammaticCrossChecks строит weight из docTotals", async () => {
    // Два агента без AI crossChecks — merger должен собрать их сам
    const input = [
        {
            document: { type: "INVOICE" },
            filename: "invoice.jpg",
            totalWeight: 28000,
            totalPackages: 7,
            totalCost: 0,
            // validation БЕЗ crossChecks
        },
        {
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.jpg",
            totalWeight: 28420,
            totalPackages: 7,
            totalCost: 0,
        },
    ];
    const result = await mergeAgentResults(input);
    const wt = result.validation.crossChecks?.weight;
    assertExists(wt, "crossChecks.weight должен быть собран программно");
    const weightValues = Object.values(wt).filter((v: any) => typeof v === "number");
    assertEquals(weightValues.length >= 2, true, "Должно быть минимум 2 источника веса");
    assertEquals(Object.values(wt).some((v: any) => v === 28000), true, "Вес инвойса 28000");
    assertEquals(Object.values(wt).some((v: any) => v === 28420), true, "Вес CMR 28420");
});

Deno.test("parallel: конфликт имён отправителя обнаруживается программно (без AI crossChecks)", async () => {
    // Агенты возвращают разные имена отправителя, crossChecks не заполнены AI
    const input = [
        {
            document: { type: "INVOICE" },
            filename: "invoice.jpg",
            consignor: {
                present: true,
                entityType: "NON_RESIDENT_LEGAL",
                nonResidentLegal: { nameRu: "BEIJING TRADING CO" },
                legal: { bin: "", nameRu: "" },
                addresses: [],
            },
        },
        {
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.jpg",
            consignor: {
                present: true,
                entityType: "NON_RESIDENT_LEGAL",
                nonResidentLegal: { nameRu: "SHANGHAI EXPORT LTD" },
                legal: { bin: "", nameRu: "" },
                addresses: [],
            },
        },
    ];
    const result = await mergeAgentResults(input);
    const allMsgs = [
        ...result.validation.errors.map((e: any) => e.message || String(e)),
        ...result.validation.warnings.map((w: any) => w.message || String(w)),
    ];
    const hasConflict = allMsgs.some((m) =>
        m.includes("КОНФЛИКТ") || m.includes("ОТПРАВИТЕЛЬ") || m.includes("BEIJING") || m.includes("SHANGHAI")
    );
    assertEquals(hasConflict, true, "Конфликт имён отправителя должен быть задетектирован");
    // crossChecks.names.consignor должен быть заполнен программно
    const names = result.validation.crossChecks?.names?.consignor;
    assertExists(names, "crossChecks.names.consignor должен быть собран программно");
    const nameValues = Object.values(names) as string[];
    assertEquals(nameValues.some((v) => v.includes("BEIJING")), true);
    assertEquals(nameValues.some((v) => v.includes("SHANGHAI")), true);
});

Deno.test("parallel: расхождение веса генерирует ошибку НЕСООТВЕТСТВИЕ", async () => {
    // Значительное расхождение веса между документами → должна быть ошибка
    const input = [
        {
            document: { type: "INVOICE" },
            filename: "invoice.jpg",
            totalWeight: 1000,
            totalPackages: 5,
            totalCost: 0,
        },
        {
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.jpg",
            totalWeight: 5000, // существенное расхождение
            totalPackages: 5,
            totalCost: 0,
        },
    ];
    const result = await mergeAgentResults(input);
    const hasWeightError = result.validation.errors.some(
        (e: any) => {
            const msg = e.message || String(e);
            return msg.includes("НЕСООТВЕТСТВИЕ ВЕСА") || msg.includes("ВЕС");
        },
    );
    assertEquals(hasWeightError, true, "Ошибка о расхождении веса должна присутствовать");
});

Deno.test("parallel: номер тягача совпадает в CMR и техпаспорте → подтверждение", async () => {
    const input = [
        {
            document: { type: "TRANSPORT_DOC" },
            filename: "cmr.jpg",
            vehicles: {
                tractorRegNumber: "111AAA",
                tractorCountry: "KZ",
                trailerRegNumber: "22BBB",
                trailerCountry: "KZ",
            },
        },
        {
            document: { type: "VEHICLE_DOC" },
            filename: "techpass.jpg",
            vehicles: {
                tractorRegNumber: "111AAA",
                tractorCountry: "KZ",
                trailerRegNumber: "22BBB",
                trailerCountry: "KZ",
            },
        },
    ];
    const result = await mergeAgentResults(input);
    // crossChecks.vehicles.tractor должен быть собран
    const tractor = result.validation.crossChecks?.vehicles?.tractor;
    assertExists(tractor, "crossChecks.vehicles.tractor должен быть собран");
    assertEquals(tractor.transportDoc, "111AAA");
    assertEquals(tractor.techPassport, "111AAA");
    // Подтверждение совпадения должно быть в предупреждениях
    const hasConfirmation = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("111AAA") && (msg.includes("✅") || msg.includes("техпаспорт"));
        },
    );
    assertEquals(hasConfirmation, true, "Подтверждение номера тягача должно присутствовать");
});

Deno.test("parallel: AI-заполненные crossChecks не перезаписываются программной сборкой", async () => {
    // AI уже заполнил crossChecks.weight с конкретным ключом
    const aiProvidedWeight = 99999;
    const input = [{
        document: { type: "INVOICE" },
        filename: "invoice.jpg",
        totalWeight: 28000, // это НЕ должно перезаписать AI-данные
        totalPackages: 5,
        totalCost: 0,
        validation: {
            warnings: [], errors: [],
            crossChecks: {
                weight: {
                    "invoice:invoice.jpg": aiProvidedWeight, // AI-заполненный ключ
                },
            },
        },
    }];
    const result = await mergeAgentResults(input);
    // AI-ключ должен сохранить своё значение
    assertEquals(
        result.validation.crossChecks?.weight?.["invoice:invoice.jpg"],
        aiProvidedWeight,
        "AI-заполненный ключ crossChecks не должен быть перезаписан",
    );
});
