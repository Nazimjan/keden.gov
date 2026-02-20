/**
 * BIN/IIN Verification Service using pk.uchet.kz
 */

/**
 * Fetches company info from pk.uchet.kz by BIN/IIN
 * @param {string} bin - 12-digit BIN or IIN
 * @returns {Promise<{name: string, address: string, bin: string}|null>}
 */
async function fetchUchetKzInfo(bin) {
    // Sanitize BIN: keep only digits
    const cleanBin = (bin || '').replace(/\D/g, '');
    if (cleanBin.length !== 12) {
        console.log(`⚠️ BIN ${bin} is invalid (must be 12 digits)`);
        return null;
    }

    const url = 'https://pk.uchet.kz/api/web/company/search/';

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                page: "1",
                size: 10,
                value: cleanBin
            })
        });

        if (!response.ok) {
            console.error('Uchet.kz API error:', response.status);
            return null;
        }

        const data = await response.json();
        if (data.results && data.results.length > 0) {
            const result = data.results[0];
            return {
                name: result.name || '',
                address: result.address || '',
                bin: result.bin || cleanBin
            };
        }
    } catch (error) {
        console.error('Uchet.kz fetch error:', error);
    }
    return null;
}

/**
 * Parses the complex address string from uchet.kz into Keden structure
 */
function parseUchetAddress(addrStr) {
    if (!addrStr) return null;

    const parts = addrStr.split(',').map(p => p.trim());
    const res = {
        countryCode: 'KZ',
        region: '',
        city: '',
        district: '',
        street: '',
        house: '',
        postalCode: ''
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

    if (!res.street && parts.length > 4) {
        const candidate = parts.find(p => !p.includes('область') && !p.includes('город') && !p.includes('Казахстан') && !p.includes('индекс'));
        if (candidate) res.street = candidate;
    }

    return res;
}

/**
 * Automatically enriches counteragent fields in the UI
 * @param {string} bin - BIN to check
 * @param {string} type - 'consignee', 'carrier', or 'declarant'
 */
async function enrichFieldByBIN(bin, type) {
    const cleanBin = (bin || '').replace(/\D/g, '');
    const binInput = document.getElementById(`prev-agent-bin-${type}`);

    if (cleanBin.length !== 12) {
        if (binInput && cleanBin.length > 0) {
            binInput.style.borderColor = '#ef4444'; // Red for wrong length
            binInput.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        }
        return;
    }

    console.log(`🔍 Проверка БИН ${cleanBin} на uchet.kz...`);
    const info = await fetchUchetKzInfo(cleanBin);

    if (info && info.name) {
        console.log(`✅ Найдено для ${cleanBin}: ${info.name}`);

        // 1. Обновляем UI (Успех)
        const nameInput = document.getElementById(`prev-agent-name-${type}`);
        const addressInput = document.getElementById(`prev-agent-address-${type}`);

        if (binInput) {
            binInput.style.borderColor = '#10b981'; // Green
            binInput.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        }

        if (nameInput) {
            nameInput.value = info.name;
            nameInput.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            setTimeout(() => {
                if (nameInput) nameInput.style.backgroundColor = '';
                if (binInput) {
                    binInput.style.backgroundColor = '';
                    binInput.style.borderColor = '';
                }
            }, 2000);
        }

        if (addressInput && info.address) {
            addressInput.value = info.address;
            addressInput.style.borderColor = '#10b981';
            setTimeout(() => { if (addressInput) addressInput.style.borderColor = ''; }, 2000);
        }

        // 2. Обновляем объект данных
        if (typeof currentAIData !== 'undefined' && currentAIData) {
            const counteragents = currentAIData.counteragents || (currentAIData.mergedData ? currentAIData.mergedData.counteragents : null);

            if (counteragents && counteragents[type]) {
                const agent = counteragents[type];
                agent.legal = agent.legal || { bin: cleanBin, nameRu: '' };
                agent.legal.nameRu = info.name;
                agent.legal.bin = cleanBin;

                if (info.address) {
                    const parsed = parseUchetAddress(info.address);
                    if (parsed) {
                        agent.addresses = [{
                            addressType: { id: 2014, code: "1", ru: "Адрес регистрации" },
                            fullAddress: info.address,
                            ...parsed
                        }];
                        agent.entityType = 'LEGAL';
                    }
                }
                console.log(`💾 Данные ${type} обновлены в currentAIData`);
            }
        }
    } else {
        console.log(`ℹ️ БИН ${cleanBin} не найден в базе uchet.kz`);
        // Если БИН не найден — красим в красный
        if (binInput) {
            binInput.style.borderColor = '#ef4444';
            binInput.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            binInput.title = 'БИН не найден в базе uchet.kz (проверьте правильность)';
        }
    }
}
