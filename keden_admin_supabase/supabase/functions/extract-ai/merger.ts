import { normalizeName, calculateSimilarity } from "./utils.ts";

/**
 * Типы документов, участвующие в сверке контрагентов (consignor/consignee).
 * Договоры, доверенности и прочие вспомогательные документы — исключены.
 */
const COUNTERAGENT_RELEVANT_DOC_TYPES = new Set([
    "INVOICE", "INVOICE_EXCEL", "TRANSPORT_DOC", "CMR", "TTN", "PACKING_LIST",
]);

/** Проверяет, что ключ crossChecks.names ("тип:файл") относится к релевантному типу документа. */
function isRelevantCrossCheckKey(key: string): boolean {
    const typePrefix = key.split(":")[0].toUpperCase().replace(/_/g, "_");
    return COUNTERAGENT_RELEVANT_DOC_TYPES.has(typePrefix);
}

/**
 * Рекурсивный deep merge для объектов crossChecks.
 * Предотвращает потерю данных при shallow spread когда разные документы
 * дают одинаковые ключи верхнего уровня (weight, packages, names).
 */
function deepMergeCrossChecks(existing: any, incoming: any): any {
    const result = { ...existing };
    for (const [key, val] of Object.entries(incoming)) {
        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            result[key] =
                typeof existing[key] === "object" && existing[key] !== null
                    ? deepMergeCrossChecks(existing[key], val as any)
                    : { ...(val as any) };
        } else {
            result[key] = val;
        }
    }
    return result;
}

/** Преобразует ключ crossChecks в читаемую метку. Поддерживает формат "тип:файл". */
export function getDocLabel(key: string): string {
    const labels: Record<string, string> = {
        "invoice": "Инвойс",
        "cmr": "CMR",
        "ttn": "ТТН",
        "transport_doc": "Транспортный док.",
        "packing_list": "Упаков. лист",
        "registry": "Реестр",
        "technical_passport": "Техпаспорт",
        "techpassport": "Техпаспорт",
        "invoice_excel": "Excel Инвойс",
        "invoice_total": "Сумма в инвойсе",
        "total_weight": "Общий вес",
        "total_packages": "Кол-во мест",
        "consignee": "Получатель",
        "consignor": "Отправитель",
        "carrier": "Перевозчик",
        "declarant": "Декларант",
    };
    const lowKey = key.toLowerCase();

    // Поддержка составных ключей "тип:имя_файла"
    if (lowKey.includes(":")) {
        const colonIdx = lowKey.indexOf(":");
        const typeKey = lowKey.substring(0, colonIdx);
        const fileName = key.substring(colonIdx + 1); // оригинальный регистр имени файла
        const typeLabel = labels[typeKey] || typeKey;
        return `${typeLabel} (${fileName})`;
    }

    return labels[lowKey] || key;
}

/**
 * Дополняет mentions контрагентов из crossChecks.names.
 * Страховочный слой для batch-режима: если AI вернул один consignor/consignee,
 * но в crossChecks.names указал разные имена из разных файлов — добавляем их в mentions.
 */
function enrichMentionsFromCrossChecks(
    merged: any,
    mentions: any,
    role: "consignor" | "consignee",
): void {
    const namesObj = merged.validation.crossChecks?.names?.[role];
    if (!namesObj) return;

    const existingNorms = new Set(
        mentions[role].map((m: any) =>
            normalizeName(m.data.legal?.nameRu || m.data.nonResidentLegal?.nameRu || "")
        ),
    );

    let enrichedCount = 0;
    for (const [key, name] of Object.entries(namesObj)) {
        if (typeof name !== "string" || name.length < 3) continue;
        const norm = normalizeName(name);
        if (existingNorms.has(norm)) continue;

        mentions[role].push({
            source: getDocLabel(key),
            docType: key.split(":")[0]?.toUpperCase() || "OTHER",
            data: {
                present: true,
                entityType: "NON_RESIDENT_LEGAL",
                legal: { bin: "", nameRu: "" },
                nonResidentLegal: { nameRu: name as string },
                addresses: [],
            },
        });
        existingNorms.add(norm);
        enrichedCount++;
    }
    if (enrichedCount > 0) {
        console.log(`[enrichMentions] Добавлено ${enrichedCount} записей ${role} из crossChecks.names`);
    }
}

/**
 * ТРЕТИЙ СЛОЙ ЗАЩИТЫ: после мержа контрагентов проводим повторный majority vote
 * по crossChecks.names[role].
 *
 * В batch-режиме AI возвращает один consignor → mentions содержит 1 запись →
 * validateAndMergeCounteragent принимает её без сравнения.
 * НО в crossChecks.names AI (если промпт выполнен) указал имена из КАЖДОГО документа.
 *
 * Алгоритм:
 * 1. Считаем, сколько документов в crossChecks.names поддерживают финальное имя.
 * 2. Считаем, сколько поддерживают альтернативные имена.
 * 3. Если альтернативная группа БОЛЬШЕ — заменяем победителя и пишем ошибку о коррекции.
 * 4. Если просто есть расхождение (меньшинство) — только репортируем конфликт.
 */
