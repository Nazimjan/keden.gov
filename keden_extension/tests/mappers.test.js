/**
 * Unit tests for content/mappers.js
 * Run: node tests/mappers.test.js
 */

// ─── Minimal test runner ───────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
        console.log(`  ✓ ${description}`);
        passed++;
    } else {
        console.error(`  ✗ ${description}`);
        console.error(`    Expected: ${JSON.stringify(expected)}`);
        console.error(`    Actual:   ${JSON.stringify(actual)}`);
        failed++;
    }
}

function section(name) {
    console.log(`\n${name}`);
}

// ─── Inline copies of tested functions (no browser deps) ──────────────────

// "PERSON" and "NON_RESIDENT" intentionally excluded: normalized before API submission
const VALID_ENTITY_TYPES = ["LEGAL", "NON_RESIDENT_LEGAL", "INDIVIDUAL", "NON_RESIDENT_PERSON", "ENTREPRENEUR"];

function normalizeEntityType(entityType, name = "") {
    if (!entityType) return "LEGAL";
    const upper = entityType.toUpperCase().replace(/[^A-Z_]/g, '');
    const upperName = (name || "").toUpperCase();

    const foreignIndicators = ["LTD", "LLC", "CORP", "INC", "PLC", "GMBH", "SARL", "SPA", "SDN BHD", "CO., LTD", "PTE LTD"];
    if (foreignIndicators.some(ind => upperName.includes(ind))) {
        return "NON_RESIDENT_LEGAL";
    }

    if (VALID_ENTITY_TYPES.includes(upper)) return upper;
    if (upper === "LEGAL_ENTITY" || upper === "LEGALENTITY") return "LEGAL";
    if (upper.includes("NON_RESIDENT") && upper.includes("LEGAL")) return "NON_RESIDENT_LEGAL";
    if (upper.includes("NON_RESIDENT") && upper.includes("PERSON")) return "NON_RESIDENT_PERSON";
    if (upper.includes("NON_RESIDENT")) return "NON_RESIDENT_LEGAL";
    if (upper.includes("LEGAL") || upper.includes("COMPANY")) return "LEGAL";
    if (upper.includes("INDIVIDUAL") || upper.includes("PERSON")) return "INDIVIDUAL";
    return "LEGAL";
}

function mapProductsPayload(aiProducts) {
    if (!aiProducts || !Array.isArray(aiProducts)) return [];

    return aiProducts.map((p, index) => {
        const tnved = p.tnvedCode ? p.tnvedCode.toString().substring(0, 6) : "000000";

        return {
            guid: `${index}_stub`, // replaced below in comparison
            tnvedCode: tnved,
            commercialName: p.commercialName || "Товар",
            quantity: "1",
            cargoSeatQuantity: p.quantity?.toString() || "0",
            packagingPalletsInfoPackageQuantity: p.quantity?.toString() || "0",
            grossWeight: p.grossWeight?.toString() || "0",
            cost: p.cost?.toString() || "0",
            currencyCode: p.currencyCode || "USD",
            packageType: "1",
            packagingPalletsInfoPackageTypeCode: "PK",
            packagingPalletsInfoPackageInfoType: "0",
            prohibitionFree: "1"
        };
    });
}

// Helper: compare product fields except random guid
function assertProduct(description, actual, expected) {
    const { guid: _a, ...a } = actual;
    const { guid: _e, ...e } = expected;
    assert(description, a, e);
}

// ─── Tests: normalizeEntityType ───────────────────────────────────────────
section('normalizeEntityType');

assert('("LEGAL", "ТОО Ромашка") → "LEGAL"',
    normalizeEntityType("LEGAL", "ТОО Ромашка"), "LEGAL");

assert('("LEGAL", "ACME LTD") → "NON_RESIDENT_LEGAL" (LTD в имени)',
    normalizeEntityType("LEGAL", "ACME LTD"), "NON_RESIDENT_LEGAL");

assert('("LEGAL", "SHANGHAI TRADING CO., LTD") → "NON_RESIDENT_LEGAL"',
    normalizeEntityType("LEGAL", "SHANGHAI TRADING CO., LTD"), "NON_RESIDENT_LEGAL");

assert('("", "") → "LEGAL" (default)',
    normalizeEntityType("", ""), "LEGAL");

assert('("NON_RESIDENT_LEGAL", "Test") → "NON_RESIDENT_LEGAL" (valid type)',
    normalizeEntityType("NON_RESIDENT_LEGAL", "Test"), "NON_RESIDENT_LEGAL");

assert('("INDIVIDUAL", "Иванов") → "INDIVIDUAL"',
    normalizeEntityType("INDIVIDUAL", "Иванов"), "INDIVIDUAL");

assert('("LEGAL_ENTITY", "") → "LEGAL" (mapped alias)',
    normalizeEntityType("LEGAL_ENTITY", ""), "LEGAL");

assert('("COMPANY", "") → "LEGAL" (COMPANY includes COMPANY)',
    normalizeEntityType("COMPANY", ""), "LEGAL");

assert('("PERSON", "") → "INDIVIDUAL" (PERSON maps to INDIVIDUAL)',
    normalizeEntityType("PERSON", ""), "INDIVIDUAL");

assert('("NON_RESIDENT", "") → "NON_RESIDENT_LEGAL"',
    normalizeEntityType("NON_RESIDENT", ""), "NON_RESIDENT_LEGAL");

assert('("NON_RESIDENT_PERSON", "") → "NON_RESIDENT_PERSON"',
    normalizeEntityType("NON_RESIDENT_PERSON", ""), "NON_RESIDENT_PERSON");

assert('("GARBAGE_VALUE", "") → "LEGAL" (fallback)',
    normalizeEntityType("GARBAGE_VALUE", ""), "LEGAL");

assert('(null, "") → "LEGAL"',
    normalizeEntityType(null, ""), "LEGAL");

assert('(undefined, "") → "LEGAL"',
    normalizeEntityType(undefined, ""), "LEGAL");

// ─── Tests: mapProductsPayload ────────────────────────────────────────────
section('mapProductsPayload');

assert('Пустой массив → []',
    mapProductsPayload([]), []);

assert('null → []',
    mapProductsPayload(null), []);

assert('undefined → []',
    mapProductsPayload(undefined), []);

{
    const result = mapProductsPayload([{ tnvedCode: "12345678", commercialName: "Тест", quantity: 5, grossWeight: 10, cost: 100, currencyCode: "EUR" }]);
    assertProduct('tnvedCode "12345678" → обрезается до "123456"', result[0], {
        guid: 'ignored',
        tnvedCode: "123456",
        commercialName: "Тест",
        quantity: "1",
        cargoSeatQuantity: "5",
        packagingPalletsInfoPackageQuantity: "5",
        grossWeight: "10",
        cost: "100",
        currencyCode: "EUR",
        packageType: "1",
        packagingPalletsInfoPackageTypeCode: "PK",
        packagingPalletsInfoPackageInfoType: "0",
        prohibitionFree: "1"
    });
}

{
    const result = mapProductsPayload([{}]);
    assertProduct('Отсутствующие поля → дефолты ("Товар", "0", "USD")', result[0], {
        guid: 'ignored',
        tnvedCode: "000000",
        commercialName: "Товар",
        quantity: "1",
        cargoSeatQuantity: "0",
        packagingPalletsInfoPackageQuantity: "0",
        grossWeight: "0",
        cost: "0",
        currencyCode: "USD",
        packageType: "1",
        packagingPalletsInfoPackageTypeCode: "PK",
        packagingPalletsInfoPackageInfoType: "0",
        prohibitionFree: "1"
    });
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
