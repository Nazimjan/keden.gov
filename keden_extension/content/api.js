const API_HOST = window.location.origin;
const PI_API = `${API_HOST}/api/v1/pideclaration`;
const COUNTERAGENT_API = `${PI_API}/counteragent`;

async function fetchTaxpayerInfo(bin, headers) {
    const isBIN = bin.length === 12;
    const endpoint = isBIN ? 'app-legal' : 'app-person';
    try {
        const resp = await fetch(`${API_HOST}/api/v1/auth/integration/${endpoint}/${bin}`, { headers });
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