function crossVerifyFinalCounteragents(
    merged: any,
    role: "consignor" | "consignee",
): void {
    const namesObj = merged.validation.crossChecks?.names?.[role];
    if (!namesObj) return;

    const finalData = merged.mergedData.counteragents[role];
    if (!finalData?.present) return;

    const finalName =
        finalData.legal?.nameRu ||
        finalData.nonResidentLegal?.nameRu ||
        "";
    if (!finalName) return;

    const finalNorm = normalizeName(finalName);
    const roleLabel = role === "consignor" ? "ОТПРАВИТЕЛЯ" : "ПОЛУЧАТЕЛЯ";

    // Majority vote по crossChecks.names (только релевантные типы документов)
    const freq: Record<string, { normalized: string; original: string; docs: string[] }> = {};
    for (const [key, name] of Object.entries(namesObj)) {
        if (typeof name !== "string" || name.length < 3) continue;
        if (!isRelevantCrossCheckKey(key)) continue;
        const norm = normalizeName(name as string);
        if (!norm) continue;
        if (!freq[norm]) freq[norm] = { normalized: norm, original: name as string, docs: [] };
        freq[norm].docs.push(key);
    }

    if (Object.keys(freq).length === 0) return;

    // Сортируем по количеству голосов (от большего к меньшему)
    const groups = Object.values(freq).sort((a, b) => b.docs.length - a.docs.length);
    const topGroup = groups[0];

    // Если все документы в crossChecks согласны — сравниваем с финальным именем
    if (groups.length === 1) {
        if (topGroup.normalized !== finalNorm) {
            // Все crossChecks говорят одно имя, а mentions дал другое → исправляем
            _correctCounterAgentName(merged, role, finalData, finalName, topGroup.original, "все документы crossChecks", roleLabel);
        }
        return;
    }

    // Победитель crossChecks vs финальное принятое имя
    const topMatchesFinal = topGroup.normalized === finalNorm;

    if (!topMatchesFinal) {
        // Большинство crossChecks за другое имя → принятое имя НЕВЕРНО → исправляем
        const supportCount = topGroup.docs.length;
        const finalCount = freq[finalNorm]?.docs.length ?? 0;
        const docLabels = topGroup.docs.map((d) => getDocLabel(d)).join(", ");
        _correctCounterAgentName(
            merged, role, finalData, finalName,
            topGroup.original,
            `${supportCount} из ${supportCount + finalCount} документов (${docLabels})`,
            roleLabel,
        );
    }

    // Репортируем конфликты меньшинства (не тот вариант, что победил)
    const winner = topMatchesFinal ? topGroup : (freq[finalNorm] ?? topGroup);
    for (const loser of groups) {
        if (loser.normalized === winner.normalized) continue;
        const sim = calculateSimilarity(winner.normalized, loser.normalized);
        const loserDocs = loser.docs.map((d) => getDocLabel(d)).join(", ");

        // Проверяем дублирование с compareNamesAllDocuments
        const alreadyReported = merged.validation.errors.some((e: any) =>
            e.message?.includes(loser.original) && e.message?.includes(winner.original),
        );
        if (alreadyReported) continue;

        merged.validation.errors.push({
            field: `${role}.name`,
            message: sim > 0.8
                ? `ОПЕЧАТКА У ${roleLabel}: «${loser.original}» (в ${loserDocs}) — принято «${winner.original}» (большинство документов).`
                : `КОНФЛИКТ У ${roleLabel}: «${loser.original}» (в ${loserDocs}) — принято «${winner.original}» (большинство документов).`,
            severity: "ERROR",
        });
    }
}

/**
 * Исправляет имя контрагента в mergedData и записывает ошибку о коррекции.
 * Вызывается из crossVerifyFinalCounteragents когда majority vote указывает на другого победителя.
 */
function _correctCounterAgentName(
    merged: any,
    role: string,
    finalData: any,
    wrongName: string,
    correctName: string,
    reason: string,
    roleLabel: string,
): void {
    // Применяем исправление в mergedData
    if (finalData.entityType === "LEGAL" && finalData.legal?.nameRu) {
        finalData.legal.nameRu = correctName;
    } else {
        // NON_RESIDENT_LEGAL или любой другой тип
        finalData.entityType = "NON_RESIDENT_LEGAL";
        if (!finalData.nonResidentLegal) finalData.nonResidentLegal = {};
        finalData.nonResidentLegal.nameRu = correctName;
    }

    console.log(`[crossVerify] ${roleLabel}: исправлено «${wrongName}» → «${correctName}» (${reason})`);

    merged.validation.errors.push({
        field: `${role}.name`,
        message: `ИСПРАВЛЕНО У ${roleLabel}: «${wrongName}» заменено на «${correctName}» — ${reason} подтверждают правильное имя.`,
        severity: "ERROR",
    });
}

/**
 * Программно строит crossChecks из индивидуальных результатов агентов.
 * Вызывается после сбора mentions, но перед runProgrammaticCrossChecks.
 * Заполняет только ПУСТЫЕ ключи — не перезаписывает данные от AI.
 */
