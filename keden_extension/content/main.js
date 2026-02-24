const VERSION = '1.2.0';

// RUN AUTO-CHECK ON LOAD
(async () => {
    console.log(`[Keden] Extension v${VERSION} loaded`);
    try {
        const auth = await checkExtensionAccess();
        if (auth && auth.allowed) {
            console.log('[Keden] Welcome, ' + auth.fio + '. Credits remain: ' + (auth.credits || 0));
        } else {
            console.warn('[Keden] Access restricted:', auth?.message);
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
                    alert('Ошибка доступа: ' + (auth.message || 'Ваш доступ заблокирован администратором.'));
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
    console.log('🧪 DEBUG: Starting counteragents fill');

    const match = window.location.href.match(/declarations\/PI\/\d+\/([A-Z0-9]+)/);
    if (!match) throw new Error("Откройте страницу ПИ");
    const declId = match[1];

    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) throw new Error("Не найден токен авторизации");
    const token = JSON.parse(authStorage).state.token.access_token;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

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

    // 5. Двойная проверка Декларанта (TЗ п.5)
    let existingDeclarant = null;
    try {
        const fullDecl = await getPIDeclaration(declId, headers);
        if (fullDecl && fullDecl.counteragents) {
            existingDeclarant = fullDecl.counteragents.find(c => c.type === 'DECLARANT');
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
            alert("Ошибка при импорте товаров: " + prodErr.message);
        }
    }

    // ОБРАБОТКА ДОКУМЕНТОВ 44 ГРАФЫ (Box 44 Automation)
    await processBox44Documents(consignmentId, params, createdProductIds, headers);

    alert("Данные успешно отправлены.");
    window.location.reload();
}

async function processBox44Documents(consignmentId, params, productIds, headers) {
    console.log('📑 DEBUG: Automating Box 44 Documents');

    const docsToCreate = [];
    const rawFiles = params.rawFiles || [];

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
                    filename: d.filename
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

    // УПАКОВОЧНЫЙ ЛИСТ (04131): Если нет, прикладываем инвойс вместо него
    if (!docsToCreate.some(d => d.code === '04131')) {
        const inv = docsToCreate.find(d => d.code === '04021');
        if (inv) {
            console.log('ℹ️ Packing list absent, using invoice as fallback for 04131');
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

        for (const doc of docsToCreate) {
            const typeInfo = docTypes.find(t => t.code === doc.code);
            if (!typeInfo) {
                console.warn(`⚠️ Warning: Doc type ${doc.code} not found in classifier, skipping.`);
                continue;
            }

            let attachedFiles = [];

            // Пытаемся найти файл и загрузить его, если он не таблица
            const matchingFile = rawFiles.find(f => f.name.toLowerCase() === (doc.filename || "").toLowerCase());
            if (matchingFile && matchingFile.base64) {
                const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(matchingFile.name);
                if (!isSpreadsheet) {
                    console.log(`📤 Uploading file for Box 44: ${matchingFile.name} (Doc ${doc.code})`);
                    try {
                        const blob = base64ToBlob(matchingFile.base64, matchingFile.mimeType);
                        const fileObj = new File([blob], matchingFile.name, { type: matchingFile.mimeType });
                        const uploadResp = await uploadFile(fileObj, headers);
                        if (uploadResp && uploadResp[0]) {
                            attachedFiles = [uploadResp[0]];
                            console.log(`✅ File attached successfully`);
                        }
                    } catch (uploadErr) {
                        console.error(`❌ Failed to upload ${matchingFile.name}:`, uploadErr);
                    }
                } else {
                    console.log(`ℹ️ Skipping spreadsheet upload for ${matchingFile.name} (not supported by Keden)`);
                }
            }

            const docPayload = {
                documentType: typeInfo,
                docNumber: doc.number,
                docDate: doc.date === "Б/Д" ? null : formatToISODate(doc.date),
                regKindCode: doc.code === '09011' ? "1" : null,
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

