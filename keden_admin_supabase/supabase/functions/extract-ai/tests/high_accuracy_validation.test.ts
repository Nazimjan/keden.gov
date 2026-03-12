import { assertEquals, assertExists } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { mergeAgentResults } from "../merger.ts";

// ═══════════════════════════════════════════════════
// ТЕСТЫ: Высокоточная кросс-валидация (VIN, Номера ТС, Упаковочный лист)
// ═══════════════════════════════════════════════════

// ── VIN SYNC ──────────────────────────────────────

Deno.test("VIN: совпадение техпаспорт и свидетельство → SUCCESS", async () => {
    const agentResults = [
        {
            filename: "techpassport.jpg",
            document: { type: "VEHICLE_DOC", number: "KZ-123456", date: "2023-01-01" },
            vehicles: { tractorRegNumber: "123ABC", tractorCountry: "KZ", vin: "WVWZZZ1JZ3W386752" },
            schemaVersion: "1.0",
        },
        {
            filename: "vehicle_permit.jpg",
            document: { type: "VEHICLE_PERMIT", number: "398 55400-010123-00049", date: "2023-01-01" },
            vehicles: { tractorRegNumber: "123ABC", tractorCountry: "KZ", vin: "WVWZZZ1JZ3W386752" },
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const vinSuccess = result.validation.warnings.some(
        (w: any) => w.severity === "SUCCESS" && w.message.includes("VIN"),
    );
    assertEquals(vinSuccess, true, "Должно быть SUCCESS сообщение о совпадении VIN");
});

Deno.test("VIN: несоответствие техпаспорт vs свидетельство → CRITICAL", async () => {
    const agentResults = [
        {
            filename: "techpassport.jpg",
            document: { type: "VEHICLE_DOC", number: "KZ-123456", date: "2023-01-01" },
            vehicles: { tractorRegNumber: "123ABC", tractorCountry: "KZ", vin: "WVWZZZ1JZ3W386752" },
            schemaVersion: "1.0",
        },
        {
            filename: "vehicle_permit.jpg",
            document: { type: "VEHICLE_PERMIT", number: "398 55400-010123-00049", date: "2023-01-01" },
            vehicles: { tractorRegNumber: "123ABC", tractorCountry: "KZ", vin: "WVWZZZ1JZ3W3867S2" }, // 'S' вместо '5'
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const vinCritical = result.validation.errors.some(
        (e: any) => e.severity === "CRITICAL" && e.message.includes("VIN"),
    );
    assertEquals(vinCritical, true, "Должна быть CRITICAL ошибка при несоответствии VIN");
    // Обе версии VIN должны фигурировать в сообщении
    const vinError = result.validation.errors.find((e: any) => e.message.includes("VIN"));
    assertExists(vinError);
    assertEquals(vinError.message.includes("WVWZZZ1JZ3W386752"), true);
    assertEquals(vinError.message.includes("WVWZZZ1JZ3W3867S2"), true);
});

// ── PLATE SYNC ────────────────────────────────────

Deno.test("Номер тягача: опечатка в одной цифре → CRITICAL", async () => {
    const agentResults = [
        {
            filename: "cmr.jpg",
            document: { type: "TRANSPORT_DOC", number: "584AEK19", date: "2025-03-01" },
            vehicles: { tractorRegNumber: "584AEK19", trailerRegNumber: "84ADL19", tractorCountry: "KZ", trailerCountry: "KZ" },
            validation: {
                crossChecks: {
                    vehicles: {
                        tractor: { transportDoc: "584AEK19", techPassport: "5B4AEK19" }, // '8' → 'B'
                    },
                },
            },
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const plateError = result.validation.errors.some(
        (e: any) => e.severity === "CRITICAL" && e.message.includes("ТЯГАЧА"),
    );
    assertEquals(plateError, true, "Должна быть CRITICAL ошибка при несоответствии номера тягача");
});

Deno.test("Номер прицепа: совпадение CMR и техпаспорт → SUCCESS", async () => {
    const agentResults = [
        {
            filename: "cmr.jpg",
            document: { type: "TRANSPORT_DOC", number: "584AEK19", date: "2025-03-01" },
            vehicles: { tractorRegNumber: "584AEK19", trailerRegNumber: "84ADL19", tractorCountry: "KZ", trailerCountry: "KZ" },
            validation: {
                crossChecks: {
                    vehicles: {
                        trailer: { transportDoc: "84ADL19", techPassport: "84ADL19" },
                    },
                },
            },
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const trailerOk = result.validation.warnings.some(
        (w: any) => w.severity === "SUCCESS" && w.message.includes("прицепа"),
    );
    assertEquals(trailerOk, true, "Должно быть SUCCESS при совпадении номера прицепа");
});

// ── PACKING LIST SYNC ─────────────────────────────

Deno.test("Упаковочный лист vs Инвойс: мест совпадают → SUCCESS", async () => {
    const makeProducts = (count: number, weight: number) =>
        Array.from({ length: count }, (_, i) => ({
            tnvedCode: "330499",
            commercialName: `Товар ${i + 1}`,
            grossWeight: weight,
            quantity: 1,
            cost: 100,
            currencyCode: "USD",
        }));

    const agentResults = [
        {
            filename: "invoice.jpg",
            document: { type: "INVOICE", number: "INV-001", date: "2025-02-10" },
            products: makeProducts(5, 10),
            totalWeight: 50,
            totalPackages: 5,
            totalCost: 500,
            schemaVersion: "1.0",
        },
        {
            filename: "packing_list.jpg",
            document: { type: "PACKING_LIST", number: "PL-001", date: "2025-02-10" },
            products: makeProducts(5, 10),
            totalWeight: 50,
            totalPackages: 5,
            totalCost: 0,
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const packOk = result.validation.warnings.some(
        (w: any) => w.severity === "SUCCESS" && w.message.includes("Упаковочный лист") && w.message.includes("мест"),
    );
    assertEquals(packOk, true, "Должно быть SUCCESS при совпадении мест Упак.лист/Инвойс");
});

Deno.test("Упаковочный лист vs Инвойс: расхождение мест → ERROR", async () => {
    const agentResults = [
        {
            filename: "invoice.jpg",
            document: { type: "INVOICE", number: "INV-001", date: "2025-02-10" },
            products: [
                { tnvedCode: "330499", commercialName: "Товар А", grossWeight: 10, quantity: 5, cost: 500, currencyCode: "USD" },
            ],
            totalWeight: 10,
            totalPackages: 5,
            totalCost: 500,
            schemaVersion: "1.0",
        },
        {
            filename: "packing_list.jpg",
            document: { type: "PACKING_LIST", number: "PL-001", date: "2025-02-10" },
            products: [
                { tnvedCode: "330499", commercialName: "Товар А", grossWeight: 10, quantity: 7, cost: 0, currencyCode: "USD" },
            ],
            totalWeight: 10,
            totalPackages: 7,
            totalCost: 0,
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const packError = result.validation.errors.some(
        (e: any) => e.message.includes("Упак.лист") && e.message.includes("≠"),
    );
    assertEquals(packError, true, "Должна быть ERROR при расхождении мест Упак.лист/Инвойс");
});

// ── STAMP DETECTION ───────────────────────────────

Deno.test("Отсутствие штампа на CMR → ERROR", async () => {
    const agentResults = [
        {
            filename: "cmr.jpg",
            document: { type: "TRANSPORT_DOC", number: "CMR-001", date: "2025-03-01" },
            hasStamp: false,
            vehicles: { tractorRegNumber: "123ABC", trailerRegNumber: "45DEF", tractorCountry: "KZ", trailerCountry: "KZ" },
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const stampError = result.validation.errors.some(
        (e: any) => e.message.includes("ШТАМП") && e.message.includes("cmr.jpg"),
    );
    assertEquals(stampError, true, "Должна быть ERROR при отсутствии штампа на CMR");
});

Deno.test("Наличие штампа на CMR и Инвойсе → SUCCESS x2", async () => {
    const agentResults = [
        {
            filename: "cmr.jpg",
            document: { type: "TRANSPORT_DOC", number: "CMR-001", date: "2025-03-01" },
            hasStamp: true,
            vehicles: { tractorRegNumber: "123ABC", trailerRegNumber: "45DEF", tractorCountry: "KZ", trailerCountry: "KZ" },
            schemaVersion: "1.0",
        },
        {
            filename: "invoice.jpg",
            document: { type: "INVOICE", number: "INV-001", date: "2025-02-25" },
            hasStamp: true,
            schemaVersion: "1.0",
        },
    ];
    const result = await mergeAgentResults(agentResults);
    const stampSuccessCount = result.validation.warnings.filter(
        (w: any) => w.severity === "SUCCESS" && w.message.includes("Штамп"),
    ).length;
    assertEquals(stampSuccessCount, 2, "Должно быть 2 SUCCESS сообщения о штампах");
});
