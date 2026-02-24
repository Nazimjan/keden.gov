/**
 * Merger Service — серверный JS-мерж результатов файл-агентов.
 * Портировано из keden_extension/popup/agent-prompts.js (функция mergeAgentResultsJS).
 * Логика merge/валидации не изменена — только убран UI и браузерный код.
 */

'use strict';

/** Приоритеты источников товаров */
const PRODUCT_PRIORITY = {
    'REGISTRY': 4, 'INVOICE_EXCEL': 3, 'CMR': 2, 'TTN': 2,
    'TRANSPORT_DOC': 2, 'PACKING_LIST': 1.5, 'INVOICE': 1, 'OTHER': 0
};

const GENERIC_PRODUCT_BLACKLIST = [
    'ТОВАРЫ ПО ОПИСИ', 'CARGO AS PER', 'GOODS AS PER', 'ГРУЗ ПО ИНВОЙСУ',
    'ГРУЗ ПО ОПИСИ', 'ПОЗИЦИИ СОГЛАСНО', 'ACCORDING TO INVOICE',
    'AS PER INVENTORY', 'AS PER PACKING', 'ИТОГО', 'TOTAL', 'ВСЕГО',
    'SUBTOTAL', '货物按清单', 'SUMMARY',
];

// ─────────────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────────────

function _isGenericProduct(name) {
    const upper = String(name || '').toUpperCase().trim();
    if (!upper || upper.length < 3) return true;
    return GENERIC_PRODUCT_BLACKLIST.some(p => upper.includes(p));
}

function _normalizeProducts(products) {
    return products
        .filter(p => !_isGenericProduct(p.commercialName))
        .map(p => ({
            tnvedCode: String(p.tnvedCode || '').replace(/\D/g, '').substring(0, 6),
            commercialName: String(p.commercialName || ''),
            grossWeight: parseFloat(p.grossWeight) || 0,
            quantity: parseInt(p.quantity) || 0,
            cost: parseFloat(p.cost) || 0,
            currencyCode: String(p.currencyCode || 'USD').toUpperCase()
        }));
}

function _emptyCounteragent() {
    return { present: false, entityType: 'LEGAL', legal: { bin: '', nameRu: '' }, nonResidentLegal: { nameRu: '' }, addresses: [] };
}

function _emptyFiller() {
    return {
        present: false, role: 'FILLER_DECLARANT', iin: '', firstName: '', lastName: '', patronymic: '',
        powerOfAttorney: { docNumber: '', docDate: '', startDate: '', endDate: '', typeCode: '11004' }
    };
}

function _getCounteragentName(data) {
    if (data.entityType === 'LEGAL' && data.legal?.nameRu) return data.legal.nameRu;
    if (data.entityType === 'NON_RESIDENT_LEGAL' && data.nonResidentLegal?.nameRu) return data.nonResidentLegal.nameRu;
    return data.legal?.nameRu || data.nonResidentLegal?.nameRu || '';
}

function _roleNameRu(role) {
    return { consignor: 'Отправитель', consignee: 'Получатель', carrier: 'Перевозчик', declarant: 'Декларант' }[role] || role;
}

function _docTypeName(docType) {
    return {
        'INVOICE': 'Инвойс', 'TRANSPORT_DOC': 'CMR/ТТН', 'REGISTRY': 'Реестр',
        'PACKING_LIST': 'Упаковочный лист', 'DRIVER_ID': 'Удостоверение водителя',
        'VEHICLE_DOC': 'Техпаспорт ТС', 'VEHICLE_PERMIT': 'Допущение ТС',
        'POWER_OF_ATTORNEY': 'Доверенность', 'OTHER': 'Другой документ'
    }[docType] || docType;
}

function _levenshteinDistance(s1, s2) {
    s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) costs[j] = j;
            else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1[i - 1] !== s2[j - 1]) newValue = Math.min(newValue, lastValue, costs[j]) + 1;
                costs[j - 1] = lastValue; lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

function _calculateSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const len = longer.length;
    if (len === 0) return 1;
    return (len - _levenshteinDistance(longer, shorter)) / len;
}

