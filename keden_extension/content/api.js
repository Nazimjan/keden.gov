const API_HOST = window.location.origin;
const PI_API = `${API_HOST}/api/v1/pideclaration`;
const COUNTERAGENT_API = `${PI_API}/counteragent`;

/**
 * Tries a sequence of API endpoints, returning the first successful result.
 * @param {Array<{url: string, headers: object, transform: function, label: string, rawText?: boolean}>} attempts
 * @param {string} logPrefix
 * @returns {Promise<any|null>}
 */
async function tryFallbackSearch(attempts, logPrefix) {
    for (const { url, headers, transform, label, rawText } of attempts) {
        try {
            console.log(`[API] ${logPrefix}: trying ${label}`);
            const resp = await fetch(url, { headers });
            if (!resp.ok) continue;
            if (rawText) {
                const text = await resp.text();
                if (!text || !text.trim()) continue;
                const result = transform(JSON.parse(text));
                if (result) return result;
            } else {
                const data = await resp.json();
                const result = transform(data);
                if (result) return result;
            }
        } catch (e) {
            console.error(`[API] ${logPrefix}: ${label} failed:`, e);
        }
    }
    return null;
}

// Прокси для запросов из Popup (чтобы использовать авторизацию страницы)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'proxy_tnved') {
        const token = getKedenToken();

        fetch(`https://keden.kgd.gov.kz/api/v1/cnfea/cnfea?cnfeaCode=${request.code}&page=0&pageSize=5`, {
            headers: {
                'Authorization': token ? (token.startsWith('Bearer') ? token : `Bearer ${token}`) : '',
                'Accept': 'application/json'
            }
        })
            .then(async r => {
                const text = await r.text();
                if (!r.ok) throw new Error(`API Error ${r.status}: ${text}`);
                return JSON.parse(text);
            })
            .then(data => sendResponse({ success: true, data }))
            .catch(err => {
                console.error("[Keden Extension] TNVED Proxy Error:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }
});

async function fetchTaxpayerInfo(bin, headers, type = 'app-legal') {
    try {
        const resp = await fetch(`${API_HOST}/api/v1/auth/integration/${type}/${bin}`, { headers });
        if (resp.ok) return await resp.json();
    } catch (e) {
        console.error(`Failed to fetch info for ${bin}:`, e);
    }
    return null;
}

/**
 * Fetches company info from pk.uchet.kz by BIN/IIN
 */
async function fetchUchetKzInfo(bin) {
    if (!bin || bin.length !== 12) return null;
    const url = 'https://pk.uchet.kz/api/web/company/search/';
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ page: "1", size: 10, value: bin })
        });
        if (response.ok) {
            const data = await response.json();
            if (data.results && data.results.length > 0) {
                return data.results[0]; // { name, address, bin, ... }
            }
        }
    } catch (error) {
        console.error('Uchet.kz fetch error:', error);
    }
    return null;
}


async function getPIDeclaration(id, headers) {
    const resp = await fetch(`${PI_API}/pi-declaration/${id}`, { headers });
    if (!resp.ok) throw new Error("Не удалось получить данные ПИ");
    const text = await resp.text();
    if (!text || text.trim() === "") return null;
    return JSON.parse(text);
}

async function sendCounteragent(payload, headers) {
    const resp = await fetch(COUNTERAGENT_API, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const errorText = await resp.text();
        console.error("Counteragent request failed:", errorText);
        throw new Error(`Ошибка при отправке контрагента: ${errorText}`);
    }

    const text = await resp.text();
    if (!text || text.trim() === "") return {};
    return JSON.parse(text);
}

async function updatePIDeclaration(id, payload, headers) {
    const resp = await fetch(`${PI_API}/pi-declaration/${id}`, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error("PI Update failed:", err);
        throw new Error("Не удалось обновить ПИ: " + err);
    }
    const text = await resp.text();
    if (!text || text.trim() === "") return {};
    return JSON.parse(text);
}

