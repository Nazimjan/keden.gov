const VERSION = '1.2.0';

// RUN AUTO-CHECK ON LOAD
(async () => {

    try {
        const auth = await checkExtensionAccess();
        if (auth && auth.allowed) {

        } else {

        }
    } catch (e) {
        console.error('[Keden] Initialization auth check failed:', e);
    }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_USER_INFO') {
        // Extract user info from Keden's auth-storage JWT
        const userInfo = extractKedenUserInfo(); // from admin_auth.js
        sendResponse(userInfo);
        return true;
    }

    if (request.action === 'FILL_PI_DATA') {
        // Double check access before any major action (TЗ security)
        checkExtensionAccess()
            .then(auth => {
                if (!auth.allowed) {
                    showKedenNotification('Ошибка доступа: ' + (auth.message || 'Ваш доступ заблокирован администратором.'), 'error');
                    sendResponse({ success: false, error: 'Access Denied' });
                    return;
                }

                fillCounteragents(request.data)
                    .then(() => sendResponse({ success: true }))
                    .catch(err => {
                        console.error('Fill Error:', err);
                        sendResponse({ success: false, error: err.message });
                    });
            })
            .catch(err => {
                console.error('Auth Check Failed:', err);
                sendResponse({ success: false, error: 'Auth server error' });
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


    const match = window.location.href.match(/declarations\/PI\/\d+\/([A-Z0-9]+)/);
    if (!match) throw new Error("Откройте страницу ПИ");
    const declId = match[1];

    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) throw new Error("Не найден токен авторизации");
    const token = JSON.parse(authStorage).state.token.access_token;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    // Инициализация справочника стран (диномическая загрузка с кэшем)
    await window.getCountries(headers);

    // Normalize params in case it contains mergedData (sent directly from background)
    if (params && params.mergedData) {
        const merged = params.mergedData;
        params = {
            ...merged,
            documents: params.documents || merged.documents,
            rawFiles: params.rawFiles || merged.rawFiles,
            validation: params.validation || merged.validation
        };
    }

    const counteragents = params && params.counteragents ? params.counteragents : {};

    // ОБОГАЩЕНИЕ ДАННЫХ (FETCH BY BIN/IIN)
    await processCounteragentEnrichment(counteragents.consignee, headers);
    await processCounteragentEnrichment(counteragents.carrier, headers);
    await processCounteragentEnrichment(counteragents.declarant, headers);

    // ОБРАБОТКА ТРАНСПОРТА (Vehicle Number)
    if (params.vehicles && params.vehicles.tractorRegNumber) {
        console.log('🚛 DEBUG: Updating vehicle data');
        try {
            const currentDecl = await getPIDeclaration(declId, headers);
            const vehicleAtBorderData = buildVehiclePayload(params.vehicles);

            if (vehicleAtBorderData) {
                // Сохраняем остальные поля декларации, меняем только транспорт в vehicleAtBorder
                currentDecl.presentingPersonEqualCarrier = true; // ГАЛОЧКА: Совпадает с перевозчиком и представителем на границе
                currentDecl.productsTransportation = {
                    ...currentDecl.productsTransportation,
                    matchesVehicleAtBorder: true, // ГАЛОЧКА: ТС прибывающие совпадают с ТС при транзите
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
                            currentDecl.productsTransportation = { containerTransportation: false, matchesVehicleAtBorder: true };
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
                currentDecl.presentingPersonEqualCarrier = true;
                if (currentDecl.productsTransportation) {
                    currentDecl.productsTransportation.matchesVehicleAtBorder = true;
                }
                await updatePIDeclaration(declId, currentDecl, headers);
                console.log('✅ Declaration updated with Customs/Transport data');
            }
        } catch (err) {
            console.error('❌ Customs/Transport update failed:', err);
        }

        // ОБРАБОТКА СРЕДСТВ ИДЕНТИФИКАЦИИ (Голочка "Без пломбы")
        try {
            console.log('🔗 DEBUG: Setting Customs Identification to "Without Seal"');
            await updateCustomsIdentification(declId, headers);
        } catch (identErr) {
            console.error('❌ Customs Identification update failed:', identErr);
        }

        // ОБРАБОТКА ТАМОЖНИ НАЗНАЧЕНИЯ
        try {
            if (params.shipping && params.shipping.destCustomsCode) {
                console.log('🔗 DEBUG: Updating Destination Customs Office:', params.shipping.destCustomsCode);
                await updateDestinationCustomsOffice(declId, params.shipping.destCustomsCode, headers);
            }
        } catch (destErr) {
            console.error('❌ Destination Customs update failed:', destErr);
        }

        // ОБРАБОТКА ДОКУМЕНТОВ УЭО И ПРЕДСТАВИТЕЛЯ (Warranties, Presentation features, Transport Docs)
        try {
            if (params.registry && params.registry.number) {
                console.log('🏛️ DEBUG: Updating Registry/AEO configuration on main declaration');
                const currentDecl = await getPIDeclaration(declId, headers);

                // Add presentation feature "06"
                if (!currentDecl.presentationFeatures) currentDecl.presentationFeatures = [];
                if (!currentDecl.presentationFeatures.some(f => f.feature && f.feature.code === "06")) {
                    currentDecl.presentationFeatures.push({
                        feature: { id: 2058, code: "06" }
                    });
                }

                // Add warranties logic
                if (!currentDecl.warranties) currentDecl.warranties = [];
                if (currentDecl.warranties.length === 0) {
                    currentDecl.warranties = [{
                        indexOrder: 0,
                        guaranteePresentType: "NO_WARRANTY",
                        guaranteeFailure: { id: 2089, code: "103" },
                        warrantyDocs: [{
                            documentType: { id: 415, code: "09011" },
                            otherDocNumber: params.registry.number,
                            otherDocDate: formatToISODate(params.registry.date) || new Date().toISOString().split('T')[0],
                            mappings: [],
                            indexOrder: 0
                        }]
                    }];
                }

                // Add transportDocument
                if (!currentDecl.transportDocument) currentDecl.transportDocument = [];
                if (!currentDecl.transportDocument.some(d => d.documentType && d.documentType.code === "09011")) {
                    currentDecl.transportDocument.push({
                        documentType: { id: 415, code: "09011" },
                        docNumber: params.registry.number,
                        docDate: formatToISODate(params.registry.date) || new Date().toISOString().split('T')[0]
                    });
                }

                // Also Movement Type TR (if applicable and missing)
                if (!currentDecl.movementType) {
                    currentDecl.movementType = { id: 4, code: "TR", shortNameRu: "ТР" };
                }

                await updatePIDeclaration(declId, currentDecl, headers);
                console.log('✅ Declaration updated with AEO/Registry config');
            }
        } catch (regErr) {
            console.error('❌ Registry config update failed:', regErr);
        }
    }


    let consignmentId = null;
    const consMatch = window.location.href.match(/consignment\/([A-Z0-9]+)/);
    if (consMatch) consignmentId = consMatch[1];

    const hasConsignmentAgents = Boolean(counteragents.consignor?.present || counteragents.consignee?.present);
    const hasProducts = Boolean(params.products && params.products.length > 0);
    const hasDocs = Boolean((params.documents && params.documents.length > 0) || (params.rawFiles && params.rawFiles.length > 0));

    if ((hasConsignmentAgents || hasProducts || hasDocs) && !consignmentId) {
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
        // STRICT RULE: This block in Consignment always refers to the Registry (09011)
        const docs = params.documents || [];
        const declarant = params.counteragents?.declarant;
        let mainDoc = null;

        // Priority 1: Use registry from params or declarant's certificate (official data)
        if (params.registry && params.registry.number) {
            mainDoc = { type: 'REGISTRY', number: params.registry.number, date: params.registry.date };
        } else if (declarant && declarant.representativeCertificate && declarant.representativeCertificate.docNumber) {
            mainDoc = {
                type: 'REGISTRY',
                number: declarant.representativeCertificate.docNumber,
                date: declarant.representativeCertificate.docDate
            };
        } else {
            mainDoc = docs.find(d => d.type === 'REGISTRY' || d.code === '09011' || d.type === '09011');
        }

        if (mainDoc) {
            const docCode = '09011'; // Optimized: always use 09011 here
            const docTypes = await fetchDocumentTypes(headers);
            const typeInfo = docTypes.find(t => t.code === docCode);

            if (typeInfo) {
                const docPayload = {
                    documentType: typeInfo,
                    docNumber: mainDoc.number || "Б/Н",
                    docDate: formatToISODate(mainDoc.date) || new Date().toISOString().split('T')[0],
                    regCode: docCode === '09011' ? "103" : null,
                    regKindCode: docCode === '09011' ? "1" : null
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
        validateResidentInfo(declarantPayload, "Декларант");
        requests.push(declarantPayload);
    }

    // ТЗ: Отправка заполнителя (брокера) напрямую из app-person
    if (counteragents.filler && counteragents.filler.iin) {
        try {
            const fillerInfo = await fetchTaxpayerInfo(counteragents.filler.iin, headers, 'app-person');
            if (fillerInfo) {
                // Если fillerInfo вернуло нужные поля (lastName, firstName), собираем точный payload
                const fillerPayload = {
                    indexOrder: 0,
                    type: "FILLER_DECLARANT",
                    person: {
                        id: fillerInfo.id || null,
                        iin: fillerInfo.iin,
                        lastName: fillerInfo.lastName || "",
                        firstName: fillerInfo.firstName || "",
                        middleName: fillerInfo.middleName || fillerInfo.patronymic || "",
                        birthDate: fillerInfo.birthDate || null,
                        fullName: fillerInfo.fullName || `${fillerInfo.lastName} ${fillerInfo.firstName} ${fillerInfo.middleName || ''}`.trim()
                    },
                    entityType: "PERSON",
                    targetId: declId,
                    targetType: "PRELIMINARY",
                    roleCounteragent: {
                        id: 2028,
                        code: "FILLER_DECLARANT",
                        ru: "Лицо, заполнившее таможенный документ, со стороны декларанта"
                    },
                    representatives: [],
                    sellerEqualIndicator: false,
                    buyerEqualIndicator: false,
                    contacts: [],
                    xin: fillerInfo.iin,
                    counteragentName: fillerInfo.fullName || `${fillerInfo.lastName} ${fillerInfo.firstName} ${fillerInfo.middleName || ''}`.trim(),
                    carrierEqualIndicator: false
                };
                requests.push(fillerPayload);
            }
        } catch (e) {
            console.warn("Error fetching filler from app-person:", e);
        }
    }

    if (requests.length === 0) {
        console.warn("No (new) counteragents found to upload");
    }

    const responses = [];
    for (const payload of requests) {
        // Динамическое обогащение documentType.id по коду для декларанта
        if (payload.type === 'DECLARANT' && payload.registerDocument) {
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
        if (payload.type === 'DECLARANT' && payload.registerDocument) {
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
                        const isFiller = payload.type === 'FILLER_DECLARANT';
                        const updatePayload = {
                            ...payload,
                            id: declarantId
                        };

                        // ВАЖНО: Для заполнителя документ может называться по-разному в разных версиях API.
                        // Отправляем в оба доступных поля: и в стандартный registerDocument, и в powerOfAttorneyDocument.
                        updatePayload.registerDocument = docResp;
                        if (isFiller) {
                            updatePayload.powerOfAttorneyDocument = docResp;
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
                console.log('👤 DEBUG: Processing carrier representative and transit copy', carrierId);
                try {
                    // 1. Сначала добавляем водителя к самому перевозчику (на границе)
                    const driverPayload = buildDriverPayload(params.driver, carrierId);
                    if (driverPayload) {
                        await postRepresentative(driverPayload, headers);
                        console.log('✅ Driver added to carrier');
                    }

                    // 2. И только ПОТОМ копируем его в раздел Транзит (ГАЛОЧКА: Совпадает с перевозчиком)
                    // Это гарантирует, что водитель тоже скопируется в новый раздел
                    await copyCounteragent(carrierId, declId, 'PRELIMINARY', 'TRANSPORTER', headers);
                    console.log('✅ Carrier (with driver) copied to transporter section');

                } catch (err) {
                    console.error('❌ Carrier/Driver automation failed:', err);
                }
            } else {
                console.warn('⚠️ Warning: Carrier ID not found in response, skipping copy/driver.');
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
            let importedProducts = await importProducts(consignmentId, productsPayload, headers);

            // Если API вернуло пусто (иногда бывает при 200 OK), пробуем получить список товаров по ID партии
            if (!Array.isArray(importedProducts) || importedProducts.length === 0) {
                console.log('ℹ️ Product import response empty, fetching from server...');
                importedProducts = await getProducts(consignmentId, headers);
            }

            if (Array.isArray(importedProducts)) {
                createdProductIds = importedProducts.map(p => p.id);
            }
            console.log('✅ Products processed:', createdProductIds.length);
        } catch (prodErr) {
            console.error('❌ Product import failed:', prodErr);
            showKedenNotification("Ошибка при импорте товаров: " + prodErr.message, "error");
        }
    }

    // ОБРАБОТКА ДОКУМЕНТОВ 44 ГРАФЫ (Box 44 Automation)
    await processBox44Documents(consignmentId, params, createdProductIds, headers);

    showKedenNotification('Данные успешно заполнены! Страница сейчас перезагрузится...', 'success');
    setTimeout(() => window.location.reload(), 2500);
}

async function processBox44Documents(consignmentId, params, productIds, headers) {
    console.log('📑 DEBUG: processBox44Documents starting', {
        consignmentId,
        docsToCreateInParams: params.documents?.length || 0,
        rawFilesCount: (params.rawFiles || []).length
    });

    const docsToCreate = [];
    const rawFiles = params.rawFiles || [];

    console.log('📂 Available files in rawFiles:', rawFiles.map(f => f.name));

    // Combine documents from Gemini analysis
    if (params.documents && Array.isArray(params.documents)) {
        params.documents.forEach(d => {
            let code = null;

            // Если тип уже является кодом (5 цифр)
            if (d.type && d.type.match(/^\d{5}$/)) {
                code = d.type;
            } else {
                // Маппинг ключевых слов в коды
                if (d.type === 'INVOICE') code = '04021';
                else if (d.type === 'TRANSPORT_DOC') code = '02015';
                else if (d.type === 'REGISTRY') code = '09011';
                else if (d.type === 'VEHICLE_PERMIT') code = '09024';
                else if (['DRIVER_ID', 'POWER_OF_ATTORNEY', 'VEHICLE_DOC'].includes(d.type)) code = '10022';
                else if (d.type === 'PACKING_LIST') code = '04131';
                else if (d.type === 'CONTRACT_TRANSPORT') code = '04033';
                else if (d.type === 'CONTRACT') code = '11005';
                else if (d.type === 'OTHER') code = '11005';
            }

            if (code) {
                docsToCreate.push({
                    code: code,
                    number: d.number || "Б/Н",
                    date: d.date || "Б/Д",
                    name: d.type,
                    filename: d.filename,
                    groupId: d.groupId || null
                });
            }
        });
    }

    // РЕЕСТР: Если его нет в списке документов, но он есть в данных - добавляем
    if (!docsToCreate.some(d => d.code === '09011') && params.registry && params.registry.number) {
        docsToCreate.push({
            code: '09011',
            number: params.registry.number,
            date: params.registry.date || "Б/Д",
            name: 'РЕЕСТР'
        });
    }

    // УПАКОВОЧНЫЙ ЛИСТ (04131): Прикладываем инвойс если упаковочного нет (TЗ требование)
    if (!docsToCreate.some(d => d.code === '04131')) {
        const inv = docsToCreate.find(d => d.code === '04021');
        if (inv) {

            docsToCreate.push({
                ...inv,
                code: '04131',
                name: 'PACKING_LIST_FALLBACK'
            });
        }
    }

    if (docsToCreate.length === 0) return;

    try {
        const docTypes = await fetchDocumentTypes(headers);
        const type10022 = docTypes.find(t => t.code === '10022');

        // Grouping logic
        const groups = {}; // { groupId: { docs: [] } }

        for (const doc of docsToCreate) {
            let gId = doc.groupId;
            if (!gId) {
                // Auto-group by code + number + date
                const cleanNum = (doc.number || '').trim().toLowerCase();
                const cleanDate = (doc.date || '').trim();
                gId = `auto_${doc.code}_${cleanNum}_${cleanDate}`;
            }
            if (!groups[gId]) groups[gId] = { docs: [] };
            groups[gId].docs.push(doc);
        }

        // Process Groups
        for (const gId in groups) {
            const group = groups[gId];
            const firstDoc = group.docs[0];
            const bestCode = firstDoc.code;



            const attachedFiles = [];
            for (let i = 0; i < group.docs.length; i++) {
                const doc = group.docs[i];

                const searchName = (doc.filename || "").toLowerCase().trim();
                const matchingFile = rawFiles.find(f => {
                    const fName = (f.name || "").toLowerCase().trim();
                    return fName === searchName || fName.includes(searchName) || searchName.includes(fName);
                });

                if (matchingFile && matchingFile.base64) {

                    try {
                        const blob = base64ToBlob(matchingFile.base64, matchingFile.mimeType);
                        const fileObj = new File([blob], matchingFile.name, { type: matchingFile.mimeType });
                        const uploadResp = await uploadFile(fileObj, headers);
                        const fileData = Array.isArray(uploadResp) ? uploadResp[0] : uploadResp;

                        if (fileData && (fileData.id || fileData.fileId)) {
                            fileData.uid = `__AUTO__${Date.now()}_${i}__`;
                            attachedFiles.push(fileData);

                        }
                    } catch (err) {
                        console.error(`    ❌ File upload failed:`, err);
                    }
                }
            }

            // Create document if we have files OR if it's a Registry with a number
            if (attachedFiles.length > 0 || (bestCode === '09011' && firstDoc.number && firstDoc.number !== 'Б/Н')) {
                const typeInfo = docTypes.find(t => t.code === bestCode) || type10022 || { id: 457, code: "10022" };

                const docPayload = {
                    documentType: typeInfo,
                    docNumber: firstDoc.number || "б/н",
                    docDate: (firstDoc.date && firstDoc.date !== "Б/Д" && firstDoc.date !== "б/д") ? formatToISODate(firstDoc.date) : null,
                    regCode: bestCode === '09011' ? "103" : null,
                    regKindCode: bestCode === '09011' ? "1" : null,
                    files: attachedFiles
                };

                const createdDoc = await postDocument(consignmentId, docPayload, headers);
                if (createdDoc && createdDoc.id) {

                    if (productIds && productIds.length > 0) {
                        await postDocumentMapping(createdDoc.id, productIds, headers).catch(() => { });
                    }
                }
            } else {
                console.warn(`  ⚠️ Group ${gId} skipped: No files matched and not a valid Registry.`);
            }
        }

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

/** Modern UI Notification System for Keden Portal */
function showKedenNotification(message, type = 'info') {
    let container = document.getElementById('keden-notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'keden-notification-container';
        container.style.cssText = `
            position: fixed;
            top: 24px;
            right: 24px;
            z-index: 1000000;
            display: flex;
            flex-direction: column;
            gap: 12px;
            pointer-events: none;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        `;
        document.body.appendChild(container);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes kedenSlideIn {
                0% { transform: translateY(-20px) scale(0.95); opacity: 0; }
                100% { transform: translateY(0) scale(1); opacity: 1; }
            }
            @keyframes kedenSlideOut {
                0% { transform: translateY(0) scale(1); opacity: 1; }
                100% { transform: translateY(-20px) scale(0.95); opacity: 0; }
            }
            .keden-toast {
                background: rgba(255, 255, 255, 0.85);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: #1e293b;
                padding: 16px 20px;
                border-radius: 16px;
                box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
                min-width: 320px;
                max-width: 480px;
                pointer-events: auto;
                animation: kedenSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                display: flex;
                align-items: center;
                gap: 16px;
                font-size: 15px;
                font-weight: 500;
                line-height: 1.5;
                transition: all 0.3s ease;
                border: 1px solid rgba(0, 0, 0, 0.05);
            }
            .keden-toast-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 40px;
                height: 40px;
                border-radius: 12px;
                font-size: 20px;
            }
            .keden-toast.success .keden-toast-icon { background: rgba(16, 185, 129, 0.15); color: #10b981; }
            .keden-toast.error .keden-toast-icon { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
            .keden-toast.info .keden-toast-icon { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
            
            .keden-toast.success { border-left: 4px solid #10b981; }
            .keden-toast.error { border-left: 4px solid #ef4444; }
            .keden-toast.info { border-left: 4px solid #3b82f6; }
            
            .keden-toast-close {
                margin-left: auto;
                cursor: pointer;
                opacity: 0.5;
                font-size: 18px;
                transition: opacity 0.2s;
            }
            .keden-toast-close:hover { opacity: 1; }
        `;
        document.head.appendChild(style);
    }

    const toast = document.createElement('div');
    toast.className = `keden-toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✨';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `
        <div class="keden-toast-icon">${icon}</div>
        <div style="flex: 1; text-shadow: 0 1px 1px rgba(255,255,255,0.8);">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'kedenSlideOut 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
            setTimeout(() => toast.remove(), 400);
        }
    }, 5000);
}

