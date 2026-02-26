/**
 * Вспомогательные функции для мержа и нормализации данных
 */

/** Нормализует имя компании (удаляет LTD, ТОО, пунктуацию) для точного сравнения */
export function normalizeName(name: string): string {
    if (!name) return "";
    let n = String(name).toUpperCase();

    // 1. Удаляем общие правовые формы
    const legalForms = [
        "LTD", "LIMITED", "LLC", "INC", "CORP", "CO", "COMPANY", "GMBH", "SARL",
        "ТОО", "АО", "ООО", "ИП", "ПК", "ГКП", "РГП", "КХ", "ФИЛИАЛ",
        "PRIVATE", "PUBLIC", "INTERNATIONAL", "TRADING", "GROUP",
    ];

    legalForms.forEach((form) => {
        const regex = new RegExp(`\\b${form}\\b`, "g");
        n = n.replace(regex, "");
    });

    // 2. Оставляем только буквы и цифры
    n = n.replace(/[^A-Z0-9А-Я]/g, "");

    return n.trim();
}

/** Считает коэффициент схожести строк (0..1) по Левенштейну */
export function calculateSimilarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longerLength - editDistance) / longerLength;
}

function levenshteinDistance(s1: string, s2: string): number {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}