function _counteragentCompleteness(data, role, docType) {
    let score = 0;
    if (data.legal?.bin) score += 3;
    if (data.legal?.nameRu || data.nonResidentLegal?.nameRu) score += 2;
    if (data.addresses?.length > 0) score += 1;
    if (data.addresses?.[0]?.fullAddress) score += 1;
    if (['consignee', 'consignor', 'carrier'].includes(role) && docType === 'TRANSPORT_DOC') score += 20;
    if (role === 'declarant' && data.representativeCertificate?.docNumber) score += 30;
    return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Кросс-валидация и слияние
// ─────────────────────────────────────────────────────────────────────────────

function _validateAndMergeCounteragent(merged, role, roleName, allMentions) {
    const names = [], bins = [];
    for (const m of allMentions) {
        const name = _getCounteragentName(m.data);
        const bin = m.data.legal?.bin || '';
        if (name) names.push({ name: name.toUpperCase().trim(), source: m.source });
        if (bin) bins.push({ bin: bin.trim(), source: m.source });
    }

    const uniqueNames = [...new Set(names.map(n => n.name))];
    if (uniqueNames.length > 1) {
        const base = uniqueNames[0];
        const hasConflict = uniqueNames.slice(1).some(n => _calculateSimilarity(base, n) < 0.8);
        if (hasConflict) {
            const details = names.map(n => `«${n.name}» в ${n.source}`).join(', ');
            merged.validation.warnings.push({ field: `${role}.name`, message: `⚠️ ${roleName} различается: ${details}`, severity: 'WARNING' });
        }
    }

    const uniqueBins = [...new Set(bins.map(b => b.bin))];
    if (uniqueBins.length > 1) {
        const details = bins.map(b => `${b.bin} в ${b.source}`).join(', ');
        merged.validation.errors.push({ field: `${role}.bin`, message: `⚠️ БИН ${roleName.toLowerCase()} различается: ${details}`, severity: 'ERROR' });
    }

    let best = null, bestScore = -1;
    for (const m of allMentions) {
        const score = _counteragentCompleteness(m.data, role, m.docType);
        if (score > bestScore) { bestScore = score; best = m.data; }
    }

    const result = {
        present: true,
        entityType: best.entityType || 'LEGAL',
        legal: best.legal || { bin: '', nameRu: '' },
        nonResidentLegal: best.nonResidentLegal || { nameRu: '' },
        addresses: best.addresses || [],
        ...(best.representativeCertificate && { representativeCertificate: best.representativeCertificate })
    };

    for (const m of allMentions) {
        if (m.data === best) continue;
        if (result.entityType === 'LEGAL' && !result.legal.bin && m.data.legal?.bin) result.legal.bin = m.data.legal.bin;
        if (result.entityType === 'LEGAL' && !result.legal.nameRu && m.data.legal?.nameRu) result.legal.nameRu = m.data.legal.nameRu;
        if (result.entityType === 'NON_RESIDENT_LEGAL' && !result.nonResidentLegal.nameRu && m.data.nonResidentLegal?.nameRu) result.nonResidentLegal.nameRu = m.data.nonResidentLegal.nameRu;
        if (!result.addresses?.length && m.data.addresses?.length) result.addresses = m.data.addresses;
        if (m.data.representativeCertificate && !result.representativeCertificate) result.representativeCertificate = m.data.representativeCertificate;
    }

    if (result.legal?.nameRu) result.legal.nameRu = result.legal.nameRu.toUpperCase();
    if (result.nonResidentLegal?.nameRu) result.nonResidentLegal.nameRu = result.nonResidentLegal.nameRu.toUpperCase();

    merged.mergedData.counteragents[role] = result;
}

function _validateAndMergeVehicles(merged, vehicleMentions) {
    if (!vehicleMentions.length) return;
    const primary = vehicleMentions.filter(m => m.docType === 'VEHICLE_DOC');
    const secondary = vehicleMentions.filter(m => m.docType !== 'VEHICLE_DOC');
    const v = merged.mergedData.vehicles;
    const upd = (pool) => {
        for (const m of pool) {
            if (!v.tractorRegNumber && m.data.tractorRegNumber) {
                v.tractorRegNumber = m.data.tractorRegNumber.toUpperCase().replace(/\s/g, '');
                v.tractorCountry = (m.data.tractorCountry || '').toUpperCase();
            }
            if (!v.trailerRegNumber && m.data.trailerRegNumber) {
                v.trailerRegNumber = m.data.trailerRegNumber.toUpperCase().replace(/\s/g, '');
                v.trailerCountry = (m.data.trailerCountry || '').toUpperCase();
            }
        }
    };
    upd(primary); upd(secondary);
}

function _validateAndMergeDriver(merged, driverMentions) {
    if (!driverMentions.length) return;
    const passportMentions = driverMentions.filter(m => m.docType === 'DRIVER_ID');
    const pool = passportMentions.length ? passportMentions : driverMentions;

    let best = pool[0].data, bestScore = 0;
    for (const m of pool) {
        let score = 0;
        if (m.data.iin) score += 3;
        if (m.data.firstName) score += 1;
        if (m.data.lastName) score += 1;
        if (score > bestScore) { bestScore = score; best = m.data; }
    }
    merged.mergedData.driver = {
        present: true,
        iin: (best.iin || '').trim(),
        lastName: (best.lastName || '').toUpperCase().trim(),
        firstName: (best.firstName || '').toUpperCase().trim()
    };
}

function _finalValidation(merged) {
    const { consignor, consignee, carrier } = merged.mergedData.counteragents;
    if (!merged.mergedData.products.length) merged.validation.warnings.push({ field: 'products', message: 'Не найдено ни одного товара', severity: 'WARNING' });
    if (consignee?.present && consignee.entityType === 'LEGAL' && consignee.legal?.bin?.length !== 12) merged.validation.warnings.push({ field: 'consignee.legal.bin', message: 'БИН получателя отсутствует или неверной длины', severity: 'WARNING' });
    if (carrier?.present && carrier.entityType === 'LEGAL' && carrier.legal?.bin?.length !== 12) merged.validation.warnings.push({ field: 'carrier.legal.bin', message: 'БИН перевозчика отсутствует или неверной длины', severity: 'WARNING' });
    if (!merged.mergedData.vehicles.tractorRegNumber) merged.validation.warnings.push({ field: 'vehicles.tractorRegNumber', message: 'Номер тягача не найден', severity: 'WARNING' });
    if (!consignor?.present) merged.validation.warnings.push({ field: 'consignor', message: 'Отправитель не найден ни в одном документе', severity: 'WARNING' });
    if (!consignee?.present) merged.validation.warnings.push({ field: 'consignee', message: 'Получатель не найден ни в одном документе', severity: 'WARNING' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Основная экспортируемая функция
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Объединяет массив результатов от файл-агентов в единый объект Keden PI.
 * @param {Array} agentResults - массив JSON-объектов от analyzeFile()
 * @returns {object} - { documents, validation, mergedData }
 */
function mergeAgentResultsJS(agentResults) {
    console.log(`[Merger] Объединяем ${agentResults.length} результатов...`);

    const merged = {
        documents: [],
        validation: { errors: [], warnings: [] },
        mergedData: {
            counteragents: { consignor: null, consignee: null, carrier: null, declarant: null, filler: _emptyFiller() },
            vehicles: { tractorRegNumber: '', tractorCountry: '', trailerRegNumber: '', trailerCountry: '' },
            countries: { departureCountry: '', destinationCountry: '' },
            products: [],
            registry: { number: '', date: '' },
            driver: { present: false, iin: '', firstName: '', lastName: '' },
            shipping: { customsCode: '', destCustomsCode: '', transportMode: '' }
        }
    };

    const mentions = { consignor: [], consignee: [], carrier: [], declarant: [], vehicles: [], driver: [], countries: [], productCandidates: [], docTotals: [], shipping: [] };

    for (const result of agentResults) {
        if (!result || result.error) continue;
        const docType = result.document?.type || (result.documents && result.documents[0]?.type) || 'OTHER';
        const fileName = result.filename || 'Неизвестный файл';
        const sourceLabel = `${_docTypeName(docType)} (${fileName})`;

        // Документы
        if (result.documents?.length) {
            result.documents.forEach(doc => merged.documents.push({ filename: doc.filename || fileName, type: doc.type || 'OTHER', number: doc.number || '', date: doc.date || '' }));
        } else if (result.document?.type) {
            merged.documents.push({ filename: fileName, type: docType, number: result.document.number || '', date: result.document.date || '' });
        }

        // Контрагенты
        ['consignor', 'consignee', 'carrier', 'declarant'].forEach(role => {
            if (result[role]?.present) mentions[role].push({ source: sourceLabel, docType, data: result[role] });
        });

        // Транспорт и водитель
        if (result.vehicles && (result.vehicles.tractorRegNumber || result.vehicles.trailerRegNumber))
            mentions.vehicles.push({ source: sourceLabel, docType, data: result.vehicles });
        if (result.driver?.present)
            mentions.driver.push({ source: sourceLabel, docType, data: result.driver });

        // Итоги документа
        const tw = parseFloat(result.totalWeight || 0);
        const tp = parseInt(result.totalPackages || 0);
        const tc = parseFloat(result.totalCost || 0);
        if (tw > 0 || tp > 0 || tc > 0)
            mentions.docTotals.push({ source: sourceLabel, type: docType, weight: tw, packages: tp, cost: tc });

        // Товары
        if (result.products?.length > 0) {
            let actualDocType = docType;
            if (docType === 'INVOICE' && fileName.toLowerCase().endsWith('.xlsx')) actualDocType = 'INVOICE_EXCEL';
            const priority = PRODUCT_PRIORITY[actualDocType] || 0;
            const normalized = _normalizeProducts(result.products);
            if (normalized.length > 0 && priority > 0)
                mentions.productCandidates.push({ source: sourceLabel, docType: actualDocType, priority, products: normalized });
        }

        // Реестр
        if (result.registry?.number)
            merged.mergedData.registry = { number: result.registry.number, date: result.registry.date || '' };

        // Страны
        if (result.countries) mentions.countries.push({ source: sourceLabel, data: result.countries });

        // Доставка / Таможня
        if (result.shipping) mentions.shipping.push({ source: sourceLabel, data: result.shipping });
    }

    // Страны
    if (mentions.countries.length) {
        const best = mentions.countries.find(m => m.source.includes('CMR')) || mentions.countries[0];
        merged.mergedData.countries.departureCountry = (best.data.departureCountry || '').toUpperCase();
        merged.mergedData.countries.destinationCountry = (best.data.destinationCountry || '').toUpperCase();
    }

    // Доставка / Таможня
    if (mentions.shipping.length) {
        // Приоритет CMR для таможенных кодов
        const best = mentions.shipping.find(m => m.source.toLowerCase().includes('cmr')) || mentions.shipping[0];
        if (best.data.customsCode) merged.mergedData.shipping.customsCode = best.data.customsCode;
        if (best.data.destCustomsCode) merged.mergedData.shipping.destCustomsCode = best.data.destCustomsCode;
        if (best.data.transportMode) merged.mergedData.shipping.transportMode = best.data.transportMode;
    }

    // Товары — лучший источник
    if (mentions.productCandidates.length) {
        mentions.productCandidates.sort((a, b) => b.priority !== a.priority ? b.priority - a.priority : b.products.length - a.products.length);
        const best = mentions.productCandidates[0];
        merged.mergedData.products = best.products;
        for (let i = 1; i < mentions.productCandidates.length; i++) {
            if (mentions.productCandidates[i].priority === best.priority && best.priority > 0)
                merged.mergedData.products.push(...mentions.productCandidates[i].products);
        }
    }

    // Контрагенты
    for (const role of ['consignor', 'consignee', 'carrier', 'declarant']) {
        if (!mentions[role].length) { merged.mergedData.counteragents[role] = _emptyCounteragent(); continue; }
        _validateAndMergeCounteragent(merged, role, _roleNameRu(role), mentions[role]);
    }

    _validateAndMergeVehicles(merged, mentions.vehicles);
    _validateAndMergeDriver(merged, mentions.driver);
    _finalValidation(merged);

    console.log(`[Merger] Завершено: ${merged.documents.length} docs, ${merged.mergedData.products.length} товаров, ${merged.validation.errors.length} ошибок`);
    return merged;
}

module.exports = { mergeAgentResultsJS };
