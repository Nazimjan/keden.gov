import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBatchPrompt, SYSTEM_PROMPT, PER_FILE_SYSTEM_PROMPT, getPerFilePrompt } from "./prompts.ts";
import { mergeAgentResults } from "./merger.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Base64 Encoding TransformStream
 */
class Base64TransformStream extends TransformStream<Uint8Array, string> {
    constructor() {
        let partial = new Uint8Array(0);
        const lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

        super({
            transform(chunk, controller) {
                const data = new Uint8Array(partial.length + chunk.length);
                data.set(partial);
                data.set(chunk, partial.length);

                const len = data.length;
                const remaining = len % 3;
                const mainLength = len - remaining;

                let output = "";
                for (let i = 0; i < mainLength; i += 3) {
                    const b1 = data[i];
                    const b2 = data[i + 1];
                    const b3 = data[i + 2];
                    output += lookup[b1 >> 2];
                    output += lookup[((b1 & 3) << 4) | (b2 >> 4)];
                    output += lookup[((b2 & 15) << 2) | (b3 >> 6)];
                    output += lookup[b3 & 63];

                    if (output.length > 8192) {
                        controller.enqueue(output);
                        output = "";
                    }
                }
                if (output) controller.enqueue(output);
                partial = data.slice(mainLength);
            },
            flush(controller) {
                if (partial.length === 1) {
                    const b1 = partial[0];
                    controller.enqueue(lookup[b1 >> 2]);
                    controller.enqueue(lookup[(b1 & 3) << 4]);
                    controller.enqueue("==");
                } else if (partial.length === 2) {
                    const b1 = partial[0];
                    const b2 = partial[1];
                    controller.enqueue(lookup[b1 >> 2]);
                    controller.enqueue(lookup[((b1 & 3) << 4) | (b2 >> 4)]);
                    controller.enqueue(lookup[(b2 & 15) << 2]);
                    controller.enqueue("=");
                }
            }
        });
    }
}

/**
 * SSE Helper to format messages
 */
const sse = (event: string, data: any) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * JSON Repair & Safe Parse
 */
function repairJSON(text: string) {
    let stack = [];
    let isInsideString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        let c = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (c === '\\') {
            escaped = true;
            continue;
        }
        if (c === '"') {
            isInsideString = !isInsideString;
            continue;
        }
        if (!isInsideString) {
            if (c === '{') stack.push('}');
            else if (c === '[') stack.push(']');
            else if (c === '}' || c === ']') {
                if (stack.length > 0 && stack[stack.length - 1] === c) {
                    stack.pop();
                }
            }
        }
    }

    let repaired = text.trim();
    if (isInsideString) repaired += '"';
    repaired = repaired.replace(/[:,\s]+$/, "");
    repaired = repaired.replace(/(?:[{,])\s*"[^"]*"?\s*$/, function (match) {
        if (match.trim().startsWith('{')) return '{';
        return '';
    });
    repaired += stack.reverse().join('');
    return repaired;
}

function safeParseJSON(text: string) {
    if (!text) throw new Error("Получен пустой ответ от AI");
    try {
        return JSON.parse(text);
    } catch {
        console.warn("⚠️ Direct JSON parse failed, attempting repair...");
        let cleaned = text.trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const candidate = cleaned.substring(firstBrace, lastBrace + 1);
            try {
                return JSON.parse(candidate);
            } catch {
                cleaned = cleaned.substring(firstBrace);
            }
        } else if (firstBrace !== -1) {
            cleaned = cleaned.substring(firstBrace);
        }

        cleaned = cleaned.replace(/\/\/.*$/gm, "");
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
        cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
        cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
        cleaned = repairJSON(cleaned);

        return JSON.parse(cleaned);
    }
}

// ─── Параллельный режим: хелперы ─────────────────────────────────────────────

/** Группирует storagePaths по originalFileName. Многостраничные PDF→несколько путей с одним именем. */
function groupFilesByName(
    storagePaths: string[],
    originalFileNames: string[],
): Map<string, { paths: string[]; originalName: string }> {
    const groups = new Map<string, { paths: string[]; originalName: string }>();
    for (let i = 0; i < storagePaths.length; i++) {
        const name = originalFileNames?.[i] || storagePaths[i];
        if (!groups.has(name)) groups.set(name, { paths: [], originalName: name });
        groups.get(name)!.paths.push(storagePaths[i]);
    }
    return groups;
}