async function importProducts(consignmentId, payload, headers) {
    const url = `${PI_API}/product/import-via-form?consignmentId=${consignmentId}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error("Product Import failed:", err);
        throw new Error("Не удалось импортировать товары: " + err);
    }

    const text = await resp.text();
    if (!text || text.trim() === "") return [];

    try {
        return JSON.parse(text);
    } catch (e) {
        console.warn("Product Import returned invalid JSON:", text);
        return [];
    }
}

async function postRepresentative(payload, headers) {
    const resp = await fetch(`${PI_API}/representative`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error("Representative Update failed:", err);
        throw new Error("Не удалось добавить представителя (водителя): " + err);
    }
    const text = await resp.text();
    if (!text || text.trim() === "") return {};
    return JSON.parse(text);
}

async function uploadFile(file, headers) {
    const formData = new FormData();
    formData.append('files', file);

    // IMPORTANT: Remove Content-Type so the browser sets it automatically with the correct boundary
    const uploadHeaders = { ...headers };
    delete uploadHeaders['Content-Type'];

    const resp = await fetch(`${PI_API}/fs`, {
        method: 'POST',
        headers: uploadHeaders,
        body: formData
    });

    if (!resp.ok) {
        const errorText = await resp.text();
        console.error("File upload failed:", errorText);
        throw new Error(`Ошибка загрузки файла: ${errorText}`);
    }

    const text = await resp.text();
    if (!text || text.trim() === "") return {};
    return JSON.parse(text);
}

async function fetchDocumentTypes(headers) {
    const url = `${API_HOST}/api/v1/handbook/entries/search/documents_and_information_types_classifier?onlyChild=true&pageSize=1000`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
        console.error("Failed to fetch document types");
        return [];
    }
    const text = await resp.text();
    if (!text || text.trim() === "") return [];
    return JSON.parse(text);
}

async function fetchCountries(headers) {
    const url = `${API_HOST}/api/v1/handbook/entries/search/countries?pageSize=300`;
    try {
        const resp = await fetch(url, { headers });
        if (resp.ok) {
            const data = await resp.json();
            return data.results || data || [];
        }
    } catch (e) {
        console.error("Failed to fetch countries:", e);
    }
    return [];
}

async function fetchCustomsByCode(code, headers) {
    const matchCode = (e) => e.code === code || e.fullCode === code;

    const result = await tryFallbackSearch([
        {
            url: `${API_HOST}/api/v1/auth/customs/by-code/${code}`,
            headers, rawText: true,
            transform: (data) => data,
            label: `by-code/${code}`
        },
        {
            url: `${API_HOST}/api/v1/handbook/customs-post?kzOnly=true`,
            headers,
            transform: (entries) => entries.find(e => matchCode(e) || e.fullCode === `398${code}`) || null,
            label: 'customs-post handbook'
        },
        ...['customs_post_classifier', 'customs_classifier'].map(c => ({
            url: `${API_HOST}/api/v1/handbook/entries/search/${c}?query=${code}&pageSize=100`,
            headers,
            transform: (entries) => entries.find(matchCode) || null,
            label: c
        }))
    ], `Customs ${code}`);

    if (!result) console.warn(`[API] Customs not found for code: ${code}`);
    return result;
}

async function fetchTransportModeByCode(code, headers) {
    const attempts = [
        'transport_and_goods_transportation_types_classifier',
        'pi_vehicle_type_classifier'
    ].map(c => ({
        url: `${API_HOST}/api/v1/handbook/entries/search/${c}?pageSize=1000`,
        headers,
        transform: (entries) => entries.find(e => e.code === code) || null,
        label: c
    }));

    const result = await tryFallbackSearch(attempts, `Transport ${code}`);
    if (!result) console.warn(`[API] Transport mode not found for code: ${code}`);
    return result;
}

async function postDocument(consignmentId, payload, headers) {
    const url = `${PI_API}/documents/consignment/${consignmentId}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const errorText = await resp.text();
        console.error("Document post failed:", errorText);
        throw new Error(`Ошибка добавления документа: ${errorText}`);
    }

    const text = await resp.text();
    if (!text || text.trim() === "") return {};
    return JSON.parse(text);
}

async function postPreliminaryDocument(declarationId, payload, headers) {
    const url = `${PI_API}/documents/preliminary/${declarationId}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const errorText = await resp.text();
        console.error("Preliminary document post failed:", errorText);
        throw new Error(`Ошибка добавления документа декларации: ${errorText}`);
    }

    const text = await resp.text();
    if (!text || text.trim() === "") return {};
    return JSON.parse(text);
}

async function updateCounteragent(agentId, payload, headers) {
    const resp = await fetch(`${COUNTERAGENT_API}/${agentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const errorText = await resp.text();
        console.error("Counteragent update failed:", errorText);
        throw new Error(`Ошибка при обновлении контрагента: ${errorText}`);
    }

    const text = await resp.text();
    if (!text || text.trim() === "") return {};
    return JSON.parse(text);
}

