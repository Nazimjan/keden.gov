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

        const consResp = await fetch(`${PI_API}/consignment`, {
            method: 'POST',
            headers,
            body: JSON.stringify(consignmentPayload)
        });

        if (!consResp.ok) {
            throw new Error("Не удалось создать партию (Consignment)");
        }

        const consignment = await consResp.json();
        console.log("Created Consignment:", consignment);

        if (!consignment || !consignment.id) {
            throw new Error("ID новой партии не получен");
        }

        consignmentId = consignment.id;
        await new Promise(r => setTimeout(r, 600));
    }

    const requests = [];

    // Универсальная функция проверки БИН/ИИН
    const validateResidentInfo = (payload, label) => {
        if (!payload) return;
        if (payload.entityType === "LEGAL" && (!payload.legal?.bin || payload.legal.bin.length !== 12)) {
            throw new Error(`${label}: БИН должен быть ровно 12 цифр`);
        }
        if (payload.entityType === "PERSON" && (!payload.person?.iin || payload.person.iin.length !== 12)) {
            throw new Error(`${label}: ИИН должен быть ровно 12 цифр`);
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
        roleCounteragent: { id: 2031, code: "CARRIER", ru: "Перевозчик ЕС" }
    });
    if (carrierPayload) {
        validateResidentInfo(carrierPayload, "Перевозчик");
        requests.push(carrierPayload);
    }

    const declarantPayload = buildCounteragentPayload(counteragents.declarant, {
        type: "DECLARANT",
        targetId: declId,
        targetType: "PRELIMINARY",
        roleCounteragent: { id: 2024, code: "DECLARANT", ru: "Декларант" }
    });
    if (declarantPayload) {
        validateResidentInfo(declarantPayload, "Декларант");
        requests.push(declarantPayload);
    }

    const fillerPayload = buildCounteragentPayload(counteragents.filler, {
        type: "FILLER_DECLARANT",
        targetId: declId,
        targetType: "PRELIMINARY"
    });
    if (fillerPayload) {
        validateResidentInfo(fillerPayload, "Заполнитель");
        requests.push(fillerPayload);
    }

    if (requests.length === 0) {
        console.warn("No counteragents found to upload");
        alert("Контрагенты не найдены в документах.");
        return;
    }

    const responses = [];
    for (const payload of requests) {
        const resp = await sendCounteragent(payload, headers);
        responses.push(resp);

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
    if (params.products && params.products.length > 0 && consignmentId) {
        console.log('📦 DEBUG: Importing products');
        try {
            const productsPayload = mapProductsPayload(params.products);
            await importProducts(consignmentId, productsPayload, headers);
            console.log('✅ Products imported successfully');
        } catch (prodErr) {
            console.error('❌ Product import failed:', prodErr);
            alert("Ошибка при импорте товаров: " + prodErr.message);
        }
    }

    alert("Данные успешно отправлены. Страница будет перезагружена.");
    window.location.reload();
}
