/**
 * KEDEN Extension - MAIN (Content Script Entry Point)
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'FILL_PI_DATA') {
        fillCounteragents(request.data)
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                console.error('Fill Error:', err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }
});

/** Helper to sync with React state (as per TЗ 3.1) */
function setReactValue(element, value) {
    if (!element) return;
    const lastValue = element.value;
    element.value = value;
    const event = new Event('input', { bubbles: true });
    // Support React 16+
    const tracker = element._valueTracker;
    if (tracker) {
        tracker.setValue(lastValue);
    }
    element.dispatchEvent(event);
}

/** Converts DD.MM.YYYY to YYYY-MM-DD (as per TЗ 3.3) */
function formatToISODate(dateStr) {
    if (!dateStr) return null;
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
    const parts = dateStr.match(/(\d{2})[./](\d{2})[./](\d{4})/);
    if (parts) {
        return `${parts[3]}-${parts[2]}-${parts[1]}`;
    }
    return dateStr;
}

async function fillCounteragents(params) {
    console.log('🧪 DEBUG: Starting counteragents fill');

    const match = window.location.href.match(/declarations\/PI\/\d+\/([A-Z0-9]+)/);
    if (!match) throw new Error("Откройте страницу ПИ");
    const declId = match[1];

    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) throw new Error("Не найден токен авторизации");
    const token = JSON.parse(authStorage).state.token.access_token;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const counteragents = params && params.counteragents ? params.counteragents : {};

    // ОБОГАЩЕНИЕ ДАННЫХ (FETCH BY BIN)
    await processCounteragentEnrichment(counteragents.consignee, headers);
    await processCounteragentEnrichment(counteragents.carrier, headers);
    await processCounteragentEnrichment(counteragents.declarant, headers);
    await processCounteragentEnrichment(counteragents.filler, headers);

    // ОБРАБОТКА ТРАНСПОРТА (Vehicle Number)
    if (params.vehicles && params.vehicles.tractorRegNumber) {
        console.log('🚛 DEBUG: Updating vehicle data');
        try {
            const currentDecl = await getPIDeclaration(declId, headers);
            const vehicleAtBorderData = buildVehiclePayload(params.vehicles);

            if (vehicleAtBorderData) {
                // Сохраняем остальные поля декларации, меняем только транспорт в vehicleAtBorder
                currentDecl.productsTransportation = {
                    ...currentDecl.productsTransportation,
                    vehicleAtBorder: {
                        ...currentDecl.productsTransportation?.vehicleAtBorder,
                        ...vehicleAtBorderData
                    }
                };

                await updatePIDeclaration(declId, currentDecl, headers);
                console.log('✅ Vehicle data updated successfully');
            }
        } catch (vehErr) {
            console.error('❌ Vehicle update failed:', vehErr);
            // Не прерываем основной процесс из-за транспорта
        }
    }

    // ОБРАБОТКА ТАМОЖЕННЫХ ПОСТОВ И ВИДОВ ТРАНСПОРТА (Справочник)
    if (params.shipping && (params.shipping.customsCode || params.shipping.transportMode)) {
        console.log('🏛️ DEBUG: Updating Customs/Transport settings');
        try {
            const currentDecl = await getPIDeclaration(declId, headers);
            let updated = false;

            if (params.shipping.customsCode) {
                const customsData = await fetchCustomsByCode(params.shipping.customsCode, headers);
                if (customsData) {
                    currentDecl.customs = customsData;
                    updated = true;
                    console.log('✅ Customs data fetched');
                }
            }

            if (params.shipping.transportMode) {
                const transportData = await fetchTransportModeByCode(params.shipping.transportMode, headers);
                if (transportData) {
                    const dictCode = transportData.dictionaryDto?.code;
                    if (dictCode === 'pi_vehicle_type_classifier') {
                        currentDecl.vehicleType = transportData;
                        console.log('✅ Root vehicleType updated');
                    } else {
                        if (!currentDecl.productsTransportation) {
                            currentDecl.productsTransportation = { containerTransportation: false, matchesVehicleAtBorder: false };
                        }
                        if (!currentDecl.productsTransportation.vehicleAtBorder) {
                            currentDecl.productsTransportation.vehicleAtBorder = { transportMeansQuantity: 0, vehicles: [], routePoints: [], multimodalitySign: false };
                        }
                        currentDecl.productsTransportation.vehicleAtBorder.vehicleType = transportData;
                        console.log('✅ Border vehicleType updated');
                    }
                    updated = true;
                }
            }

            if (updated) {
                await updatePIDeclaration(declId, currentDecl, headers);
                console.log('✅ Declaration updated with Customs/Transport data');
            }
        } catch (err) {
            console.error('❌ Customs/Transport update failed:', err);
        }
    }

    const hasConsignmentAgents = Boolean(counteragents.consignor?.present || counteragents.consignee?.present);
    const hasProducts = Boolean(params.products && params.products.length > 0);

    let consignmentId = null;
    if (hasConsignmentAgents || hasProducts) {
        const consignmentPayload = {
            preliminaryId: declId,
            indexOrder: 0
        };

        if (params.countries) {
            if (params.countries.departureCountry) {
                const dep = mapCountryCode(params.countries.departureCountry);
                if (dep) consignmentPayload.departureCountry = dep;
            }
            if (params.countries.destinationCountry) {
                const dest = mapCountryCode(params.countries.destinationCountry);
                if (dest) consignmentPayload.destinationCountry = dest;
            }
        }

        // 1. Create Consignment first (Stage 1 of creation)
        const consResp = await fetch(`${PI_API}/consignment`, {
            method: 'POST',
            headers,
            body: JSON.stringify(consignmentPayload)
        });

        if (!consResp.ok) {
            throw new Error("Не удалось создать партию (Consignment)");
        }

        const consText = await consResp.text();
        const consignment = JSON.parse(consText);
        consignmentId = consignment.id;
        console.log("Created Consignment ID:", consignmentId);

        // 2. Map Transport Document (Stage 1: create doc record)
        // (as per TЗ 4.1: POST creates record and returns its id)
        const docs = params.documents || [];
        const typeToCode = { 'INVOICE': '04021', 'TRANSPORT_DOC': '02015', 'REGISTRY': '09011' };
        let mainDoc = docs.find(d => typeToCode[d.type] === '02015' || d.type === '02015');
        if (!mainDoc) mainDoc = docs.find(d => typeToCode[d.type] === '09011' || d.type === '09011');

        // Fallback to registry info if no main doc found
        if (!mainDoc && params.registry && params.registry.number) {
            mainDoc = { type: 'REGISTRY', number: params.registry.number, date: params.registry.date };
        }

        if (mainDoc) {
            const docCode = typeToCode[mainDoc.type] || mainDoc.type;
            const docTypes = await fetchDocumentTypes(headers);
            const typeInfo = docTypes.find(t => t.code === docCode);

            if (typeInfo) {
                const docPayload = {
                    documentType: typeInfo,
                    docNumber: mainDoc.number || "Б/Н",
                    docDate: formatToISODate(mainDoc.date) || new Date().toISOString().split('T')[0]
                };

                console.log("📡 Creating Transport Document record (TЗ Stage 1)...");
                const createdDoc = await postDocument(consignmentId, docPayload, headers);

                if (createdDoc && createdDoc.id) {
                    console.log("🔗 Binding Transport Document to Consignment (TЗ Stage 2)...");
                    // Update consignment with the newly created document
                    const updateConsignmentPayload = {
                        ...consignment,
                        transportDocument: createdDoc
                    };

                    // Add summary if products are present
                    if (hasProducts) {
                        const products = params.products;
                        const totalWeight = products.reduce((sum, p) => sum + (parseFloat(p.grossWeight) || 0), 0);
                        const totalQty = products.reduce((sum, p) => sum + (parseFloat(p.quantity) || 0), 0);
                        const totalCost = products.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
                        const currency = products[0]?.currencyCode || 'USD';

                        updateConsignmentPayload.consignmentSummary = {
                            totalGoodsQuantity: products.length,
                            totalPackageQuantity: totalQty,
                            totalGrossWeight: parseFloat(totalWeight.toFixed(2)),
                            totalAmount: {
                                amount: parseFloat(totalCost.toFixed(2)),
                                currencyCode: currency
                            }
                        };
                    }

                    await fetch(`${PI_API}/consignment/${consignmentId}`, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify(updateConsignmentPayload)
                    });
                    console.log("✅ Transport document linked successfully");
                }
            }
        }

        await new Promise(r => setTimeout(r, 600));
    }

    const requests = [];

    // Универсальная функция проверки БИН/ИИН
    const validateResidentInfo = (payload, label) => {
        if (!payload) return;

        // Если это нерезидент - пропускаем проверку БИН/ИИН
        if (payload.entityType?.includes("NON_RESIDENT")) return;

        if (payload.entityType === "LEGAL") {
            const bin = payload.legal?.bin;
            if (!bin) return; // Пропускаем если пусто (может заполнят вручную)
            if (bin.length !== 12) {
                console.warn(`${label}: БИН имеет неверную длину (${bin.length})`);
                // Можно бросать ошибку, если мы УВЕРЕНЫ что это резидент РК
                // throw new Error(`${label}: БИН должен быть ровно 12 цифр`);
            }
        }
        if (payload.entityType === "PERSON" || payload.entityType === "INDIVIDUAL") {
            const iin = payload.person?.iin;
            if (!iin) return;
            if (iin.length !== 12) {
                console.warn(`${label}: ИИН имеет неверную длину (${iin.length})`);
            }
        }
    };

    const consignorPayload = buildCounteragentPayload(counteragents.consignor, {
        type: "CONSIGNOR",
        targetId: consignmentId,
        targetType: "CONSIGNMENT",
        sellerEqualIndicator: true,
        buyerEqualIndicator: false,
        indexOrder: 0
    });
    if (consignorPayload) {
        validateResidentInfo(consignorPayload, "Отправитель");
        requests.push(consignorPayload);
    }

    const consigneePayload = buildCounteragentPayload(counteragents.consignee, {
        type: "CONSIGNEE",
        targetId: consignmentId,
        targetType: "CONSIGNMENT",
        sellerEqualIndicator: false,
        buyerEqualIndicator: true,
        indexOrder: 0
    });
    if (consigneePayload) {
        validateResidentInfo(consigneePayload, "Получатель");
        requests.push(consigneePayload);
    }

    const carrierPayload = buildCounteragentPayload(counteragents.carrier, {
        type: "CARRIER",
        targetId: declId,
        targetType: "PRELIMINARY",
        indexOrder: 0,
        sellerEqualIndicator: false,
        buyerEqualIndicator: false,
        headOrg: {},
        roleCounteragent: {
            id: 2031, // REVERTED TO 2031 (EU CARRIER)
            code: "CARRIER",
            ru: "Перевозчик ЕС"
        }
    });
    if (carrierPayload) {
        validateResidentInfo(carrierPayload, "Перевозчик");
        requests.push(carrierPayload);
    }

    // 5. Двойная проверка Декларанта и Заполнителя (TЗ п.5)
    let existingDeclarant = null;
    let existingFiller = null;
    try {
        const fullDecl = await getPIDeclaration(declId, headers);
        if (fullDecl && fullDecl.counteragents) {
            existingDeclarant = fullDecl.counteragents.find(c => c.type === 'DECLARANT');
            existingFiller = fullDecl.counteragents.find(c => c.type === 'FILLER_DECLARANT');
        }
    } catch (e) {
        console.warn("Failed to check existing counteragents:", e);
    }

    const declarantPayload = buildCounteragentPayload(counteragents.declarant, {
        type: "DECLARANT",
        targetId: declId,
        targetType: "PRELIMINARY",
        indexOrder: 1,
        sellerEqualIndicator: false,
        buyerEqualIndicator: false,
        headOrg: {},
        roleCounteragent: {
            id: 2024,
            code: "DECLARANT",
            ru: "Декларант"
        }
    });

    if (declarantPayload) {
        if (existingDeclarant) {
            console.log("ℹ️ Declarant already exists, skipping creation to avoid duplicates.");
        } else {
            validateResidentInfo(declarantPayload, "Декларант");
            requests.push(declarantPayload);
        }
    }

    const fillerPayload = buildCounteragentPayload(counteragents.filler, {
        type: "FILLER_DECLARANT",
        targetId: declId,
        targetType: "PRELIMINARY",
        roleCounteragent: {
            code: "FILLER",
            ru: "Лицо, заполнившее"
        }
    });
    if (fillerPayload) {
        if (existingFiller) {
            console.log("ℹ️ Filler Declarant already exists, skipping.");
        } else {
            validateResidentInfo(fillerPayload, "Заполнитель");
            requests.push(fillerPayload);
        }
    }

    if (requests.length === 0) {
        console.warn("No (new) counteragents found to upload");
    }

    const responses = [];
    for (const payload of requests) {
        // Динамическое обогащение documentType.id по коду для декларанта/заполнителя
        if ((payload.type === 'DECLARANT' || payload.type === 'FILLER_DECLARANT') && payload.registerDocument) {
            try {
                const docTypes = await fetchDocumentTypes(headers);
                const code = payload.registerDocument.documentType?.code;
                const match = docTypes.find(t => t.code === code);
                if (match) {
                    payload.registerDocument.documentType = {
                        id: match.id,
                        code: match.code,
                        ru: match.ru
                    };
                }
            } catch (e) {
                console.warn("Failed to enrich registerDocument type info:", e);
            }
        }

        const resp = await sendCounteragent(payload, headers);
        responses.push(resp);

        // Если это Декларант и у него есть свидетельство - обрабатываем в 2 этапа (TЗ п.4)
        if ((payload.type === 'DECLARANT' || payload.type === 'FILLER_DECLARANT') && payload.registerDocument) {
            let declarantId = null;
            if (Array.isArray(resp)) {
                const decl = resp.find(c => c.type === payload.type);
                declarantId = decl ? decl.id : null;
            } else if (resp && resp.id) {
                declarantId = resp.id;
            }

            if (declarantId) {
                console.log('📄 Processing declarant registerDocument (TЗ Stage 1)...', declarantId);
                try {
                    // 1. Создаем документ декларации (TЗ п.4.1)
                    const docResp = await postPreliminaryDocument(declId, payload.registerDocument, headers);
                    if (docResp && docResp.id) {
                        console.log('✅ Register document created:', docResp.id);

                        // 2. Привязываем документ к декларанту/заполнителю через PUT (TЗ п.4.2)
                        // ВАЖНО: HAR показывает, что для заполнителя документ полномочий идет в powerOfAttorneyDocument
                        const isFiller = payload.type === 'FILLER_DECLARANT';
                        const updatePayload = {
                            ...payload,
                            id: declarantId
                        };

                        if (isFiller) {
                            updatePayload.powerOfAttorneyDocument = docResp;
                        } else {
                            updatePayload.registerDocument = docResp;
                        }

                        console.log(`📡 Linked ${payload.type} with documentation (${isFiller ? 'POA' : 'Cert'})`);
                        await updateCounteragent(declarantId, updatePayload, headers);
                    }
                } catch (docErr) {
                    console.error('❌ Declarant register document processing failed:', docErr);
                }
            }
        }

        // Если это Перевозчик и у нас есть данные водителя - добавляем водителя
        if (payload.type === 'CARRIER' && params.driver && (params.driver.iin || params.driver.lastName)) {
            // API возвращает массив всех контрагентов после добавления. Нам нужен ID именно перевозчика.
            let carrierId = null;
            if (Array.isArray(resp)) {
                const carrier = resp.find(c => c.type === 'CARRIER');
                carrierId = carrier ? carrier.id : null;
            } else if (resp && resp.id) {
                carrierId = resp.id;
            }

            if (carrierId) {
                console.log('👤 DEBUG: Adding driver to carrier', carrierId);
                try {
                    const driverPayload = buildDriverPayload(params.driver, carrierId);
                    if (driverPayload) {
                        await postRepresentative(driverPayload, headers);
                        console.log('✅ Driver added successfully');
                    }
                } catch (driverErr) {
                    console.error('❌ Driver add failed:', driverErr);
                    // Продолжаем работу, даже если водитель не добавился
                }
            } else {
                console.warn('⚠️ Warning: Carrier ID not found in response, skipping driver.');
            }
        }

        // Небольшая задержка, чтобы сервер успел обработать индексы
        await new Promise(r => setTimeout(r, 800));
    }
    console.log("Counteragents created:", responses);


    // ОБРАБОТКА ТОВАРОВ
    let createdProductIds = [];
    if (params.products && params.products.length > 0 && consignmentId) {
        console.log('📦 DEBUG: Importing products');
        try {
            const productsPayload = mapProductsPayload(params.products);
            const importedProducts = await importProducts(consignmentId, productsPayload, headers);
            if (Array.isArray(importedProducts)) {
                createdProductIds = importedProducts.map(p => p.id);
            }
            console.log('✅ Products imported successfully', createdProductIds);
        } catch (prodErr) {
            console.error('❌ Product import failed:', prodErr);
            alert("Ошибка при импорте товаров: " + prodErr.message);
        }
    }

    // ОБРАБОТКА ДОКУМЕНТОВ 44 ГРАФЫ (Box 44 Automation)
    await processBox44Documents(consignmentId, params, createdProductIds, headers);

    // ОБРАБОТКА ФАЙЛА РЕЕСТРА (Legacy/Manual Upload support)
    if (params.registryDocument && params.registryDocument.fileBase64 && consignmentId) {
        // ... (existing registry document logic refined in processBox44)
    }

    alert("Данные успешно отправлены. Страница будет перезагружена.");
    window.location.reload();
}