function buildProgrammaticCrossChecks(merged: any, mentions: any, agentResults: any[]): void {
    const checks = merged.validation.crossChecks;

    // 1. ВЕСТ из docTotals (weight per document)
    if (mentions.docTotals.length > 1) {
        if (!checks.weight) checks.weight = {};
        for (const dt of mentions.docTotals) {
            if (dt.weight <= 0) continue;
            const docTypeLower = (dt.type || "other").toLowerCase();
            const fileName = dt.source.match(/\((.+)\)$/)?.[1] || dt.source;
            const key = `${docTypeLower}:${fileName}`;
            if (!(key in checks.weight)) checks.weight[key] = dt.weight;
        }
    }

    // 2. МЕСТА из docTotals (packages per document)
    if (mentions.docTotals.length > 1) {
        if (!checks.packages) checks.packages = {};
        for (const dt of mentions.docTotals) {
            if (dt.packages <= 0) continue;
            const docTypeLower = (dt.type || "other").toLowerCase();
            const fileName = dt.source.match(/\((.+)\)$/)?.[1] || dt.source;
            const key = `${docTypeLower}:${fileName}`;
            if (!(key in checks.packages)) checks.packages[key] = dt.packages;
        }
    }

    // 3. ИМЕНА контрагентов из mentions
    for (const role of ["consignor", "consignee"] as const) {
        if (mentions[role].length === 0) continue;
        if (!checks.names) checks.names = {};
        if (!checks.names[role]) checks.names[role] = {};
        for (const m of mentions[role]) {
            const name: string =
                m.data.legal?.nameRu ||
                m.data.nonResidentLegal?.nameRu ||
                "";
            if (name.length < 3) continue;
            const docTypeLower = (m.docType || "other").toLowerCase();
            const fileName = m.source.match(/\((.+)\)$/)?.[1] || m.source;
            const key = `${docTypeLower}:${fileName}`;
            if (!(key in checks.names[role])) checks.names[role][key] = name;
        }
    }

    // 4. ТРАНСПОРТ из mentions.vehicles
    if (mentions.vehicles.length > 0) {
        if (!checks.vehicles) checks.vehicles = {};
        const tractors: Record<string, string> = {};
        const trailers: Record<string, string> = {};
        for (const m of mentions.vehicles) {
            const v = m.data;
            if (v.tractorRegNumber) tractors[m.docType] = v.tractorRegNumber;
            if (v.trailerRegNumber) trailers[m.docType] = v.trailerRegNumber;
        }
        if (!checks.vehicles.tractor && (tractors["TRANSPORT_DOC"] || tractors["CMR"] || tractors["VEHICLE_DOC"])) {
            checks.vehicles.tractor = {
                transportDoc: tractors["TRANSPORT_DOC"] || tractors["CMR"] || "",
                techPassport: tractors["VEHICLE_DOC"] || "",
            };
        }
        if (!checks.vehicles.trailer && (trailers["TRANSPORT_DOC"] || trailers["CMR"] || trailers["VEHICLE_DOC"])) {
            checks.vehicles.trailer = {
                transportDoc: trailers["TRANSPORT_DOC"] || trailers["CMR"] || "",
                techPassport: trailers["VEHICLE_DOC"] || "",
            };
        }
    }

    // 5. ФИНАНСЫ: invoiceTotal из результата INVOICE
    if (!checks.finances?.invoiceTotal) {
        const invoiceResult = agentResults.find(
            (r: any) => r.document?.type === "INVOICE" || r.documents?.[0]?.type === "INVOICE",
        );
        const invoiceTotal = parseFloat(String(invoiceResult?.totalCost || 0));
        if (invoiceTotal > 0) {
            if (!checks.finances) checks.finances = {};
            checks.finances.invoiceTotal = invoiceTotal;
        }
    }

    // 6. ССЫЛКА НА ИНВОЙС из CMR (поле invoiceReference в per-file режиме)
    if (!checks.invoiceRef) {
        for (const r of agentResults) {
            const docType = r.document?.type || r.documents?.[0]?.type || "";
            const ref: string = r.invoiceReference || "";
            if (docType === "TRANSPORT_DOC" && ref.length > 2) {
                const fileName = r.filename || r.documents?.[0]?.filename || "cmr";
                checks.invoiceRef = { [`transport_doc:${fileName}`]: ref };
                break;
            }
        }
    }
}

/**
 * Объединяет результаты всех файл-агентов в единый объект Keden PI.
 */
