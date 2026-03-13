/**
 * Преобразует технические типы действий в человекочитаемый русский текст
 */
export const formatActionType = (type) => {
    const mapping = {
        'AUTH_CHECK': 'ВХОД / АВТОРИЗАЦИЯ',
        'AI_EXTRACT': 'ИЗВЛЕЧЕНИЕ ДАННЫХ',
        'AI_EXTRACT_PARALLEL': 'ПАКЕТНАЯ ОБРАБОТКА',
        'EXTRACT-AI': 'ИЗВЛЕЧЕНИЕ ДАННЫХ',
        'BLOCK_DOC': 'БЛОКИРОВКА ДОК.',
        'UNBLOCK_DOC': 'РАЗБЛОКИРОВКА ДОК.',
        'DELETE_DOC': 'УДАЛЕНИЕ ДОК.',
        'TOGGLE_ACCESS': 'ИЗМЕНЕНИЕ ДОСТУПА',
        'UPDATE_CREDITS': 'ПОПОЛНЕНИЕ БАЛАНСА',
        'UPDATE_EXPIRY': 'ПРОДЛЕНИЕ ПОДПИСКИ',
        'CLEAR_LOGS': 'ОЧИСТКА ЖУРНАЛА',
        'SCRAPER_FALLBACK': 'РЕЗЕРВНЫЙ СКРЕЙПЕР'
    };
    return mapping[type] || type;
};

/**
 * Преобразует технические описания логов в понятный текст
 */
export const formatDescription = (desc, type) => {
    if (!desc) return '—';

    // Обработка пакетного извлечения: "Parallel: 1 AI + 0 pre-parsed, 0 failed"
    if (type === 'AI_EXTRACT_PARALLEL' || desc.includes('Parallel:')) {
        const match = desc.match(/Parallel: (\d+) AI/);
        if (match) {
            return `Обработано документов: ${match[1]}`;
        }
    }

    // Обработка стандартных фраз
    const translations = {
        'Extension opened': 'Расширение открыто',
        'Extension initialized': 'Расширение инициализировано',
        'Document blocked': 'Документ заблокирован',
        'Document unblocked': 'Документ разблокирован',
        'Document deleted': 'Документ удален'
    };

    return translations[desc] || desc;
};