async function postDocumentMapping(documentId, productIds, headers) {
    const url = `${PI_API}/documents/${documentId}/consignment/mappings`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
            ...headers,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(productIds)
    });

    if (!resp.ok) {
        const errorText = await resp.text();
        console.error("Mapping failed:", errorText);
        throw new Error(`Ошибка привязки документа: ${errorText}`);
    }
    return true;
}

async function getProducts(consignmentId, headers) {
    const url = `${PI_API}/product?consignmentId=${consignmentId}&pageSize=1000`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.results || [];
}



async function updateCustomsIdentification(declId, headers) {
    // 1. Сначала пробуем получить текущий ID записи идентификации (если она есть)
    const getUrl = `${PI_API}/customs-identification/preliminary/${declId}`;
    let existingId = null;
    try {
        const resp = await fetch(getUrl, { headers });
        if (resp.ok) {
            const data = await resp.json();
            existingId = data.id;
        }
    } catch (e) {
        console.log("ℹ️ No existing identification record found");
    }

    // 2. Отправляем обновление с флагом "Без пломбы"
    const url = `${PI_API}/customs-identification/preliminary/${declId}`;
    const payload = {
        id: existingId,
        targetId: declId,
        identificationMeans: [],
        withoutIdentification: true
    };

    const method = existingId ? 'PUT' : 'POST';
    const resp = await fetch(url, {
        method: method,
        headers,
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error("Customs Identification update failed:", err);
    } else {
        console.log("✅ Customs Identification set to 'Without Seal'");
    }
}

/**
 * Updates the Destination Customs Office (Таможня назначения)
 */
async function updateDestinationCustomsOffice(declId, customsCode, headers) {
    if (!customsCode) return;

    // 1. Получаем детали таможенного поста по коду
    const customsPost = await fetchCustomsByCode(customsCode, headers);
    if (!customsPost) {
        console.warn(`[API] Destination customs post not found for code: ${customsCode}`);
        return;
    }

    // 2. Проверяем наличие существующей записи
    const getUrl = `${PI_API}/destination-custom-office?targetType=PRELIMINARY&targetId=${declId}`;
    let existingRecord = null;
    try {
        const getResp = await fetch(getUrl, { headers });
        if (getResp.ok) {
            const list = await getResp.json();
            if (Array.isArray(list) && list.length > 0) {
                existingRecord = list[0];
            } else if (list && !Array.isArray(list) && list.id) {
                existingRecord = list;
            }
        }
    } catch (e) {
        console.log("ℹ️ Error checking existing destination customs record:", e);
    }

    // 3. Подготавливаем payload
    const payload = {
        id: existingRecord ? existingRecord.id : null,
        targetType: "PRELIMINARY",
        targetId: declId,
        customsPost: customsPost,
        customsControlZone: null,
        railwayStation: null,
        address: null,
        document: null,
        destinationAeo: false,
        indexOrder: null
    };

    const method = existingRecord ? 'PUT' : 'POST';
    const url = `${PI_API}/destination-custom-office`;

    const resp = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error("Destination Customs Update failed:", err);
    } else {
        console.log(`✅ Destination Customs Office updated (${method})`);
    }
}

async function getCounteragents(targetId, targetType, type, headers) {
    const url = `${PI_API}/counteragent?targetId=${targetId}&targetType=${targetType}&type=${type}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return [];
    return await resp.json();
}

async function copyCounteragent(sourceId, targetId, targetType, toType, headers) {
    const url = `${PI_API}/counteragent/${sourceId}/copy?targetId=${targetId}&targetType=${targetType}&toType=${toType}&carrierEqualIndicator=true`;
    console.log(`👤 DEBUG: Copying counteragent: ${url}`);

    const resp = await fetch(url, {
        method: 'PATCH',
        headers
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error("Counteragent Copy failed:", err);
        throw new Error("Не удалось скопировать перевозчика: " + err);
    }
    return true;
}
async function getCounteragent(id, headers) {
    const url = `${PI_API}/counteragent/${id}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    return await resp.json();
}
