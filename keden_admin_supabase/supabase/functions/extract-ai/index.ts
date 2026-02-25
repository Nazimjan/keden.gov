import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBatchPrompt } from "./prompts.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Base64 Encoding TransformStream
 * Handles binary chunks and encodes them to Base64 on the fly.
 * Maintains a small buffer (max 2 bytes) for groups of 3 bytes.
 */
class Base64TransformStream extends TransformStream<Uint8Array, string> {
    constructor() {
        let partial = new Uint8Array(0);
        const lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

        super({
            transform(chunk, controller) {
                // Concatenate leftovers from previous chunk
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
 * JSON Repair & Safe Parse (ported from client-side gemini.js)
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

        // 1. Initial Data Extraction (Header-based for streams, Body-based for JSON)
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

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseKey || supabaseKey.includes("YOUR_SERVICE_ROLE")) {
            console.error("Missing or Placeholder Environment Variables", { supabaseUrl: !!supabaseUrl, isPlaceholder: supabaseKey?.includes("YOUR_SERVICE_ROLE") });
            throw new Error(`System Configuration Error: Supabase environment variables are missing or use placeholders.`);
        }

        console.log(`Supabase Client initialized. URL: ${supabaseUrl}, Key starts with: ${supabaseKey.substring(0, 5)}...`);
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 2. Auth & Credits Check
        console.log("Checking user in DB for IIN:", iin);
        let { data: user, error: userError } = await supabase
            .from("users")
            .select("*")
            .eq("iin", iin)
            .single();

        if (userError) {
            console.error("User lookup error:", userError.message);
            // Try to create user if not found
            const { data: newUser, error: createError } = await supabase
                .from("users")
                .insert({ iin, fio, credits: 10, is_allowed: true })
                .select().single();

            if (createError) {
                console.error("User creation error:", createError.message);
                throw new Error(`Database Error: ${createError.message}`);
            }
            user = newUser;
        }

        // 2. Access Check Helper (Shared)
        const checkAndDeductCredits = async () => {
            if (!user.is_allowed) throw new Error("Доступ заблокирован");
            const now = new Date();
            const hasSubscription = user.subscription_end && new Date(user.subscription_end) > now;

            if (hasSubscription) return true; // Unlimited for subscribers

            // Atomic credit deduction via PostgreSQL function
            // This prevents race conditions and handles "credits > 0" check in one transaction
            const { data: updatedUser, error: rpcError } = await supabase.rpc('deduct_credit', {
                user_id: user.id
            });

            if (rpcError || !updatedUser || (Array.isArray(updatedUser) && updatedUser.length === 0)) {
                console.error("RPC Credit Deduction Error:", rpcError?.message || "User not returned");
                throw new Error("Недостаточно кредитов или ошибка списания. Пожалуйста, пополните баланс.");
            }

            // Update local user object with the new credit state (RPC returns an array for SETOF)
            user = Array.isArray(updatedUser) ? updatedUser[0] : updatedUser;
            return false;
        };

        // Action: Check Access
        if (action === "check_access") {
            const now = new Date();
            const hasSubscription = user.subscription_end && new Date(user.subscription_end) > now;
            return new Response(JSON.stringify({
                allowed: user.is_allowed,
                fio: user.fio,
                credits: user.credits,
                hasSubscription,
                message: user.is_allowed ? "Доступ разрешен" : "Доступ заблокирован"
            }), { headers: corsHeaders });
        }

        // Action: Log (Non-streaming)
        if (action === "log" && jsonBody) {
            const { action_type, description } = jsonBody;
            await supabase.from("logs").insert({
                user_iin: iin,
                action_type: action_type || "GENERAL_LOG",
                description: description || ""
            });
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        // CORE LOGIC: Streaming Extraction
        if (action === "extract-stream") {
            // Check & Deduct UPFRONT to avoid race conditions
            await checkAndDeductCredits();

            const fileName = req.headers.get("x-file-name") || "document";
            const fileType = req.headers.get("x-file-type") || "image/jpeg";
            const promptStr = getBatchPrompt([fileName]);

            // Create SSE Channel
            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const encoder = new TextEncoder();

            const sendSSE = (event: string, data: any) => {
                writer.write(encoder.encode(sse(event, data)));
            };

            // Process in background
            (async () => {
                const pingInterval = setInterval(() => {
                    try {
                        writer.write(encoder.encode(": keep-alive\n\n"));
                    } catch {
                        clearInterval(pingInterval);
                    }
                }, 15000);

                try {
                    sendSSE("status", { message: "Starting streaming transfer..." });

                    // 1. Prepare Composite Request Stream for OpenRouter (SAFER JSON)
                    const streamPlaceholder = "__BASE64_STREAM_CONTENT__";
                    const bodyTemplate = {
                        model: "google/gemini-3-flash-preview",
                        stream: true,
                        max_tokens: 8192,
                        messages: [{
                            role: "user",
                            content: [
                                { type: "text", text: promptStr },
                                { type: "image_url", image_url: { url: `data:${fileType};base64,${streamPlaceholder}` } }
                            ]
                        }]
                    };

                    const fullJsonTemplate = JSON.stringify(bodyTemplate);
                    const [jsonStart, jsonEnd] = fullJsonTemplate.split(streamPlaceholder);

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

                    sendSSE("status", { message: "Uploading to AI..." });

                    const aiRes = await fetch(OPENROUTER_URL, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://keden.kgd.gov.kz",
                        },
                        body: openRouterStream,
                        // @ts-ignore: duplex is required for streaming in Deno/Fetch
                        // See: https://github.com/denoland/deno/issues/16654
                        duplex: "half"
                    });

                    if (!aiRes.ok) throw new Error(`OpenRouter error: ${aiRes.statusText}`);

                    sendSSE("status", { message: "AI is analyzing..." });
                    const aiReader = aiRes.body!.getReader();
                    while (true) {
                        const { done, value } = await aiReader.read();
                        if (done) break;
                        writer.write(value);
                    }

                    // Post-processing Task
                    const logTask = (async () => {
                        await supabase.from("logs").insert({
                            user_iin: iin,
                            action_type: "AI_STREAM_EXTRACT",
                            description: `Streamed file: ${fileName}`
                        });
                    })();

                    // @ts-ignore
                    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(logTask);
                    else await logTask;

                } catch (e: any) {
                    sendSSE("error", { message: e.message });
                } finally {
                    clearInterval(pingInterval);
                    try { writer.close(); } catch { }
                }
            })();

            return new Response(readable, {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive"
                }
            });
        }

        // Legacy Logic: Extract from Storage Paths
        if (action === "extract" && jsonBody) {
            const { storagePaths, originalFileNames } = jsonBody;
            if (!storagePaths) throw new Error("Missing storagePaths");

            // Check & Deduct UPFRONT
            await checkAndDeductCredits();

            // Download files from Storage sequentially to save memory
            const fileContents = [];
            let totalBytes = 0;
            const MAX_TOTAL_BYTES = 70 * 1024 * 1024; // 70MB limit for safety in 150MB Deno env

            for (const path of storagePaths) {
                try {
                    const { data, error } = await supabase.storage.from("documents").download(path);
                    if (error) {
                        console.error(`Download error for ${path}:`, error.message);
                        continue;
                    }

                    // Check size before loading into ArrayBuffer
                    if (totalBytes + data.size > MAX_TOTAL_BYTES) {
                        console.warn(`[Warning] Skipping ${path} - total size limit reached (${MAX_TOTAL_BYTES} bytes)`);
                        continue;
                    }
                    totalBytes += data.size;

                    const buffer = await data.arrayBuffer();

                    if (data.type.startsWith("image/") || data.type === "application/pdf") {
                        const uint8 = new Uint8Array(buffer);
                        // Efficient Base64 conversion for large files
                        let binary = "";
                        const chunk_size = 16384;
                        for (let i = 0; i < uint8.length; i += chunk_size) {
                            const chunk = uint8.subarray(i, i + chunk_size);
                            binary += String.fromCharCode(...chunk);
                        }
                        const base64 = btoa(binary);
                        fileContents.push({
                            type: "image_url",
                            image_url: { url: `data:${data.type};base64,${base64}` }
                        });
                    } else {
                        const text = new TextDecoder().decode(buffer);
                        fileContents.push({
                            type: "text",
                            text: `--- Content of ${path} ---\n${text}`
                        });
                    }
                } catch (e) {
                    console.error(`Processing error for ${path}:`, e);
                }
            }

            if (fileContents.length < storagePaths.length) {
                console.warn(`[Warning] Only ${fileContents.length}/${storagePaths.length} files were successfully processed.`);
            }

            const namesForPrompt = originalFileNames || storagePaths;
            const prompt = getBatchPrompt(namesForPrompt) + "\n\nCRITICAL: You MUST extract ALL items from the product lists. If there are 30 items, return 30 items. DO NOT truncate. Return ONLY valid JSON.";

            // Call OpenRouter with fallback. Gemini 3 Flash is primary for best cost/perf balance.
            let aiData;
            const models = ["google/gemini-3-flash-preview", "qwen/qwen3.5-plus-02-15", "moonshotai/kimi-k2.5"];

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
                            messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...fileContents] }],
                            max_tokens: 16384,
                            response_format: { type: "json_object" }
                        })
                    });

                    aiData = await response.json();
                    if (response.ok && aiData.choices?.[0]?.message?.content) break;
                    console.warn(`Model ${model} failed, trying next...`);
                } catch (e) {
                    console.error(`Error with model ${model}:`, e);
                }
            }

            if (!aiData?.choices?.[0]?.message?.content) {
                throw new Error(`AI error: All models failed or returned invalid response.`);
            }

            let content = aiData.choices[0].message.content.trim();
            if (content.startsWith("```")) {
                content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
            }

            let result;
            try {
                result = safeParseJSON(content);
            } catch (e: any) {
                console.error("JSON Parse failure. Content snippet:", content.substring(0, 200));
                throw new Error(`AI returned malformed data: ${e.message}`);
            }

            // Update Logs (Credits already deducted upfront)
            await supabase.from("logs").insert({
                user_iin: iin,
                action_type: "AI_EXTRACT_LEGACY",
                description: `Processed ${storagePaths.length} files`
            });

            return new Response(JSON.stringify(result), { headers: corsHeaders });
        }

        throw new Error("Action not supported or missing streaming headers");

    } catch (err: any) {
        const errorMsg = err.message || "Unknown error";
        console.error("Internal Edge Function Error:", errorMsg);
        console.error("Stack:", err.stack);

        return new Response(JSON.stringify({
            error: errorMsg,
            details: "Check Supabase Edge Function logs for more details.",
            stack: err.stack
        }), {
            status: 500,
            headers: corsHeaders
        });
    }
});