/** Семафор: ограничивает количество одновременных вызовов. */
function createSemaphore(maxConcurrent: number) {
    let running = 0;
    const queue: (() => void)[] = [];
    return async function <T>(fn: () => Promise<T>): Promise<T> {
        if (running >= maxConcurrent) {
            await new Promise<void>((resolve) => queue.push(resolve));
        }
        running++;
        try {
            return await fn();
        } finally {
            running--;
            if (queue.length > 0) queue.shift()!();
        }
    };
}

/** Обрабатывает одну группу файлов (один логический документ) параллельным агентом. */
async function processFileGroup(
    supabase: any,
    group: { paths: string[]; originalName: string },
    models: string[],
): Promise<{ result: any | null; error: string | null }> {
    const fileContents: any[] = [];
    for (const path of group.paths) {
        try {
            const { data, error } = await supabase.storage.from("documents").download(path);
            if (error || !data) continue;
            const buffer = await data.arrayBuffer();
            if (data.type.startsWith("image/") || data.type === "application/pdf") {
                const uint8 = new Uint8Array(buffer);
                let binary = "";
                const chunk_size = 16384;
                for (let k = 0; k < uint8.length; k += chunk_size) {
                    binary += String.fromCharCode(...uint8.subarray(k, k + chunk_size));
                }
                fileContents.push({ type: "image_url", image_url: { url: `data:${data.type};base64,${btoa(binary)}` } });
            } else {
                fileContents.push({
                    type: "text",
                    text: `--- Content of ${group.originalName} ---\n${new TextDecoder().decode(buffer)}`,
                });
            }
        } catch (e) {
            console.error(`[parallel] Error downloading ${path}:`, e);
        }
    }

    if (fileContents.length === 0) {
        return { result: null, error: `Не удалось загрузить: ${group.originalName}` };
    }

    const prompt = getPerFilePrompt(group.originalName);

    for (const model of models) {
        try {
            console.log(`[parallel] ${group.originalName} → ${model}`);
            const response = await fetch(OPENROUTER_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://keden.kgd.gov.kz",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: PER_FILE_SYSTEM_PROMPT },
                        { role: "user", content: [{ type: "text", text: prompt }, ...fileContents] },
                    ],
                    max_tokens: 32768,
                    response_format: { type: "json_object" },
                }),
            });

            if (!response.ok) {
                console.warn(`[parallel] ${model} → ${response.status} ${response.statusText}`);
                continue;
            }
            const aiData = await response.json();
            let content: string = aiData.choices?.[0]?.message?.content?.trim() || "";
            if (!content) continue;
            if (content.startsWith("```")) {
                content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
            }
            const parsed = safeParseJSON(content);
            // Гарантируем что filename проставлен
            parsed.filename = group.originalName;
            if (!parsed.document && parsed.documents?.[0]) {
                parsed.document = parsed.documents[0];
            }
            return { result: parsed, error: null };
        } catch (e: any) {
            console.error(`[parallel] ${group.originalName} ${model} error:`, e.message);
        }
    }

    return { result: null, error: `Все модели не смогли обработать: ${group.originalName}` };
}

// ─── Edge Function ────────────────────────────────────────────────────────────

serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action, x-iin, x-fio, x-file-name, x-file-type",
        "Content-Type": "application/json"
    };

    if (req.method === "OPTIONS") return new Response("ok", {
        headers: corsHeaders
    });

    try {
        const url = new URL(req.url);
        const isStreamAction = req.headers.get("x-action") === "extract-stream" || req.headers.get("content-type") === "application/octet-stream";

        let iin: string | null = null;
        let fio: string = "Пользователь";
        let action: string = "extract";
        let jsonBody: any = null;

        if (isStreamAction) {
            iin = req.headers.get("x-iin");
            fio = req.headers.get("x-fio") || "Пользователь";
            action = "extract-stream";
        } else {
            jsonBody = await req.json();
            iin = jsonBody.iin;
            fio = jsonBody.fio || "Пользователь";
            action = jsonBody.action || "extract";
        }

        // Ensure fio is not just whitespace
        if (!fio || fio.trim() === "") fio = "Пользователь";

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseKey) {
            throw new Error(`System Configuration Error: Supabase environment variables are missing.`);
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Auth & Credits Check
        let { data: user, error: userError } = await supabase
            .from("users")
            .select("*")
            .eq("iin", iin)
            .single();

        if (userError) {
            // New user registration
            const { data: newUser, error: createError } = await supabase
                .from("users")
                .insert({ iin, fio, credits: 10, is_allowed: true })
                .select().single();

            if (createError) throw new Error(`Database Error: ${createError.message}`);
            user = newUser;
        } else if (user && (user.fio === "Пользователь" || !user.fio) && fio !== "Пользователь" && fio !== iin) {
            // Update user if they exist but have default name, but only if NEW fio is real
            const { data: updatedUser, error: updateError } = await supabase
                .from("users")
                .update({ fio })
                .eq("id", user.id)
                .select().single();
            if (!updateError && updatedUser) user = updatedUser;
        }

        const checkAndDeductCredits = async () => {
            if (!user.is_allowed) throw new Error("Доступ заблокирован");
            const now = new Date();
            const hasSubscription = user.subscription_end && new Date(user.subscription_end) > now;
            if (hasSubscription) return true;

            const { data: updatedUser, error: rpcError } = await supabase.rpc('deduct_credit', { user_id: user.id });
            if (rpcError || !updatedUser) throw new Error("Недостаточно кредитов");
            user = Array.isArray(updatedUser) ? updatedUser[0] : updatedUser;
            return false;
        };

        if (action === "check_access") {
            const now = new Date();
            const hasSubscription = user.subscription_end && new Date(user.subscription_end) > now;
            return new Response(JSON.stringify({
                allowed: user.is_allowed,
                fio: user.fio,
                credits: user.credits,
                hasSubscription,
                message: user.is_allowed ? "Доступ разрешен" : "Доступ заблокирован",
                block_reason: user.is_allowed ? null : (user.block_reason || null)
            }), { headers: corsHeaders });
        }

        // Diagnostic Action: get_my_logs
        if (action === "get_my_logs") {
            const { data: userLogs } = await supabase
                .from("logs")
                .select("*")
                .eq("user_iin", iin)
                .order("created_at", { ascending: false })
                .limit(50);

            return new Response(JSON.stringify({
                logs: userLogs,
                credits: user.credits,
                fio: user.fio
            }), { headers: corsHeaders });
        }

        if (action === "log" && jsonBody) {
            const { action_type, description } = jsonBody;
            await supabase.from("logs").insert({
                user_iin: iin,
                action_type: action_type || "GENERAL_LOG",
                description: description || ""
            });
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        // Action: excel-map — определяет маппинг колонок Excel по скелету таблицы.
        // Вызывается клиентом перед полной экстракцией (не списывает кредиты).
        if (action === "excel-map" && jsonBody) {
            const { skeleton, fileName } = jsonBody;
            if (!skeleton) throw new Error("Missing skeleton");

            const mappingPrompt = `Ты анализируешь структуру Excel-инвойса для таможни.
Определи индексы колонок по скелету таблицы ниже.

${skeleton}

Верни ТОЛЬКО JSON без пояснений:
{
  "columns": {
    "commercialName": <число — индекс колонки с наименованием товара (строковое описание)>,
    "tnvedCode": <число или null — колонка с кодом HS/ТНВЭД>,
    "quantity": <число — колонка с кол-вом мест (cartons/packages/colli/件数), НЕ штуки (pcs/units)>,
    "grossWeight": <число — колонка с весом брутто в кг>,
    "unitPrice": <число или null — цена за единицу (или за N единиц — см. unitPriceDivisor)>,
    "cost": <число или null — итоговая стоимость строки (Amount/Total/Сумма)>
  },
  "currency": "<USD/CNY/EUR/KZT>",
  "unitPriceDivisor": <1 если цена за 1 шт; 100 если заголовок "PRICE PER 100" или "per 100 units">,
  "skipRowPatterns": ["ИТОГО", "TOTAL"],
  "dataStartOffset": 0
}

ПРАВИЛА:
- commercialName: колонка с ТЕКСТОВЫМ описанием товара (слова, названия). НИКОГДА не выбирай колонку где только цифры — это HS-код, не название.
- tnvedCode: колонка с HS/ТНВЭД кодом (6-10 цифр). Типичные значения: 3304990000, 6104200000, 8471300000.
- quantity: ТОЛЬКО места/места (cartons/colli/packages/件数). Значения обычно целые числа. Если есть и "места" и "штуки" — бери "места".
- grossWeight: вес в кг — обычно дробные числа (84.5, 1200.0).
- cost: ИТОГОВАЯ стоимость ВСЕЙ СТРОКИ (Amount/Total), НЕ цена за единицу.
- unitPrice: цена за 1 штуку (если есть отдельная колонка). Если только unitPrice — укажи её, cost = null.
- skipRowPatterns: паттерны в commercialName которые означают итоговую строку (не товар).
- dataStartOffset: 0 если данные идут сразу после заголовка; 1 если есть строка-подзаголовок после заголовка.`;

            const mapResponse = await fetch(OPENROUTER_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://keden.kgd.gov.kz",
                },
                body: JSON.stringify({
                    model: "google/gemini-3.1-flash-lite-preview",
                    messages: [{ role: "user", content: mappingPrompt }],
                    max_tokens: 512,
                    response_format: { type: "json_object" },
                }),
            });

            if (!mapResponse.ok) throw new Error(`AI error: ${mapResponse.statusText}`);
            const mapAiData = await mapResponse.json();
            let mapContent = mapAiData.choices?.[0]?.message?.content?.trim() || "";
            if (mapContent.startsWith("```")) {
                mapContent = mapContent.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
            }
            const mapping = safeParseJSON(mapContent);
            return new Response(JSON.stringify({ mapping }), { headers: corsHeaders });
        }

        // Action: extract-stream (Single File Streaming)
        if (action === "extract-stream") {
            await checkAndDeductCredits();
            const fileName = req.headers.get("x-file-name") || "document";
            const fileType = req.headers.get("x-file-type") || "image/jpeg";
            const promptStr = getBatchPrompt([fileName]);

            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const encoder = new TextEncoder();

            (async () => {
                const pingInterval = setInterval(() => {
                    try { writer.write(encoder.encode(": keep-alive\n\n")); } catch { clearInterval(pingInterval); }
                }, 15000);

                try {
                    const bodyTemplate = {
                        model: "google/gemini-3.1-flash-lite-preview",
                        stream: true,
                        max_tokens: 8192,
                        messages: [
                            { role: "system", content: SYSTEM_PROMPT },
                            {
                                role: "user",
                                content: [
                                    { type: "text", text: promptStr },
                                    { type: "image_url", image_url: { url: `data:${fileType};base64,__BASE64_STREAM_CONTENT__` } }
                                ]
                            }
                        ]
                    };

                    const [jsonStart, jsonEnd] = JSON.stringify(bodyTemplate).split("__BASE64_STREAM_CONTENT__");

                    const openRouterStream = new ReadableStream({
                        async start(controller) {
                            controller.enqueue(encoder.encode(jsonStart));
                            const base64Stream = req.body!.pipeThrough(new Base64TransformStream());
                            const reader = base64Stream.getReader();
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                controller.enqueue(encoder.encode(value));
                            }
                            controller.enqueue(encoder.encode(jsonEnd));
                            controller.close();
                        }
                    });

                    const aiRes = await fetch(OPENROUTER_URL, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://keden.kgd.gov.kz",
                        },
                        body: openRouterStream,
                        // @ts-ignore
                        duplex: "half"
                    });

                    if (!aiRes.ok) throw new Error(`OpenRouter error: ${aiRes.statusText}`);

                    const aiReader = aiRes.body!.getReader();
                    while (true) {
                        const { done, value } = await aiReader.read();
                        if (done) break;
                        writer.write(value);
                    }

                    await supabase.from("logs").insert({
                        user_iin: iin,
                        action_type: "AI_STREAM_EXTRACT",
                        description: `Streamed file: ${fileName}`
                    });
                } catch (e: any) {
                    writer.write(encoder.encode(sse("error", { message: e.message })));
                } finally {
                    clearInterval(pingInterval);
                    try { writer.close(); } catch { }
                }
            })();

            return new Response(readable, {
                headers: { ...corsHeaders, "Content-Type": "text/event-stream" }
            });
        }

        // Action: extract (Parallel per-file или Batch fallback)
        if (action === "extract" && jsonBody) {
            const {
                originalFileNames,
                parallelMode = true,
                preParsedDocuments = [],
            } = jsonBody;
            const storagePaths: string[] = jsonBody.storagePaths || [];

            if (storagePaths.length === 0 && preParsedDocuments.length === 0) {
                throw new Error("Missing storagePaths");
            }

            await checkAndDeductCredits();

            /** Конвертирует pre-parsed Excel объект в формат agentResult для merger. */
            const toParsedAgentResult = (pp: any) => ({
                filename: pp.fileName,
                document: { filename: pp.fileName, type: "INVOICE", number: "", date: "" },
                documents: [{ filename: pp.fileName, type: "INVOICE", number: "", date: "" }],
                products: pp.products || [],
                totalWeight: pp.totalWeight || 0,
                totalPackages: pp.totalPackages || 0,
                totalCost: pp.totalCost || 0,
                schemaVersion: "1.0",
            });

            // ── ПАРАЛЛЕЛЬНЫЙ РЕЖИМ (по умолчанию) ──────────────────────────────
            if (parallelMode) {
                // Инжектируем pre-parsed Excel файлы напрямую (без AI)
                const agentResults: any[] = preParsedDocuments.map(toParsedAgentResult);
                const failedFiles: string[] = [];

                if (storagePaths.length > 0) {
                    const groups = groupFilesByName(storagePaths, originalFileNames);
                    const models = ["google/gemini-3.1-flash-lite-preview", "anthropic/claude-haiku-4.5"];
                    const sem = createSemaphore(8);

                    const promises = Array.from(groups.values()).map((group) =>
                        sem(() => processFileGroup(supabase, group, models))
                    );

                    const settled = await Promise.allSettled(promises);

                    for (const s of settled) {
                        if (s.status === "fulfilled" && s.value.result) {
                            agentResults.push(s.value.result);
                        } else {
                            const reason = s.status === "rejected"
                                ? String(s.reason)
                                : (s.value?.error || "unknown error");
                            failedFiles.push(reason);
                            console.error(`[parallel] Failed:`, reason);
                        }
                    }
                }

                if (agentResults.length === 0) {
                    throw new Error(`AI error: All file extractions failed.`);
                }

                const result = mergeAgentResults(agentResults);

                for (const f of failedFiles) {
                    result.validation.warnings.push({
                        message: `Не удалось обработать файл: ${f}`,
                        severity: "WARNING",
                    });
                }

                await supabase.from("logs").insert({
                    user_iin: iin,
                    action_type: "AI_EXTRACT_PARALLEL",
                    description: `Parallel: ${agentResults.length - preParsedDocuments.length} AI + ${preParsedDocuments.length} pre-parsed, ${failedFiles.length} failed`,
                });

                return new Response(JSON.stringify(result), { headers: corsHeaders });
            }

            // ── BATCH РЕЖИМ (fallback, parallelMode=false) ──────────────────────
            const fileContents = [];
            let totalBytes = 0;
            const MAX_TOTAL_BYTES = 70 * 1024 * 1024; // 70MB

            for (let i = 0; i < storagePaths.length; i++) {
                const path = storagePaths[i];
                const originalName = originalFileNames?.[i] || path;
                try {
                    const { data, error } = await supabase.storage.from("documents").download(path);
                    if (error) continue;

                    if (totalBytes + data.size > MAX_TOTAL_BYTES) continue;
                    totalBytes += data.size;

                    const buffer = await data.arrayBuffer();
                    if (data.type.startsWith("image/") || data.type === "application/pdf") {
                        const uint8 = new Uint8Array(buffer);
                        let binary = "";
                        const chunk_size = 16384;
                        for (let k = 0; k < uint8.length; k += chunk_size) {
                            binary += String.fromCharCode(...uint8.subarray(k, k + chunk_size));
                        }
                        fileContents.push({
                            type: "image_url",
                            image_url: { url: `data:${data.type};base64,${btoa(binary)}` }
                        });
                    } else {
                        fileContents.push({
                            type: "text",
                            text: `--- Content of ${originalName} ---\n${new TextDecoder().decode(buffer)}`
                        });
                    }
                } catch (e) {
                    console.error(`Processing error for ${path}:`, e);
                }
            }

            const prompt = getBatchPrompt([...new Set(originalFileNames || storagePaths)] as string[]);
            const models = ["google/gemini-3.1-flash-lite-preview", "anthropic/claude-haiku-4.5"];

            let aiData;
            for (const model of models) {
                try {
                    console.log(`Trying model: ${model}`);
                    const response = await fetch(OPENROUTER_URL, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://keden.kgd.gov.kz",
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: [
                                { role: "system", content: SYSTEM_PROMPT },
                                { role: "user", content: [{ type: "text", text: prompt }, ...fileContents] }
                            ],
                            max_tokens: 32768,
                            response_format: { type: "json_object" }
                        })
                    });

                    if (!response.ok) continue;
                    aiData = await response.json();
                    if (aiData.choices?.[0]?.message?.content) break;
                } catch (e) {
                    console.error(`Error with model ${model}:`, e);
                }
            }

            if (!aiData?.choices?.[0]?.message?.content) {
                throw new Error(`AI error: All models failed.`);
            }

            let content = aiData.choices[0].message.content.trim();
            if (content.startsWith("```")) {
                content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
            }

            const rawParsed = safeParseJSON(content);
            const batchAgentResults = [
                ...preParsedDocuments.map(toParsedAgentResult),
                ...(Array.isArray(rawParsed) ? rawParsed : [rawParsed]),
            ];
            const result = mergeAgentResults(batchAgentResults);

            await supabase.from("logs").insert({
                user_iin: iin,
                action_type: "AI_EXTRACT_SINGLE_BATCH",
                description: `Processed ${storagePaths.length} files + ${preParsedDocuments.length} pre-parsed`,
            });

            return new Response(JSON.stringify(result), { headers: corsHeaders });
        }

        throw new Error("Action not supported");

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders
        });
    }
});
