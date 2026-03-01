import { assertEquals, assertExists } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { mergeAgentResults } from "../merger.ts";
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

Deno.test("mergeAgentResults: пустой массив → пустая структура", () => {
    const result = mergeAgentResults([]);
    assertExists(result.mergedData);
    assertExists(result.validation);
    assertEquals(result.mergedData.products.length, 0);
    assertEquals(result.mergedData.counteragents.consignor.present, false);
    assertEquals(result.mergedData.counteragents.consignee.present, false);
});

Deno.test("mergeAgentResults: один результат с consignor → заполняет counteragents", () => {
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
    const result = mergeAgentResults(input);
    assertEquals(result.mergedData.counteragents.consignor.present, true);
    assertEquals(
        result.mergedData.counteragents.consignor.nonResidentLegal?.nameRu,
        "SHANGHAI TRADING CO",
    );
});

Deno.test("mergeAgentResults: приоритет товаров — REGISTRY(4) > INVOICE(1)", () => {
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
    const result = mergeAgentResults(input);
    assertEquals(result.mergedData.products.length, 2);
    assertEquals(result.mergedData.products[0].commercialName, "Product from registry");
});

Deno.test("mergeAgentResults: конфликт имён получателя → предупреждение", () => {
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
    const result = mergeAgentResults(input);
    const hasConflictWarning = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("КОНФЛИКТ") || msg.includes("различаются") || msg.includes("отличается");
        },
    );
    assertEquals(hasConflictWarning, true);
});

Deno.test("mergeAgentResults: realTechnicalSum вычисляется как сумма cost товаров", () => {
    const input = [{
        document: { type: "INVOICE" },
        filename: "invoice.pdf",
        products: [
            { tnvedCode: "111111", commercialName: "A", grossWeight: 10, quantity: 1, cost: 100.50, currencyCode: "USD" },
            { tnvedCode: "222222", commercialName: "B", grossWeight: 20, quantity: 2, cost: 200.25, currencyCode: "USD" },
        ],
    }];
    const result = mergeAgentResults(input);
    assertEquals(result.validation.realTechnicalSum, 300.75);
});

Deno.test("mergeAgentResults: транспорт — VEHICLE_DOC имеет приоритет над TRANSPORT_DOC", () => {
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
    const result = mergeAgentResults(input);
    // handleVehicles: picks VEHICLE_DOC if present
    assertEquals(result.mergedData.vehicles.tractorRegNumber, "333CCC03");
});

Deno.test("mergeAgentResults: водитель из DRIVER_ID — driver.present=true", () => {
    const input = [{
        document: { type: "DRIVER_ID" },
        filename: "passport.pdf",
        driver: { present: true, iin: "990101350123", firstName: "IVAN", lastName: "PETROV" },
    }];
    const result = mergeAgentResults(input);
    assertEquals(result.mergedData.driver.present, true);
    assertEquals(result.mergedData.driver.iin, "990101350123");
    assertEquals(result.mergedData.driver.firstName, "IVAN");
});

// ПРИМЕЧАНИЕ: Известный баг в merger.ts — поиск CMR по source.includes("CMR"),
// но source формируется как "Транспортный dok. (cmr.pdf)" (lowercase "cmr").
// Из-за этого merger не находит CMR-запись и берёт первый элемент (INVOICE).
// Тест зафиксирован с РЕАЛЬНЫМ поведением. Исправление: сделать проверку
// case-insensitive: m.source.toLowerCase().includes("cmr")
Deno.test("mergeAgentResults: страны — CMR-приоритет работает (кейс-инсенситив)", () => {
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
    const result = mergeAgentResults(input);
    // Теперь source "Транспортный док. (cmr.pdf)".toLowerCase().includes("cmr") = true
    // Берётся второй элемент (CMR): "AF"
    assertEquals(result.mergedData.countries.departureCountry, "AF");
});

Deno.test("mergeAgentResults: документы собираются из всех результатов", () => {
    const input = [
        { document: { type: "INVOICE", number: "INV-1", date: "2025-01-01" }, filename: "inv.pdf" },
        { document: { type: "TRANSPORT_DOC", number: "CMR-1", date: "2025-01-02" }, filename: "cmr.pdf" },
        { document: { type: "DRIVER_ID", number: "N12345", date: "2020-05-01" }, filename: "pass.pdf" },
    ];
    const result = mergeAgentResults(input);
    assertEquals(result.documents.length, 3);
});

Deno.test("mergeAgentResults: schemaVersion unknown → validation warning", () => {
    const input = [{
        schemaVersion: "99.0",
        document: { type: "INVOICE" },
        filename: "invoice.pdf",
        products: [],
    }];
    const result = mergeAgentResults(input);
    const hasSchemaWarning = result.validation.warnings.some(
        (w: any) => {
            const msg = w.message || String(w);
            return msg.includes("99.0") || msg.includes("schemaVersion") || msg.includes("версия схемы");
        },
    );
    assertEquals(hasSchemaWarning, true);
});