export function mergeAgentResults(agentResults: any[]) {
    const merged: any = {
        documents: [],
        validation: { errors: [], warnings: [], crossChecks: {} },
        mergedData: {
            counteragents: {
                consignor: null,
                consignee: null,
                carrier: null,
                declarant: null,
            },
            vehicles: { tractorRegNumber: "", tractorCountry: "", trailerRegNumber: "", trailerCountry: "" },
            countries: { departureCountry: "", destinationCountry: "" },
            products: [],
            registry: { number: "", date: "" },
            driver: { present: false, iin: "", firstName: "", lastName: "" },
            shipping: { customsCode: "", destCustomsCode: "", transportMode: "" },
            totalWeight: 0,
            totalPackages: 0,
            totalCost: 0,
        },
    };

    // Schema version check
    const SUPPORTED_SCHEMA = "1.0";
    for (const result of agentResults) {
        const version = result.schemaVersion;
        if (!version || version === SUPPORTED_SCHEMA) continue;
        merged.validation.warnings.push({
            field: "schemaVersion",
            message: `Неизвестная версия схемы AI-ответа: "${version}". Ожидается "${SUPPORTED_SCHEMA}". Возможны ошибки парсинга.`,
            severity: "WARNING",
        });
    }

    const mentions: any = {
        consignor: [],
        consignee: [],
        carrier: [],
        declarant: [],
        vehicles: [],
        driver: [],
        countries: [],
        productCandidates: [],
        docTotals: [],
        shipping: [],
    };

    const productPriority: any = {
        "REGISTRY": 4,
        "INVOICE_EXCEL": 3,
        "CMR": 2,
        "TTN": 2,
        "TRANSPORT_DOC": 2,
        "PACKING_LIST": 1.5,
        "INVOICE": 1,
        "OTHER": 0,
    };

    for (const result of agentResults) {
        if (!result || result.error) continue;

        const docType = result.document?.type || "OTHER";
        const fileName = result.filename || "unknown";

        const docTypeLabels: any = {
            "INVOICE": "Инвойс",
            "CMR": "CMR",
            "TTN": "ТТН",
            "TRANSPORT_DOC": "Транспортный док.",
            "PACKING_LIST": "Упаковочный лист",
            "REGISTRY": "Реестр",
            "VEHICLE_PERMIT": "Свид. допущения",
            "DRIVER_ID": "Уд. личности",
            "TECHNICAL_PASSPORT": "Техпаспорт",
            "CONTRACT": "Договор",
            "OTHER": "Документ",
        };
        const docLabel = docTypeLabels[docType] || docType;
        const sourceLabel = `${docLabel} (${fileName})`;

        // Собираем документы
        if (result.documents && Array.isArray(result.documents)) {
            merged.documents.push(...result.documents);
        } else if (result.document) {
            merged.documents.push({
                filename: fileName,
                type: docType,
                number: result.document.number || "",
                date: result.document.date || "",
            });
        }

        // Собираем контрагентов.
        // consignor/consignee берём только из релевантных документов (инвойс, CMR, ТТН, реестр).
        // Договоры экспедиции, доверенности и прочее — не участвуют в сверке.
        const isRelevantForCounterAgent = COUNTERAGENT_RELEVANT_DOC_TYPES.has(docType);
        if (result.consignor?.present && isRelevantForCounterAgent) mentions.consignor.push({ source: sourceLabel, docType, data: result.consignor });
        if (result.consignee?.present && isRelevantForCounterAgent) mentions.consignee.push({ source: sourceLabel, docType, data: result.consignee });
        if (result.carrier?.present) mentions.carrier.push({ source: sourceLabel, docType, data: result.carrier });
        if (result.declarant?.present) mentions.declarant.push({ source: sourceLabel, docType, data: result.declarant });

        if (result.vehicles && (result.vehicles.tractorRegNumber || result.vehicles.trailerRegNumber)) {
            mentions.vehicles.push({ source: sourceLabel, docType, data: result.vehicles });
        }

        if (result.driver?.present) mentions.driver.push({ source: sourceLabel, docType, data: result.driver });

        // Веса и итоги
        const tw = parseFloat(String(result.totalWeight || 0));
        const tp = parseInt(String(result.totalPackages || 0));
        const tc = parseFloat(String(result.totalCost || 0));
        if (tw > 0 || tp > 0 || tc > 0) {
            mentions.docTotals.push({ source: sourceLabel, type: docType, weight: tw, packages: tp, cost: tc });
        }

        // Товары
        if (result.products && result.products.length > 0) {
            let actualDocType = docType;
            if (docType === "INVOICE" && fileName.toLowerCase().endsWith(".xlsx")) {
                actualDocType = "INVOICE_EXCEL";
            }
            const priority = productPriority[actualDocType] || 0;
            mentions.productCandidates.push({
                source: sourceLabel,
                docType: actualDocType,
                priority: priority,
                products: result.products,
            });
        }

        if (result.countries) mentions.countries.push({ source: sourceLabel, data: result.countries });
        if (result.shipping) mentions.shipping.push({ source: sourceLabel, data: result.shipping });

        // Сохраняем кросс-валидацию от ИИ — DEEP MERGE чтобы не терять данные из разных документов
        if (result.validation) {
            if (Array.isArray(result.validation.warnings)) {
                const nw = result.validation.warnings.map((w: any) =>
                    typeof w === "string" ? { message: w, severity: "WARNING" } : w
                );
                merged.validation.warnings.push(...nw);
            }
            if (Array.isArray(result.validation.errors)) {
                const ne = result.validation.errors.map((e: any) =>
                    typeof e === "string" ? { message: e, severity: "ERROR" } : e
                );
                merged.validation.errors.push(...ne);
            }
            if (result.validation.crossChecks) {
                merged.validation.crossChecks = deepMergeCrossChecks(
                    merged.validation.crossChecks,
                    result.validation.crossChecks,
                );
            }
        }
    }

    // Мерж стран
    if (mentions.countries.length > 0) {
        const best = mentions.countries.find((m: any) => m.source.toLowerCase().includes("cmr")) || mentions.countries[0];
        merged.mergedData.countries.departureCountry = (best.data.departureCountry || "").toUpperCase();
        merged.mergedData.countries.destinationCountry = (best.data.destinationCountry || "").toUpperCase();
    }

    // Мерж товаров (выбор лучшего источника)
    if (mentions.productCandidates.length > 0) {
        mentions.productCandidates.sort((a: any, b: any) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return b.products.length - a.products.length;
        });
        merged.mergedData.products = mentions.productCandidates[0].products;
    }

    // Слой 2: дополняем mentions из crossChecks.names (страховка для batch-режима)
    enrichMentionsFromCrossChecks(merged, mentions, "consignor");
    enrichMentionsFromCrossChecks(merged, mentions, "consignee");

    // Мерж контрагентов (majority vote по mentions)
    for (const role of ["consignor", "consignee", "carrier", "declarant"]) {
        validateAndMergeCounteragent(merged, role, mentions[role]);
    }

    // Слой 3: верифицируем финальные имена против crossChecks.names
    // Ловим конфликты, которые не попали в mentions (batch AI вернул одно имя)
    crossVerifyFinalCounteragents(merged, "consignor");
    crossVerifyFinalCounteragents(merged, "consignee");

    // Программная сборка crossChecks из индивидуальных результатов агентов.
    // Работает как в параллельном режиме (per-file), так и как страховка для batch.
    // Заполняет только пустые ключи — не перезаписывает данные от AI.
    buildProgrammaticCrossChecks(merged, mentions, agentResults);

    // Транспорт и водитель
    handleVehicles(merged, mentions.vehicles);
    handleDriver(merged, mentions.driver);

    // Авторитетные итоги документов (приоритет: CMR/TRANSPORT_DOC > TTN > INVOICE)
    const docTotalPriority: Record<string, number> = {
        "TRANSPORT_DOC": 3, "CMR": 3, "TTN": 2,
        "PACKING_LIST": 1.5, "INVOICE_EXCEL": 1.5, "INVOICE": 1,
    };
    if (mentions.docTotals.length > 0) {
        const sorted = [...mentions.docTotals].sort(
            (a: any, b: any) => (docTotalPriority[b.type] || 0) - (docTotalPriority[a.type] || 0),
        );
        // Per-field best-source: CMR/TTN могут не иметь cost, Invoice не имеет totalPackages/weight —
        // берём лучший источник для каждого поля независимо.
        const bestWeight = sorted.find((d: any) => d.weight > 0);
        const bestPackages = sorted.find((d: any) => d.packages > 0);
        const bestCost = sorted.find((d: any) => d.cost > 0);
        if (bestWeight) merged.mergedData.totalWeight = bestWeight.weight;
        if (bestPackages) merged.mergedData.totalPackages = bestPackages.packages;
        if (bestCost) merged.mergedData.totalCost = bestCost.cost;
    }

    // ВЫЧИСЛЯЕМ РЕАЛЬНУЮ СУММУ ТОВАРОВ (силами кода, а не ИИ)
    if (merged.mergedData.products.length > 0) {
        const actualSum = merged.mergedData.products.reduce(
            (acc: number, p: any) => acc + (parseFloat(p.cost) || 0), 0,
        );
        merged.validation.realTechnicalSum = Math.round(actualSum * 100) / 100;
    }

    // Выполняем строгую программную кросс-проверку
    runProgrammaticCrossChecks(merged);

    return merged;
}

