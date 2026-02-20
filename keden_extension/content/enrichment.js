async function processCounteragentEnrichment(source, headers) {
    if (!source || !source.present) return;

    const bin = source.legal?.bin || source.person?.iin || source.iin;
    if (bin && bin.length === 12) {
        console.log(`🔍 [Enrichment] Fetching data for: ${bin}`);

        // Parallel fetch from Keden and Uchet.kz
        const [kedenInfo, uchetInfo] = await Promise.all([
            fetchTaxpayerInfo(bin, headers),
            fetchUchetKzInfo(bin)
        ]);

        if (kedenInfo) {
            console.log(`✅ [Enrichment] Found Keden data for ${bin}`);
            if (source.legal) {
                source.legal.nameRu = kedenInfo.nameRu || kedenInfo.shortNameRu || source.legal.nameRu;
                source.legal.shortNameRu = kedenInfo.shortNameRu || null;
            } else if (source.person || source.iin) {
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
                    country: a.country || { id: 113, numericCode: "398", letterCodeShort: "KZ", shortNameRu: "КАЗАХСТАН" },
                    region: a.region,
                    city: a.city,
                    district: a.district,
                    street: a.street,
                    house: a.house,
                    apartment: a.apartment,
                    postalCode: a.postalCode
                }));
            }
        }

        // If uchet.kz has better info or Keden address is missing, use it
        if (uchetInfo && uchetInfo.address && (!source.addresses || source.addresses.length === 0)) {
            console.log(`📍 [Enrichment] Using address from uchet.kz for ${bin}`);
            const parsed = parseUchetAddressSimple(uchetInfo.address);
            if (parsed) {
                source.addresses = [parsed];
            }
            if (source.legal && !source.legal.nameRu) {
                source.legal.nameRu = uchetInfo.name;
            }
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
        country: { id: 113, numericCode: "398", letterCodeShort: "KZ", shortNameRu: "КАЗАХСТАН" }
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
