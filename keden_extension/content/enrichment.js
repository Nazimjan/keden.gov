async function processCounteragentEnrichment(source, headers) {
    if (!source || !source.present) return;

    const bin = source.legal?.bin || source.person?.iin;
    if (bin && bin.length === 12) {
        console.log(`🔍 [Enrichment] Fetching Keden data for: ${bin}`);
        const info = await fetchTaxpayerInfo(bin, headers);
        if (info) {
            console.log(`✅ [Enrichment] Found data for ${bin}:`, info.nameRu || info.lastName || "No Name");

            if (source.legal) {
                source.legal.nameRu = info.nameRu || info.shortNameRu || source.legal.nameRu;
            } else if (source.person) {
                source.person.lastName = info.lastName || source.person.lastName;
                source.person.firstName = info.firstName || source.person.firstName;
                source.person.middleName = info.middleName || source.person.middleName;
            }

            if (info.addresses && info.addresses.length > 0) {
                console.log(`📍 [Enrichment] Overriding addresses for ${bin}`);
                source.addresses = info.addresses.map(a => ({
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
        } else {
            console.warn(`⚠️ [Enrichment] No data found in Keden for BIN/IIN: ${bin}`);
        }
    }
}
