import { normalizeName, calculateSimilarity } from "./utils.ts";

/**
 * Объединяет результаты всех файл-агентов в единый объект Keden PI.
 */
export function mergeAgentResults(agentResults: any[]) {
    const merged: any = {
        documents: [],
        validation: { errors: [], warnings: [] },
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
        },
    };

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
            "OTHER": "Документ"
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

        // Собираем контрагентов
        if (result.consignor?.present) mentions.consignor.push({ source: sourceLabel, docType, data: result.consignor });
        if (result.consignee?.present) mentions.consignee.push({ source: sourceLabel, docType, data: result.consignee });
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

        // Сохраняем кросс-валидацию от ИИ
        if (result.validation) {
            if (Array.isArray(result.validation.warnings)) {
                const nw = result.validation.warnings.map((w: any) => typeof w === 'string' ? { message: w, severity: "WARNING" } : w);
                merged.validation.warnings.push(...nw);
            }
            if (Array.isArray(result.validation.errors)) {
                const ne = result.validation.errors.map((e: any) => typeof e === 'string' ? { message: e, severity: "ERROR" } : e);
                merged.validation.errors.push(...ne);
            }
            if (result.validation.crossChecks) {
                merged.validation.crossChecks = { ...(merged.validation.crossChecks || {}), ...result.validation.crossChecks };
            }
        }
    }

    // Мерж стран
    if (mentions.countries.length > 0) {
        const best = mentions.countries.find((m: any) => m.source.includes("CMR")) || mentions.countries[0];
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

    // Мерж контрагентов
    for (const role of ["consignor", "consignee", "carrier", "declarant"]) {
        validateAndMergeCounteragent(merged, role, mentions[role]);
    }

    // Транспорт и водитель (упрощено для Deno)
    handleVehicles(merged, mentions.vehicles);
    handleDriver(merged, mentions.driver);

    // ВЫЧИСЛЯЕМ РЕАЛЬНУЮ СУММУ ТОВАРОВ (Силами кода, а не ИИ)
    if (merged.mergedData.products.length > 0) {
        const actualSum = merged.mergedData.products.reduce((acc: number, p: any) => acc + (parseFloat(p.cost) || 0), 0);
        merged.validation.realTechnicalSum = Math.round(actualSum * 100) / 100;
    }

    // Выполняем строгую программную кросс-проверку (Option C)
    runProgrammaticCrossChecks(merged);

    return merged;
}