/**
 * Сравнивает имена контрагента по ВСЕМ документам через majority vote.
 * Если есть расхождение — указывает конкретный источник и принятое имя.
 * Используется как в crossChecks.names (данные от AI), так и в validateAndMergeCounteragent.
 */
function compareNamesAllDocuments(
    checks: any,
    role: "consignee" | "consignor",
    merged: any,
): void {
    const namesObj = checks?.names?.[role];
    if (!namesObj) return;

    const entries = Object.entries(namesObj)
        .filter(([key, v]) => typeof v === "string" && (v as string).length > 2 && isRelevantCrossCheckKey(key))
        .map(([doc, name]) => ({
            doc,
            original: name as string,
            normalized: normalizeName(name as string),
        }));

    if (entries.length <= 1) return;

    // Majority vote: группируем по нормализованному имени
    const freq: Record<string, { normalized: string; original: string; docs: string[] }> = {};
    for (const e of entries) {
        if (!freq[e.normalized]) {
            freq[e.normalized] = { normalized: e.normalized, original: e.original, docs: [] };
        }
        freq[e.normalized].docs.push(e.doc);
    }

    const groups = Object.values(freq).sort((a, b) => b.docs.length - a.docs.length);
    const roleLabel = role === "consignee" ? "получателя" : "отправителя";

    if (groups.length === 1) {
        merged.validation.warnings.push({
            message: `Название ${roleLabel} совпадает во всех документах ✅`,
            severity: "SUCCESS",
        });
        return;
    }

    // Победитель — самое часто упоминаемое нормализованное имя
    const winner = groups[0];
    for (const loser of groups.slice(1)) {
        const sim = calculateSimilarity(winner.normalized, loser.normalized);
        const isTypo = sim > 0.8;
        const loserDocs = loser.docs.map((d) => getDocLabel(d)).join(", ");
        merged.validation.errors.push({
            message: isTypo
                ? `ОПЕЧАТКА У ${roleLabel.toUpperCase()}: «${loser.original}» (в ${loserDocs}) — принято «${winner.original}» (большинство документов).`
                : `КОНФЛИКТ У ${roleLabel.toUpperCase()}: «${loser.original}» (в ${loserDocs}) — принято «${winner.original}» (большинство документов).`,
            severity: "ERROR",
        });
    }
}

