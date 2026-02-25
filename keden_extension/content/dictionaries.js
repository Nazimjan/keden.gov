/**
 * KEDEN PI - Dynamic Dictionaries & Caching
 * ==========================================
 * Handles country lists with local caching (24h) and fallbacks.
 */

const COUNTRY_CACHE_KEY = 'keden_countries_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const FALLBACK_COUNTRIES = [
    { "id": 1, "numericCode": "004", "letterCodeShort": "AF", "shortNameRu": "АФГАНИСТАН" },
    { "id": 44, "numericCode": "156", "letterCodeShort": "CN", "shortNameRu": "КИТАЙ" },
    { "id": 113, "numericCode": "398", "letterCodeShort": "KZ", "shortNameRu": "КАЗАХСТАН" },
    { "id": 185, "numericCode": "643", "letterCodeShort": "RU", "shortNameRu": "РОССИЙСКАЯ ФЕДЕРАЦИЯ" },
    { "id": 117, "numericCode": "417", "letterCodeShort": "KG", "shortNameRu": "КИРГИЗИЯ" },
    { "id": 234, "numericCode": "860", "letterCodeShort": "UZ", "shortNameRu": "УЗБЕКИСТАН" },
    { "id": 224, "numericCode": "792", "letterCodeShort": "TR", "shortNameRu": "ТУРЦИЯ" },
    { "id": 16, "numericCode": "051", "letterCodeShort": "AM", "shortNameRu": "АРМЕНИЯ" },
    { "id": 81, "numericCode": "268", "letterCodeShort": "GE", "shortNameRu": "ГРУЗИЯ" },
    { "id": 219, "numericCode": "762", "letterCodeShort": "TJ", "shortNameRu": "ТАДЖИКИСТАН" },
    { "id": 228, "numericCode": "795", "letterCodeShort": "TM", "shortNameRu": "ТУРКМЕНИЯ" },
    { "id": 231, "numericCode": "804", "letterCodeShort": "UA", "shortNameRu": "УКРАИНА" },
    { "id": 34, "numericCode": "112", "letterCodeShort": "BY", "shortNameRu": "БЕЛАРУСЬ" },
    { "id": 32, "numericCode": "070", "letterCodeShort": "BA", "shortNameRu": "БОСНИЯ И ГЕРЦЕГОВИНА" },
    { "id": 33, "numericCode": "072", "letterCodeShort": "BW", "shortNameRu": "БОТСВАНА" },
    { "id": 37, "numericCode": "076", "letterCodeShort": "BR", "shortNameRu": "БРАЗИЛИЯ" },
    { "id": 42, "numericCode": "124", "letterCodeShort": "CA", "shortNameRu": "КАНАДА" },
    { "id": 48, "numericCode": "152", "letterCodeShort": "CL", "shortNameRu": "ЧИЛИ" },
    { "id": 61, "numericCode": "203", "letterCodeShort": "CZ", "shortNameRu": "ЧЕХИЯ" },
    { "id": 66, "numericCode": "208", "letterCodeShort": "DK", "shortNameRu": "ДАНИЯ" },
    { "id": 71, "numericCode": "818", "letterCodeShort": "EG", "shortNameRu": "ЕГИПЕТ" },
    { "id": 75, "numericCode": "233", "letterCodeShort": "EE", "shortNameRu": "ЭСТОНИЯ" },
    { "id": 78, "numericCode": "246", "letterCodeShort": "FI", "shortNameRu": "ФИНЛЯНДИЯ" },
    { "id": 79, "numericCode": "250", "letterCodeShort": "FR", "shortNameRu": "ФРАНЦИЯ" },
    { "id": 83, "numericCode": "276", "letterCodeShort": "DE", "shortNameRu": "ГЕРМАНИЯ" },
    { "id": 86, "numericCode": "300", "letterCodeShort": "GR", "shortNameRu": "ГРЕЦИЯ" },
    { "id": 96, "numericCode": "344", "letterCodeShort": "HK", "shortNameRu": "ГОНКОНГ" },
    { "id": 97, "numericCode": "348", "letterCodeShort": "HU", "shortNameRu": "ВЕНГРИЯ" },
    { "id": 99, "numericCode": "356", "letterCodeShort": "IN", "shortNameRu": "ИНДИЯ" },
    { "id": 100, "numericCode": "360", "letterCodeShort": "ID", "shortNameRu": "ИНДОНЕЗИЯ" },
    { "id": 101, "numericCode": "364", "letterCodeShort": "IR", "shortNameRu": "ИРАН" },
    { "id": 102, "numericCode": "368", "letterCodeShort": "IQ", "shortNameRu": "ИРАК" },
    { "id": 105, "numericCode": "380", "letterCodeShort": "IT", "shortNameRu": "ИТАЛИЯ" },
    { "id": 107, "numericCode": "392", "letterCodeShort": "JP", "shortNameRu": "ЯПОНИЯ" },
    { "id": 114, "numericCode": "404", "letterCodeShort": "KE", "shortNameRu": "КЕНИЯ" },
    { "id": 118, "numericCode": "410", "letterCodeShort": "KR", "shortNameRu": "КОРЕЯ, РЕСПУБЛИКА" },
    { "id": 126, "numericCode": "428", "letterCodeShort": "LV", "shortNameRu": "ЛАТВИЯ" },
    { "id": 132, "numericCode": "440", "letterCodeShort": "LT", "shortNameRu": "ЛИТВА" },
    { "id": 133, "numericCode": "442", "letterCodeShort": "LU", "shortNameRu": "ЛЮКСЕМБУРГ" },
    { "id": 139, "numericCode": "458", "letterCodeShort": "MY", "shortNameRu": "МАЛАЙЗИЯ" },
    { "id": 147, "numericCode": "484", "letterCodeShort": "MX", "shortNameRu": "МЕКСИКА" },
    { "id": 150, "numericCode": "498", "letterCodeShort": "MD", "shortNameRu": "МОЛДОВА, РЕСПУБЛИКА" },
    { "id": 159, "numericCode": "528", "letterCodeShort": "NL", "shortNameRu": "НИДЕРЛАНДЫ" },
    { "id": 162, "numericCode": "554", "letterCodeShort": "NZ", "shortNameRu": "НОВАЯ ЗЕЛАНДИЯ" },
    { "id": 168, "numericCode": "578", "letterCodeShort": "NO", "shortNameRu": "НОРВЕГИЯ" },
    { "id": 172, "numericCode": "586", "letterCodeShort": "PK", "shortNameRu": "ПАКИСТАН" },
    { "id": 181, "numericCode": "616", "letterCodeShort": "PL", "shortNameRu": "ПОЛЬША" },
    { "id": 182, "numericCode": "620", "letterCodeShort": "PT", "shortNameRu": "ПОРТУГАЛИЯ" },
    { "id": 186, "numericCode": "642", "letterCodeShort": "RO", "shortNameRu": "РУМЫНИЯ" },
    { "id": 196, "numericCode": "682", "letterCodeShort": "SA", "shortNameRu": "САУДОВСКАЯ АРАВИЯ" },
    { "id": 201, "numericCode": "702", "letterCodeShort": "SG", "shortNameRu": "СИНГАПУР" },
    { "id": 202, "numericCode": "703", "letterCodeShort": "SK", "shortNameRu": "СЛОВАКИЯ" },
    { "id": 208, "numericCode": "724", "letterCodeShort": "ES", "shortNameRu": "ИСПАНИЯ" },
    { "id": 213, "numericCode": "752", "letterCodeShort": "SE", "shortNameRu": "ШВЕЦИЯ" },
    { "id": 214, "numericCode": "756", "letterCodeShort": "CH", "shortNameRu": "ШВЕЙЦАРИЯ" },
    { "id": 221, "numericCode": "764", "letterCodeShort": "TH", "shortNameRu": "ТАИЛАНД" },
    { "id": 226, "numericCode": "784", "letterCodeShort": "AE", "shortNameRu": "ОБЪЕДИНЕННЫЕ АРАБСКИЕ ЭМИРАТЫ" },
    { "id": 227, "numericCode": "826", "letterCodeShort": "GB", "shortNameRu": "СОЕДИНЕННОЕ КОРОЛЕВСТВО" },
    { "id": 235, "numericCode": "840", "letterCodeShort": "US", "shortNameRu": "СОЕДИНЕННЫЕ ШТАТЫ" }
];

