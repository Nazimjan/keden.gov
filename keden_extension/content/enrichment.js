async function processCounteragentEnrichment(source, headers) {
    if (!source || !source.present) return;

    const bin = source.legal?.bin || source.person?.iin || source.iin;
    if (bin && bin.length === 12) {
        console.log(`🔍 [Enrichment] Fetching data for: ${bin}`);

        // Определяем тип эндпоинта: Заполнитель всегда ищется как физлицо
        const isFiller = source.role === "FILLER_DECLARANT" || source.type === "FILLER_DECLARANT";
        const isPerson = isFiller || (!source.legal && (!!source.person || !!source.iin || !!source.xin));
        const endpointType = isPerson ? 'app-person' : 'app-legal';

        // Fetch data from Keden integration API
        const kedenInfo = await fetchTaxpayerInfo(bin, headers, endpointType);

        if (kedenInfo) {
            console.log(`✅ [Enrichment] Found Keden data for ${bin}`);

            source.kedenData = kedenInfo;

            if (!isPerson && source.legal) {
                // ПРИНУДИТЕЛЬНО обновляем название из базы для юрлица
                source.legal.nameRu = kedenInfo.nameRu || kedenInfo.shortNameRu || source.legal.nameRu;
                source.legal.shortNameRu = kedenInfo.shortNameRu || source.legal.shortNameRu;
            } else if (isPerson) {
                // Fallback для совместимости с другими частями кода для физлица
                const target = source.person || source;
                target.lastName = kedenInfo.lastName || target.lastName;
                target.firstName = kedenInfo.firstName || target.firstName;
                if (kedenInfo.middleName || kedenInfo.patronymic) {
                    const middle = kedenInfo.middleName || kedenInfo.patronymic;
                    if (source.person) target.middleName = middle;
                    else target.patronymic = middle;
                }
            }

            if (kedenInfo.addresses && kedenInfo.addresses.length > 0) {
                source.addresses = kedenInfo.addresses.map(a => ({
                    addressType: a.addressType || { id: 2014, code: "1", ru: "Адрес регистрации" },
                    country: a.country || window.findCountryByCode("KZ"),
                    region: a.region,
                    city: a.city,
                    district: a.district,
                    street: a.street,
                    house: a.house,
                    apartment: a.apartment,
                    postalCode: a.postalCode
                }));
            }
        } else {
            console.warn(`⚠️ [Enrichment] No official data found in Keden for: ${bin}`);
        }
    }
}

/**
 * Simple parser for uchet.kz address string (fallback for content script)
 */
function parseUchetAddressSimple(addrStr) {
    if (!addrStr) return null;
    const parts = addrStr.split(',').map(p => p.trim());
    const res = {
        addressType: { id: 2014, code: "1", ru: "Адрес регистрации" },
        country: window.findCountryByCode("KZ")
    };

    parts.forEach(part => {
        const p = part.toLowerCase();
        if (p.includes('область')) res.region = part;
        else if (p.includes('город') || p.startsWith('г.')) res.city = part.replace(/^(город|г\.)\s*/i, '');
        else if (p.includes('округ') || p.includes('район')) res.district = part;
        else if (p.includes('улица') || p.startsWith('ул.')) res.street = part.replace(/^(улица|ул\.)\s*/i, '');
        else if (p.includes('дом') || p.startsWith('д.')) res.house = part.replace(/^(дом|д\.)\s*/i, '');
        else if (p.includes('почтовый индекс')) res.postalCode = part.replace(/почтовый индекс/i, '').trim();
    });
    return res;
}