async function processBox44Documents(consignmentId, params, productIds, headers) {
    console.log('📑 DEBUG: Automating Box 44 Documents');

    // Combine documents from Gemini analysis and mergedData
    const docsToCreate = [];

    // Docs from analysis
    if (params.documents && Array.isArray(params.documents)) {
        params.documents.forEach(d => {
            let code = d.type; // По умолчанию считаем, что это код (из UI)

            // Если это старый формат (слово), маппим его
            if (d.type === 'INVOICE') code = '04021';
            else if (d.type === 'TRANSPORT_DOC') code = '02015';
            else if (d.type === 'REGISTRY') code = '09011';
            else if (d.type === 'POWER_OF_ATTORNEY') code = '09024';
            else if (d.type === 'OTHER') code = '11005';

            // Если код пустой или '00000', пропускаем (или можно сделать обработку 'Другое')
            if (code && code !== '00000') {
                docsToCreate.push({
                    code: code,
                    number: d.number || "Б/Н",
                    date: d.date || new Date().toISOString().split('T')[0],
                    name: d.type,
                    filename: d.filename
                });
            }
        });
    }

    // Registry from mergedData
    if (params.registry && params.registry.number) {
        // Avoid duplicates if already in documents array
        if (!docsToCreate.some(d => d.code === '09011')) {
            docsToCreate.push({
                code: '09011',
                number: params.registry.number,
                date: params.registry.date || new Date().toISOString().split('T')[0],
                name: 'РЕЕСТР'
            });
        }
    }

    if (docsToCreate.length === 0) return;

    try {
        const docTypes = await fetchDocumentTypes(headers);
        const rawFiles = params.rawFiles || [];

        for (const doc of docsToCreate) {
            const typeInfo = docTypes.find(t => t.code === doc.code);
            if (!typeInfo) {
                console.warn(`⚠️ Warning: Doc type ${doc.code} not found in classifier, skipping.`);
                continue;
            }

            let attachedFiles = [];

            // Пытаемся найти файл и загрузить его, если он не таблица
            const matchingFile = rawFiles.find(f => f.name === doc.filename);
            if (matchingFile && matchingFile.base64) {
                const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(matchingFile.name);
                if (!isSpreadsheet) {
                    // Avoid double-uploading if this is already the Transport Document record we created in Step 2
                    const isMainTransportDoc = (doc.code === '02015' || doc.code === '09011');
                    if (isMainTransportDoc) {
                        console.log(`ℹ️ Skipping Box 44 upload for main transport doc ${doc.filename} (already handled)`);
                        continue;
                    }

                    console.log(`📤 Uploading file for Box 44: ${matchingFile.name}`);
                    try {
                        const blob = base64ToBlob(matchingFile.base64, matchingFile.mimeType);
                        const fileObj = new File([blob], matchingFile.name, { type: matchingFile.mimeType });
                        const uploadResp = await uploadFile(fileObj, headers);
                        if (uploadResp && uploadResp[0]) {
                            attachedFiles = [uploadResp[0]];
                            console.log(`✅ File attached to doc ${doc.code}`);
                        }
                    } catch (uploadErr) {
                        console.error(`❌ Failed to upload ${matchingFile.name}:`, uploadErr);
                    }
                } else {
                    console.log(`ℹ️ Skipping spreadsheet upload for ${matchingFile.name} (Keden only accepts PDF/JPG)`);
                }
            }

            const docPayload = {
                documentType: typeInfo,
                docNumber: doc.number,
                docDate: doc.date,
                files: attachedFiles
            };

            console.log(`📡 Creating document record: ${doc.code} (${doc.number})`);
            const createdDoc = await postDocument(consignmentId, docPayload, headers);

            if (createdDoc && createdDoc.id && productIds.length > 0) {
                console.log(`🔗 Mapping document ${createdDoc.id} to products`);
                await postDocumentMapping(createdDoc.id, productIds, headers);
            }
        }
        console.log('✅ Box 44 automation complete');
    } catch (err) {
        console.error('❌ Box 44 automation failed:', err);
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: mimeType });
}

function setStatusUI(text) {
    // Helper to log or show status if we had a global UI handler here
    console.log(`[STATUS]: ${text}`);
}
