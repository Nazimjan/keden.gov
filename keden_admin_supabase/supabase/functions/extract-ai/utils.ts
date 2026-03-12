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
        "PRIVATE", "PUBLIC", "INTERNATIONAL", "TRADING", "TRADE", "GROUP",
    ];

    // NOTE: \b does not work with Cyrillic characters in JS (only matches ASCII word chars).
    // Use space/punctuation/string-boundary anchors instead.
    legalForms.forEach((form) => {
        const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?:^|[\\s,./\\-])${escaped}(?=[\\s,./\\-]|$)`, "g");
        n = n.replace(regex, " ");
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
/** Считает семантическую схожесть через эмбеддинги (требует GOOGLE_AI_KEY) */
export async function calculateSemanticSimilarity(s1: string, s2: string, apiKey: string): Promise<number> {
    if (!s1 || !s2) return 0;
    if (s1.toUpperCase() === s2.toUpperCase()) return 1.0;

    try {
        const embed = async (text: string) => {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: { parts: [{ text }] }
                })
            });
            if (!res.ok) throw new Error(`Embedding error: ${res.status}`);
            const data = await res.json();
            return data.embedding.values;
        };

        const [v1, v2] = await Promise.all([embed(s1), embed(s2)]);
        
        // Косинусное сходство
        let dotProduct = 0;
        let mag1 = 0;
        let mag2 = 0;
        for (let i = 0; i < v1.length; i++) {
            dotProduct += v1[i] * v2[i];
            mag1 += v1[i] * v1[i];
            mag2 += v2[i] * v2[i];
        }
        return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
    } catch (e) {
        console.warn("Semantic similarity failed, falling back to Levenshtein:", e);
        return calculateSimilarity(s1, s2);
    }
}