function runProgrammaticCrossChecks(merged: any) {
    const checks = merged.validation.crossChecks;
    const realSum = merged.validation.realTechnicalSum || 0;

    const getDocLabel = (key: string) => {
        const labels: any = {
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
            "declarant": "Декларант"
        };
        const lowKey = key.toLowerCase();
        return labels[lowKey] || labels[key] || key;
    };

    // 1. ПРОВЕРКА ФИНАНСОВ
    const invoiceTotal = Number(checks?.finances?.invoiceTotal || 0);

    if (invoiceTotal > 0 && realSum > 0) {
        if (Math.abs(invoiceTotal - realSum) < 0.1) {
            merged.validation.warnings.push({
                message: `Финансовый итог подтвержден: сумма ${merged.mergedData.products.length} товаров (${realSum} USD) совпадает ✅`,
                severity: "SUCCESS"
            });
        } else {
            merged.validation.errors.push({
                message: `ОШИБКА В СУММЕ: В инвойсе указано ${invoiceTotal}, но сумма извлеченных товаров ${realSum}. Разница: ${(invoiceTotal - realSum).toFixed(2)}.`,
                severity: "ERROR"
            });
        }
    }

    if (!checks) return;

    // 2. ПРОВЕРКА ВЕСА
    if (checks.weight) {
        const values = Object.entries(checks.weight)
            .filter(([k, v]) => k !== 'final' && k !== 'source' && Number(v) > 0)
            .map(([k, v]) => ({ doc: getDocLabel(k), val: Number(v) }));

        if (values.length > 1) {
            const first = values[0].val;
            const allMatch = values.every(v => v.val === first);
            if (allMatch) {
                merged.validation.warnings.push({
                    message: `Вес совпадает во всех документах: ${first} кг ✅`,
                    severity: "SUCCESS"
                });
            } else {
                const details = values.map(v => `${v.doc}: ${v.val}`).join(", ");
                merged.validation.errors.push({
                    message: `НЕСООТВЕТСТВИЕ ВЕСА! (${details})`,
                    severity: "ERROR"
                });
            }
        }
    }

    // 3. ПРОВЕРКА МЕСТ (PACKAGES)
    if (checks.packages) {
        const values = Object.entries(checks.packages)
            .filter(([k, v]) => k !== 'final' && k !== 'source' && Number(v) > 0)
            .map(([k, v]) => ({ doc: getDocLabel(k), val: Number(v) }));

        if (values.length > 1) {
            const first = values[0].val;
            const allMatch = values.every(v => v.val === first);
            if (allMatch) {
                merged.validation.warnings.push({
                    message: `Количество мест совпадает: ${first} ✅`,
                    severity: "SUCCESS"
                });
            } else {
                const details = values.map(v => `${v.doc}: ${v.val}`).join(", ");
                merged.validation.errors.push({
                    message: `НЕСООТВЕТСТВИЕ МЕСТ! (${details})`,
                    severity: "ERROR"
                });
            }
        }
    }

    // 4. ПРОВЕРКА ИМЕН (Consignee)
    if (checks.names?.consignee) {
        const names = Object.entries(checks.names.consignee)
            .filter(([_, v]) => typeof v === 'string' && v.length > 2)
            .map(([k, v]) => ({ doc: k, original: v as string, normalized: normalizeName(v as string) }));

        if (names.length > 1) {
            const first = names[0];
            const allExactMatch = names.every(n => n.normalized === first.normalized);

            if (allExactMatch) {
                merged.validation.warnings.push({
                    message: `Название получателя совпадает во всех документах ✅`,
                    severity: "SUCCESS"
                });
            } else {
                // ПРОВЕРКА НА ОПЕЧАТКУ: если очень похожи (напр. TAMING vs TMING)
                const similarity = calculateSimilarity(names[0].normalized, names[1].normalized);
                if (similarity > 0.8) {
                    merged.validation.errors.push({
                        message: `ПОДОЗРЕНИЕ НА ОПЕЧАТКУ В ПОЛУЧАТЕЛЕ: "${names[0].original}" vs "${names[1].original}" (разница в символах!). Проверьте внимательно!`,
                        severity: "ERROR"
                    });
                } else {
                    merged.validation.errors.push({
                        message: `РАСХОЖДЕНИЕ В ИМЕНИ ПОЛУЧАТЕЛЯ: ${names.map(n => `${n.doc}: "${n.original}"`).join(" vs ")}`,
                        severity: "ERROR"
                    });
                }
            }
        }
    }

    // 5. ПРОВЕРКА ИМЕН (Consignor)
    if (checks.names?.consignor) {
        const names = Object.entries(checks.names.consignor)
            .filter(([_, v]) => typeof v === 'string' && v.length > 2)
            .map(([k, v]) => ({ doc: k, original: v as string, normalized: normalizeName(v as string) }));

        if (names.length > 1) {
            const first = names[0];
            const allExactMatch = names.every(n => n.normalized === first.normalized);

            if (allExactMatch) {
                merged.validation.warnings.push({
                    message: `Название отправителя совпадает во всех документах ✅`,
                    severity: "SUCCESS"
                });
            } else {
                // ПРОВЕРКА НА ОПЕЧАТКУ (напр. TAMING vs TMING)
                const similarity = calculateSimilarity(names[0].normalized, names[1].normalized);
                if (similarity > 0.8) {
                    merged.validation.errors.push({
                        message: `ПОДОЗРЕНИЕ НА ОПЕЧАТКУ В ОТПРАВИТЕЛЕ: "${names[0].original}" vs "${names[1].original}" (пропущена буква?).`,
                        severity: "ERROR"
                    });
                } else {
                    merged.validation.errors.push({
                        message: `РАСХОЖДЕНИЕ У ОТПРАВИТЕЛЯ: ${names.map(n => `${n.doc}: "${n.original}"`).join(" vs ")}`,
                        severity: "ERROR"
                    });
                }
            }
        }
    }

    // 6. ПРОВЕРКА ТРАНСПОРТА (Тягач)
    if (checks.vehicles?.tractor) {
        const t1 = String(checks.vehicles.tractor.transportDoc || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        const t2 = String(checks.vehicles.tractor.techPassport || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        if (t1 && t2) {
            if (t1 === t2) {
                merged.validation.warnings.push({
                    message: `Номер тягача (${t1}) подтвержден техпаспортом ✅`,
                    severity: "SUCCESS"
                });
            } else {
                merged.validation.errors.push({
                    message: `НОМЕР ТЯГАЧА НЕ СОВПАДАЕТ: в СМР ${t1}, в техпаспорте ${t2}`,
                    severity: "ERROR"
                });
            }
        }
    }

    // 7. ПРОВЕРКА ТРАНСПОРТА (Прицеп)
    if (checks.vehicles?.trailer) {
        const t1 = String(checks.vehicles.trailer.transportDoc || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        const t2 = String(checks.vehicles.trailer.techPassport || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        if (t1 && t2) {
            if (t1 === t2) {
                merged.validation.warnings.push({
                    message: `Номер прицепа (${t1}) подтвержден техпаспортом ✅`,
                    severity: "SUCCESS"
                });
            } else {
                merged.validation.errors.push({
                    message: `НОМЕР ПРИЦЕПА НЕ СОВПАДАЕТ: в СМР ${t1}, в техпаспорте ${t2}`,
                    severity: "ERROR"
                });
            }
        }
    }
}

function validateAndMergeCounteragent(merged: any, role: string, roleMentions: any[]) {
    if (roleMentions.length === 0) {
        merged.mergedData.counteragents[role] = { present: false, entityType: "LEGAL", legal: { bin: "", nameRu: "" }, nonResidentLegal: { nameRu: "" }, addresses: [] };
        return;
    }

    const uniqueNames = [...new Set(roleMentions.map((m: any) => (m.data.legal?.nameRu || m.data.nonResidentLegal?.nameRu || "").toUpperCase().trim()))].filter(Boolean);

    if (uniqueNames.length > 1) {
        const norm1 = normalizeName(uniqueNames[0]);
        const norm2 = normalizeName(uniqueNames[1]);

        if (norm1 !== norm2) {
            const sim = calculateSimilarity(norm1, norm2);
            const isTypo = sim > 0.85;

            const roleNames: any = {
                consignee: "получателя",
                consignor: "отправителя",
                carrier: "перевозчика",
                declarant: "декларанта"
            };
            const roleName = roleNames[role] || role;

            merged.validation.warnings.push({
                field: `${role}.name`,
                message: isTypo
                    ? `⚠️ НАЙДЕНА ОПЕЧАТКА: Данные ${roleName} различаются («${uniqueNames[0]}» vs «${uniqueNames[1]}»).`
                    : `⚠️ КОНФЛИКТ: Название ${roleName} отличается в разных документах.`,
                severity: "WARNING",
            });
        }
    }

    // Берем самый "полный" результат
    roleMentions.sort((a, b) => {
        let sa = (a.data.legal?.bin ? 10 : 0) + (a.data.addresses?.length ? 5 : 0);
        let sb = (b.data.legal?.bin ? 10 : 0) + (b.data.addresses?.length ? 5 : 0);
        return sb - sa;
    });

    const best = roleMentions[0].data;
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
    const best = mentions.find(m => m.docType === "VEHICLE_DOC") || mentions[0];
    merged.mergedData.vehicles = { ...best.data };
}

function handleDriver(merged: any, mentions: any[]) {
    if (!mentions.length) return;
    const best = mentions.find(m => m.docType === "DRIVER_ID") || mentions[0];
    merged.mergedData.driver = { ...best.data, present: true };
}
