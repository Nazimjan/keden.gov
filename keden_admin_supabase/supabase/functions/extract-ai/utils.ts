/**
 * Вспомогательные функции для мержа и семантической проверки данных
 */

/** Считает семантическую схожесть через эмбеддинги (требует GOOGLE_AI_KEY) */
export async function calculateSemanticSimilarity(s1: string, s2: string, apiKey: string): Promise<number> {
    if (!s1 || !s2) return 0;
    
    const t1 = s1.trim();
    const t2 = s2.trim();
    if (t1.toUpperCase() === t2.toUpperCase()) return 1.0;

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

        const [v1, v2] = await Promise.all([embed(t1), embed(t2)]);
        
        // Косинусное сходство
        let dotProduct = 0;
        let mag1 = 0;
        let mag2 = 0;
        for (let i = 0; i < v1.length; i++) {
            dotProduct += v1[i] * v2[i];
            mag1 += v1[i] * v1[i];
            mag2 += v2[i] * v2[i];
        }
        const similarity = dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
        console.log(`[Similarity] "${t1}" vs "${t2}" = ${similarity.toFixed(4)}`);
        return similarity;
    } catch (e) {
        console.error("Semantic similarity failed:", e);
        return 0;
    }
}

