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

    return await resp.json();
}
async function getPIDeclaration(id, headers) {
    const resp = await fetch(`${PI_API}/pi-declaration/${id}`, { headers });
    if (!resp.ok) throw new Error("Не удалось получить данные ПИ");
    return await resp.json();
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
    return await resp.json();
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
    return await resp.json();
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
    return await resp.json();
}