function runProgrammaticCrossChecks(merged: any) {
    const checks = merged.validation.crossChecks;
    const realSum = merged.validation.realTechnicalSum || 0;

    // 1. ФИНАНСЫ: сумма товаров vs invoiceTotal из AI
    const invoiceTotal = Number(checks?.finances?.invoiceTotal || 0);
    if (invoiceTotal > 0 && realSum > 0) {
        if (Math.abs(invoiceTotal - realSum) < 0.1) {
            merged.validation.warnings.push({
                message: `Финансовый итог подтвержден: сумма ${merged.mergedData.products.length} товаров (${realSum} USD) совпадает ✅`,
                severity: "SUCCESS",
            });
        } else {
            merged.validation.errors.push({
                message: `ОШИБКА В СУММЕ: В инвойсе указано ${invoiceTotal}, но сумма извлеченных товаров ${realSum}. Разница: ${(invoiceTotal - realSum).toFixed(2)}.`,
                severity: "ERROR",
            });
        }
    }

    if (!checks) return;

    // 2. ВЕС: сравнение по источникам из AI crossChecks
    if (checks.weight) {
        const values = Object.entries(checks.weight)
            .filter(([k, v]) => k !== "final" && k !== "source" && Number(v) > 0)
            .map(([k, v]) => ({ doc: getDocLabel(k), val: Number(v) }));

        if (values.length > 1) {
            const first = values[0].val;
            const allMatch = values.every((v) => v.val === first);
            if (allMatch) {
                merged.validation.warnings.push({
                    message: `Вес совпадает во всех документах: ${first} кг ✅`,
                    severity: "SUCCESS",
                });
            } else {
                const details = values.map((v) => `${v.doc}: ${v.val}`).join(", ");
                merged.validation.errors.push({
                    message: `НЕСООТВЕТСТВИЕ ВЕСА! (${details})`,
                    severity: "ERROR",
                });
            }
        }
    }

    // 3. МЕСТА: сравнение по источникам из AI crossChecks
    if (checks.packages) {
        const values = Object.entries(checks.packages)
            .filter(([k, v]) => k !== "final" && k !== "source" && Number(v) > 0)
            .map(([k, v]) => ({ doc: getDocLabel(k), val: Number(v) }));

        if (values.length > 1) {
            const first = values[0].val;
            const allMatch = values.every((v) => v.val === first);
            if (allMatch) {
                merged.validation.warnings.push({
                    message: `Количество мест совпадает: ${first} ✅`,
                    severity: "SUCCESS",
                });
            } else {
                const details = values.map((v) => `${v.doc}: ${v.val}`).join(", ");
                merged.validation.errors.push({
                    message: `НЕСООТВЕТСТВИЕ МЕСТ! (${details})`,
                    severity: "ERROR",
                });
            }
        }
    }

    // 4. ИМЕНА ПОЛУЧАТЕЛЯ: все документы, majority vote, с указанием источника
    compareNamesAllDocuments(checks, "consignee", merged);

    // 5. ИМЕНА ОТПРАВИТЕЛЯ: все документы, majority vote, с указанием источника
    compareNamesAllDocuments(checks, "consignor", merged);

    // 6. ТРАНСПОРТ: тягач
    if (checks.vehicles?.tractor) {
        const t1 = String(checks.vehicles.tractor.transportDoc || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        const t2 = String(checks.vehicles.tractor.techPassport || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        if (t1 && t2) {
            if (t1 === t2) {
                merged.validation.warnings.push({
                    message: `Номер тягача (${t1}) подтвержден техпаспортом ✅`,
                    severity: "SUCCESS",
                });
            } else {
                merged.validation.errors.push({
                    message: `НОМЕР ТЯГАЧА НЕ СОВПАДАЕТ: в СМР ${t1}, в техпаспорте ${t2}`,
                    severity: "ERROR",
                });
            }
        }
    }

    // 7. ТРАНСПОРТ: прицеп
    if (checks.vehicles?.trailer) {
        const t1 = String(checks.vehicles.trailer.transportDoc || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        const t2 = String(checks.vehicles.trailer.techPassport || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        if (t1 && t2) {
            if (t1 === t2) {
                merged.validation.warnings.push({
                    message: `Номер прицепа (${t1}) подтвержден техпаспортом ✅`,
                    severity: "SUCCESS",
                });
            } else {
                merged.validation.errors.push({
                    message: `НОМЕР ПРИЦЕПА НЕ СОВПАДАЕТ: в СМР ${t1}, в техпаспорте ${t2}`,
                    severity: "ERROR",
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // ПРОГРАММНЫЕ ПРОВЕРКИ (без участия AI)
    // ═══════════════════════════════════════════════════

    // 8. Σ quantity товаров = totalPackages (авторитетный источник: CMR > TTN > Invoice)
    const totalPackages = merged.mergedData.totalPackages || 0;
    if (totalPackages > 0 && merged.mergedData.products.length > 0) {
        const sumQty = merged.mergedData.products.reduce(
            (s: number, p: any) => s + (parseInt(String(p.quantity)) || 0), 0,
        );
        if (sumQty === totalPackages) {
            merged.validation.warnings.push({
                message: `Кол-во мест: сумма позиций (${sumQty}) = авторитетный итог (${totalPackages}) ✅`,
                severity: "SUCCESS",
            });
        } else {
            merged.validation.errors.push({
                message: `ОШИБКА КОЛ-ВА МЕСТ: сумма позиций = ${sumQty}, авторитетный итог = ${totalPackages}. Возможно AI не извлёк все товары.`,
                severity: "ERROR",
            });
        }
    }

    // 9. Σ grossWeight товаров = totalWeight (допуск 1% для округлений)
    const totalWeight = merged.mergedData.totalWeight || 0;
    if (totalWeight > 0 && merged.mergedData.products.length > 0) {
        const sumGross = merged.mergedData.products.reduce(
            (s: number, p: any) => s + (parseFloat(String(p.grossWeight)) || 0), 0,
        );
        const diff = Math.abs(sumGross - totalWeight);
        const pct = diff / totalWeight;
        if (pct < 0.01) {
            merged.validation.warnings.push({
                message: `Вес брутто: сумма позиций (${sumGross} кг) = авторитетный итог (${totalWeight} кг) ✅`,
                severity: "SUCCESS",
            });
        } else {
            merged.validation.errors.push({
                message: `ОШИБКА ВЕСА БРУТТО: сумма позиций = ${sumGross} кг, авторитетный итог = ${totalWeight} кг. Разница: ${diff.toFixed(1)} кг (${(pct * 100).toFixed(1)}%).`,
                severity: "ERROR",
            });
        }
    }

    // 10. Номер инвойса в CMR (гр.5) = document.number инвойса
    const invoiceRefInCmr = checks?.invoiceRef?.cmr;
    if (invoiceRefInCmr) {
        const invoiceDoc = merged.documents.find((d: any) => d.type === "INVOICE");
        if (invoiceDoc?.number) {
            const refClean = String(invoiceRefInCmr).trim().toUpperCase();
            const numClean = String(invoiceDoc.number).trim().toUpperCase();
            if (refClean === numClean) {
                merged.validation.warnings.push({
                    message: `Номер инвойса в CMR («${invoiceRefInCmr}») совпадает с инвойсом ✅`,
                    severity: "SUCCESS",
                });
            } else {
                merged.validation.errors.push({
                    message: `РАСХОЖДЕНИЕ НОМЕРА ИНВОЙСА: в CMR ссылка «${invoiceRefInCmr}», а документ инвойса: «${invoiceDoc.number}».`,
                    severity: "ERROR",
                });
            }
        }
    }

    // 11. Дата CMR ≥ дата инвойса (CMR не может быть составлен раньше инвойса)
    const cmrDoc = merged.documents.find((d: any) => d.type === "TRANSPORT_DOC");
    const invDocForDate = merged.documents.find((d: any) => d.type === "INVOICE");
    if (cmrDoc?.date && invDocForDate?.date) {
        const cmrDate = new Date(cmrDoc.date);
        const invDate = new Date(invDocForDate.date);
        if (!isNaN(cmrDate.getTime()) && !isNaN(invDate.getTime())) {
            if (cmrDate >= invDate) {
                merged.validation.warnings.push({
                    message: `Порядок дат корректен: CMR (${cmrDoc.date}) ≥ Инвойс (${invDocForDate.date}) ✅`,
                    severity: "SUCCESS",
                });
            } else {
                merged.validation.errors.push({
                    message: `ОШИБКА ДАТ: CMR (${cmrDoc.date}) составлен раньше инвойса (${invDocForDate.date}). CMR не может быть оформлен до инвойса.`,
                    severity: "ERROR",
                });
            }
        }
    }

    // 12. Страна отправителя (addresses[0]) = departureCountry
    const consignorCountry = (
        merged.mergedData.counteragents.consignor?.addresses?.[0]?.countryCode || ""
    ).toUpperCase();
    const departureCountry = (merged.mergedData.countries.departureCountry || "").toUpperCase();
    if (consignorCountry && departureCountry) {
        if (consignorCountry === departureCountry) {
            merged.validation.warnings.push({
                message: `Страна отправителя (${consignorCountry}) совпадает со страной отправки ✅`,
                severity: "SUCCESS",
            });
        } else {
            merged.validation.warnings.push({
                message: `⚠️ Страна отправителя (${consignorCountry}) ≠ стране отправки (${departureCountry}). Возможен транзит — проверьте маршрут.`,
                severity: "WARNING",
            });
        }
    }

    // 14. Σ cost товаров = totalCost (авторитетный источник: Invoice > PackingList)
    const totalCost = merged.mergedData.totalCost || 0;
    if (totalCost > 0 && realSum > 0) {
        const diff = Math.abs(realSum - totalCost);
        const pct = diff / totalCost;
        if (pct < 0.01) {
            merged.validation.warnings.push({
                message: `Стоимость: сумма позиций (${realSum} USD) совпадает с документом (${totalCost} USD) ✅`,
                severity: "SUCCESS",
            });
        } else {
            merged.validation.errors.push({
                message: `ОШИБКА СТОИМОСТИ: сумма позиций = ${realSum} USD, авторитетный итог = ${totalCost} USD. Разница: ${diff.toFixed(2)} USD (${(pct * 100).toFixed(1)}%).`,
                severity: "ERROR",
            });
        }
    }

    // 13. Страна получателя (addresses[0]) = destinationCountry
    const consigneeCountry = (
        merged.mergedData.counteragents.consignee?.addresses?.[0]?.countryCode || ""
    ).toUpperCase();
    const destinationCountry = (merged.mergedData.countries.destinationCountry || "").toUpperCase();
    if (consigneeCountry && destinationCountry) {
        if (consigneeCountry === destinationCountry) {
            merged.validation.warnings.push({
                message: `Страна получателя (${consigneeCountry}) совпадает со страной назначения ✅`,
                severity: "SUCCESS",
            });
        } else {
            merged.validation.warnings.push({
                message: `⚠️ Страна получателя (${consigneeCountry}) ≠ стране назначения (${destinationCountry}). Проверьте данные.`,
                severity: "WARNING",
            });
        }
    }
}

/**
 * Мержит контрагента с majority vote по именам.
 * Если имена в разных документах расходятся — берётся наиболее часто встречающееся,
 * а конфликт записывается в validation.warnings с указанием конкретного источника.
 */
function validateAndMergeCounteragent(merged: any, role: string, roleMentions: any[]) {
    const empty = {
        present: false,
        entityType: "LEGAL",
        legal: { bin: "", nameRu: "" },
        nonResidentLegal: { nameRu: "" },
        addresses: [],
    };
    if (roleMentions.length === 0) {
        merged.mergedData.counteragents[role] = empty;
        return;
    }

    const roleNames: any = {
        consignee: "получателя",
        consignor: "отправителя",
        carrier: "перевозчика",
        declarant: "декларанта",
    };
    const roleName = roleNames[role] || role;

    // Выбираем наиболее полную запись (с BIN и адресом)
    const pickBest = (mentions: any[]): any => {
        const sorted = [...mentions].sort((a: any, b: any) => {
            const sa = (a.data.legal?.bin ? 10 : 0) + (a.data.addresses?.length ? 5 : 0);
            const sb = (b.data.legal?.bin ? 10 : 0) + (b.data.addresses?.length ? 5 : 0);
            return sb - sa;
        });
        return sorted[0].data;
    };

    // Majority vote: группируем упоминания по нормализованному имени
    const freq: Record<string, { normalized: string; mentions: any[] }> = {};
    for (const mention of roleMentions) {
        const raw = (mention.data.legal?.nameRu || mention.data.nonResidentLegal?.nameRu || "")
            .toUpperCase()
            .trim();
        const norm = normalizeName(raw);
        const key = norm || "__EMPTY__";
        if (!freq[key]) freq[key] = { normalized: norm, mentions: [] };
        freq[key].mentions.push(mention);
    }

    const groups = Object.values(freq)
        .filter((g) => g.normalized)
        .sort((a, b) => b.mentions.length - a.mentions.length);

    if (groups.length === 0) {
        // Нет имён — берём первый по полноте
        const best = pickBest(roleMentions);
        merged.mergedData.counteragents[role] = {
            present: true,
            entityType: best.entityType || "LEGAL",
            legal: best.legal || { bin: "", nameRu: "" },
            nonResidentLegal: best.nonResidentLegal || { nameRu: "" },
            addresses: best.addresses || [],
        };
        return;
    }

    const winner = groups[0];

    // Репортируем конфликты — указываем конкретный источник и принятое имя
    for (const loser of groups.slice(1)) {
        const sim = calculateSimilarity(winner.normalized, loser.normalized);
        const isTypo = sim > 0.85;
        const loserName =
            loser.mentions[0].data.legal?.nameRu ||
            loser.mentions[0].data.nonResidentLegal?.nameRu || "";
        const winnerName =
            winner.mentions[0].data.legal?.nameRu ||
            winner.mentions[0].data.nonResidentLegal?.nameRu || "";
        const loserSources = loser.mentions.map((m: any) => m.source).join(", ");

        merged.validation.warnings.push({
            field: `${role}.name`,
            message: isTypo
                ? `⚠️ ОПЕЧАТКА У ${roleName.toUpperCase()}: «${loserName}» (${loserSources}) — принято «${winnerName}» (большинство).`
                : `⚠️ КОНФЛИКТ У ${roleName.toUpperCase()}: «${loserName}» (${loserSources}) — принято «${winnerName}» (большинство).`,
            severity: "WARNING",
        });
    }

    // Выбираем лучшую запись из группы победителей
    const best = pickBest(winner.mentions);
    merged.mergedData.counteragents[role] = {
        present: true,
        entityType: best.entityType || "LEGAL",
        legal: best.legal || { bin: "", nameRu: "" },
        nonResidentLegal: best.nonResidentLegal || { nameRu: "" },
        addresses: best.addresses || [],
    };
}

function handleVehicles(merged: any, mentions: any[]) {
    if (!mentions.length) return;
    const best = mentions.find((m) => m.docType === "VEHICLE_DOC") || mentions[0];
    merged.mergedData.vehicles = { ...best.data };
}

function handleDriver(merged: any, mentions: any[]) {
    if (!mentions.length) return;
    const best = mentions.find((m) => m.docType === "DRIVER_ID") || mentions[0];
    merged.mergedData.driver = { ...best.data, present: true };
}