let globalCountries = [];

/**
 * Loads countries from API or Cache.
 * @param {object} headers - Auth headers for API call
 */
async function getCountries(headers) {
    // 1. Check Memory
    if (globalCountries.length > 0) return globalCountries;

    // 2. Check LocalStorage Cache
    const cached = localStorage.getItem(COUNTRY_CACHE_KEY);
    if (cached) {
        try {
            const { timestamp, data } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL && data && data.length > 0) {
                console.log("[Dictionaries] Loaded countries from cache");
                globalCountries = data;
                return globalCountries;
            }
        } catch (e) {
            console.warn("[Dictionaries] Cache parse error, clearing...");
            localStorage.removeItem(COUNTRY_CACHE_KEY);
        }
    }

    // 3. Fetch from API (via proxy or direct)
    console.log("[Dictionaries] Fetching countries from Keden API...");
    try {
        const results = await window.fetchCountries(headers); // Calls api.js function
        if (results && results.length > 0) {
            globalCountries = results;
            localStorage.setItem(COUNTRY_CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: globalCountries
            }));
            return globalCountries;
        }
    } catch (e) {
        console.error("[Dictionaries] API fetch failed:", e);
    }

    // 4. Fallback
    console.warn("[Dictionaries] Using fallback country list");
    globalCountries = FALLBACK_COUNTRIES;
    return globalCountries;
}

/**
 * Find country by 2-letter ISO code (CN, US, KZ...)
 */
function findCountryByCode(code) {
    if (!code) return null;
    const upperCode = code.toUpperCase();

    // Check main list
    let country = globalCountries.find(c => c.letterCodeShort === upperCode);
    if (country) return country;

    // Last resort: search in fallback list specifically
    country = FALLBACK_COUNTRIES.find(c => c.letterCodeShort === upperCode);
    return country || null;
}

// Attach to window for global access
window.getCountries = getCountries;
window.findCountryByCode = findCountryByCode;
window.getFallbackCountries = () => FALLBACK_COUNTRIES;
