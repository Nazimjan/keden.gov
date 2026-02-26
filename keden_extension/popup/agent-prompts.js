/**
 * KEDEN PI - Константы и UI-помощники
 * ==========================================
 * Логика извлечения и мержа перенесена на сервер.
 */

/** Человекочитаемое название типа документа (для UI) */
function getDocTypeName(docType) {
    const map = {
        '04021': 'Инвойс',
        'INVOICE': 'Инвойс',
        '02015': 'CMR/ТТН',
        'TRANSPORT_DOC': 'CMR/ТТН',
        '09011': 'Реестр',
        'REGISTRY': 'Реестр',
        '04131': 'Упаковочный лист',
        'PACKING_LIST': 'Упаковочный лист',
        '10022': 'Паспорт/Довер/Тех',
        'DRIVER_ID': 'Паспорт водителя',
        'VEHICLE_DOC': 'Техпаспорт ТС',
        'POWER_OF_ATTORNEY': 'Доверенность',
        '09024': 'Допущение ТС',
        'VEHICLE_PERMIT': 'Допущение ТС',
        '11005': 'Договор эксп.',
        '04033': 'Договор перев.',
        'OTHER': 'Другой документ'
    };
    return map[docType] || docType;
}

/** Русское название роли контрагента (для UI) */
function getRoleNameRu(role) {
    const map = {
        consignor: 'Отправитель',
        consignee: 'Получатель',
        carrier: 'Перевозчик',
        declarant: 'Декларант'
    };
    return map[role] || role;
}

/** 
 * Устаревшая функция мержа. 
 * Теперь сервер возвращает уже подготовленные данные mergedData.
 */
function mergeAgentResultsJS(agentResults) {
    // Если результат пришел уже смерженным с сервера
    if (agentResults && agentResults.mergedData) {
        return agentResults;
    }

    // Заглушка для обратной совместимости
    if (Array.isArray(agentResults)) {
        return agentResults[0];
    }

    return agentResults;
}

// Экспортируем для совместимости, если используются другие файлы
if (typeof module !== 'undefined') {
    module.exports = { getDocTypeName, getRoleNameRu, mergeAgentResultsJS };
}
