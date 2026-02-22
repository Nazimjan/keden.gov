const VALID_ENTITY_TYPES = ["LEGAL", "NON_RESIDENT_LEGAL", "INDIVIDUAL", "NON_RESIDENT_PERSON", "ENTREPRENEUR", "NON_RESIDENT", "PERSON"];

function normalizeEntityType(entityType, name = "") {
    if (!entityType) return "LEGAL";
    const upper = entityType.toUpperCase().replace(/[^A-Z_]/g, '');
    const upperName = (name || "").toUpperCase();

    // ПЕРВООЧЕРЕДНАЯ ПРОВЕРКА НА НЕРЕЗИДЕНТА ПО ИМЕНИ
    // Если в имени есть LTD, LLC, CORP, INC, PLC и т.д. - это скорее всего нерезидент
    const foreignIndicators = ["LTD", "LLC", "CORP", "INC", "PLC", "GMBH", "SARL", "SPA", "SDN BHD", "CO., LTD", "PTE LTD"];
    if (foreignIndicators.some(ind => upperName.includes(ind))) {
        return "NON_RESIDENT_LEGAL";
    }

    if (VALID_ENTITY_TYPES.includes(upper)) return upper;
    if (upper === "LEGAL_ENTITY" || upper === "LEGALENTITY") return "LEGAL";
    if (upper.includes("NON_RESIDENT") && upper.includes("LEGAL")) return "NON_RESIDENT_LEGAL";
    if (upper.includes("NON_RESIDENT") && upper.includes("PERSON")) return "NON_RESIDENT_PERSON";
    if (upper.includes("NON_RESIDENT")) return "NON_RESIDENT_LEGAL";
    if (upper.includes("LEGAL") || upper.includes("COMPANY")) return "LEGAL";
    if (upper.includes("INDIVIDUAL") || upper.includes("PERSON")) return "INDIVIDUAL";
    return "LEGAL";
}

const COUNTRY_MAP = {
    "AF": { "id": 1, "numericCode": "004", "letterCodeShort": "AF", "shortNameRu": "АФГАНИСТАН" },
    "CN": { "id": 44, "numericCode": "156", "letterCodeShort": "CN", "shortNameRu": "КИТАЙ" },
    "KZ": { "id": 113, "numericCode": "398", "letterCodeShort": "KZ", "shortNameRu": "КАЗАХСТАН" },
    "RU": { "id": 185, "numericCode": "643", "letterCodeShort": "RU", "shortNameRu": "РОССИЙСКАЯ ФЕДЕРАЦИЯ" },
    "KG": { "id": 117, "numericCode": "417", "letterCodeShort": "KG", "shortNameRu": "КИРГИЗИЯ" },
    "UZ": { "id": 234, "numericCode": "860", "letterCodeShort": "UZ", "shortNameRu": "УЗБЕКИСТАН" },
    "TR": { "id": 224, "numericCode": "792", "letterCodeShort": "TR", "shortNameRu": "ТУРЦИЯ" },
    "CG": { "id": 51, "numericCode": "178", "letterCodeShort": "CG", "shortNameRu": "КОНГО", "nameRu": "Республика Конго" },
    "AM": { "id": 16, "numericCode": "051", "letterCodeShort": "AM", "shortNameRu": "АРМЕНИЯ" },
    "GE": { "id": 81, "numericCode": "268", "letterCodeShort": "GE", "shortNameRu": "ГРУЗИЯ" },
    "TJ": { "id": 219, "numericCode": "762", "letterCodeShort": "TJ", "shortNameRu": "ТАДЖИКИСТАН" },
    "TM": { "id": 228, "numericCode": "795", "letterCodeShort": "TM", "shortNameRu": "ТУРКМЕНИЯ" }
};

function buildCounteragentPayload(source, extra) {
    if (!source || !source.present) return null;
    const payload = {};

    const name = source.legal?.nameRu || source.nonResidentLegal?.nameRu || source.person?.lastName || "";
    let entityType = normalizeEntityType(source.entityType, name);

    // СТРОГОЕ ПРАВИЛО: Декларант и Лицо заполнившее могут быть ТОЛЬКО резидентами (ЮЛ/ИП/ФЛ)
    if (extra?.type === 'DECLARANT' || extra?.type === 'FILLER_DECLARANT') {
        if (entityType.includes("NON_RESIDENT")) {
            console.log(`⚠️ [Mappers] Forcing resident status for ${extra.type}`);
            entityType = entityType.includes("PERSON") ? "INDIVIDUAL" : "LEGAL";
        }
        // Если ИИ ошибочно поместил данные в нерезидента - переносим в legal
        if (source.nonResidentLegal && !source.legal) {
            source.legal = {
                nameRu: source.nonResidentLegal.nameRu,
                bin: source.xin || source.iin || ""
            };
        }
    }

    if (entityType) payload.entityType = entityType;

    // Ключевой идентификатор для ПИ (БИН или ИИН) - TЗ п.2.1
    const rawBin = source.legal?.bin || source.person?.iin || source.iin || source.xin || "";
    if (rawBin) {
        payload.xin = rawBin.toString().replace(/\D/g, '');
    }

    // Обработка адресов и кодов стран - TЗ п.2.2
    if (source.addresses) {
        payload.addresses = source.addresses.map(addr => {
            const mappedAddr = {
                createdBy: null,
                createdAt: null,
                modifiedBy: null,
                modifiedAt: null,
                id: null,
                targetId: null,
                targetType: entityType && entityType.includes("PERSON") ? "PERSON" : "LEGAL",
                addressType: addr.addressType || { id: 2014, code: "1", ru: "Адрес регистрации" },
                ...addr
            };

            // Страна - TЗ п.2.2
            if (addr.countryCode && COUNTRY_MAP[addr.countryCode]) {
                mappedAddr.country = COUNTRY_MAP[addr.countryCode];
                delete mappedAddr.countryCode;
            } else if (addr.countryCode) {
                mappedAddr.country = COUNTRY_MAP["CN"];
                delete mappedAddr.countryCode;
            } else if (extra?.type === 'DECLARANT') {
                mappedAddr.country = COUNTRY_MAP["KZ"];
            }

            // Попытка разделить адрес на компоненты для Декларанта (резидента)
            if (mappedAddr.fullAddress && !mappedAddr.street) {
                const parts = mappedAddr.fullAddress.split(',').map(s => s.trim());
                // Простая эвристика: последнее - дом/улица
                if (parts.length >= 2) {
                    mappedAddr.street = parts[parts.length - 2];
                    mappedAddr.house = parts[parts.length - 1];
                } else {
                    mappedAddr.street = mappedAddr.fullAddress;
                }
            }

            if (entityType && entityType.includes("NON_RESIDENT")) {
                const cityVal = addr.city || addr.district || "";
                if (cityVal) {
                    // ОБЯЗАТЕЛЬНО: Оставляем город в поле city для прохождения ФЛК
                    mappedAddr.city = cityVal.toUpperCase();
                    // Убираем поле района (district), оставляем только чистый город
                    delete mappedAddr.district;
                }
            }

            return mappedAddr;
        });
    }

    if (entityType === "NON_RESIDENT_LEGAL" || entityType === "NON_RESIDENT_PERSON" || entityType === "NON_RESIDENT") {
        if (source.nonResidentLegal?.nameRu) {
            payload.nonResidentLegal = { nameRu: source.nonResidentLegal.nameRu };
        }
        payload.contacts = null;
        payload.nonResidentPerson = null;
        return { ...payload, ...extra };
    }

    if (source.legal) {
        payload.legal = {
            ...source.legal,
            bin: source.legal.bin?.toString().replace(/\D/g, '') || ""
        };
        // Краткое наименование - TЗ п.2.1
        if (!payload.legal.shortNameRu) {
            payload.legal.shortNameRu = source.legal.shortNameRu || source.legal.nameRu?.substring(0, 50) || "";
        }
        if (payload.legal.bin) {
            payload.xin = payload.legal.bin;
        }
    }

    if (source.nonResidentLegal) payload.nonResidentLegal = source.nonResidentLegal;

    if (source.kedenData && source.kedenData.iin) {
        // Если есть официальные данные от Keden для физлица - используем их для блока person
        payload.person = {
            id: source.kedenData.id || null,
            iin: source.kedenData.iin,
            lastName: source.kedenData.lastName || source.kedenData.fullName?.split(' ')[0] || "",
            firstName: source.kedenData.firstName || source.kedenData.fullName?.split(' ')[1] || "",
            middleName: source.kedenData.middleName || source.kedenData.patronymic || source.kedenData.fullName?.split(' ')[2] || "",
            birthDate: source.kedenData.birthDate || null,
            fullName: source.kedenData.fullName
        };
        if (!payload.xin) payload.xin = source.kedenData.iin;
    } else if (source.person || (source.iin && source.lastName)) {
        const p = source.person || source;
        payload.person = {
            iin: p.iin?.toString().replace(/\D/g, '') || "",
            lastName: p.lastName || "",
            firstName: p.firstName || "",
            middleName: p.patronymic || p.middleName || ""
        };
        if (!payload.xin && payload.person.iin) {
            payload.xin = payload.person.iin;
        }
    }

    if (source.contacts !== undefined) payload.contacts = source.contacts;
    if (source.nonResidentPerson !== undefined) payload.nonResidentPerson = source.nonResidentPerson;

    // Регистрационный документ - TЗ п.2.3
    const regDoc = source.representativeCertificate || source.powerOfAttorney;
    if (regDoc && regDoc.docNumber) {
        const isPOA = source.powerOfAttorney !== undefined;
        payload.registerDocument = {
            docNumber: regDoc.docNumber,
            docDate: regDoc.docDate || null,
            startDate: regDoc.startDate || regDoc.docDate || null,
            endDate: regDoc.endDate || null,
            documentType: isPOA ? {
                id: 432, // ID will be updated dynamically in main.js
                code: "09024",
                ru: "Документ, подтверждающий полномочия лица, подающего таможенную декларацию"
            } : {
                id: 415,
                code: "09011",
                ru: "Документ, свидетельствующий о включении лица в Реестр уполномоченных экономических операторов"
            },
            country: COUNTRY_MAP["KZ"],
            regKindCode: regDoc.regKindCode || null
        };
    }

    return { ...payload, ...extra };
}
const VEHICLE_TYPE_MAP = {
    "TRACTOR": { "id": 1040, "code": "303", "ru": "Грузовой автомобиль общего назначения" },
    "TRAILER": { "id": 1049, "code": "312", "ru": "Грузовой прицеп общего назначения" }
};

const VEHICLE_KIND = { "id": 29, "code": "31", "ru": "Состав транспортных средств (тягач с полуприцепом или прицепом)" };

function mapCountryCode(code) {
    if (!code) return null;
    return COUNTRY_MAP[code.toUpperCase()] || null;
}

function buildVehiclePayload(vehiclesData) {
    if (!vehiclesData || !vehiclesData.tractorRegNumber) return null;

    const vehicles = [];

    // Tractor
    const tractor = {
        indexOrder: 0,
        country: mapCountryCode(vehiclesData.tractorCountry) || COUNTRY_MAP["KZ"],
        transportRegNumber: vehiclesData.tractorRegNumber,
        vin: "-",
        vehBodyNumber: "-",
        transportType: VEHICLE_TYPE_MAP.TRACTOR,
        emptyVehicle: false,
        returnCarriage: false,
        vehicleType: VEHICLE_KIND,
        participants: [],
        routePoints: [],
        airOperators: []
    };
    vehicles.push(tractor);

    // Trailer (if present)
    if (vehiclesData.trailerRegNumber) {
        vehicles.push({
            indexOrder: 1,
            country: mapCountryCode(vehiclesData.trailerCountry) || tractor.country,
            transportRegNumber: vehiclesData.trailerRegNumber,
            vin: "-",
            vehBodyNumber: "-",
            transportType: VEHICLE_TYPE_MAP.TRAILER,
            emptyVehicle: false,
            returnCarriage: false,
            vehicleType: VEHICLE_KIND,
            participants: [],
            routePoints: [],
            airOperators: []
        });
    }

    return {
        transportMeansQuantity: vehicles.length,
        vehicles: vehicles,
        routePoints: [],
        multimodalitySign: false
    };
}

function mapProductsPayload(aiProducts) {
    if (!aiProducts || !Array.isArray(aiProducts)) return [];

    return aiProducts.map((p, index) => {
        // Убеждаемся, что код ТН ВЭД имеет максимум 6 цифр, если пришло больше
        const tnved = p.tnvedCode ? p.tnvedCode.toString().substring(0, 6) : "000000";

        return {
            guid: `${index}_${Math.random().toString(36).substring(2, 10)}`,
            tnvedCode: tnved,
            commercialName: p.commercialName || "Товар",
            cargoSeatQuantity: p.quantity?.toString() || "0",
            packagingPalletsInfoPackageQuantity: p.quantity?.toString() || "0",
            grossWeight: p.grossWeight?.toString() || "0",
            cost: p.cost?.toString() || "0",
            currencyCode: p.currencyCode || "USD",
            packageType: "1", // Default to "Package"
            packagingPalletsInfoPackageTypeCode: "PK",
            packagingPalletsInfoPackageInfoType: "0",
            prohibitionFree: "1"
        };
    });
}

function buildDriverPayload(driverData, carrierId) {
    if (!driverData || !driverData.iin) return null;

    return {
        indexOrder: 0,
        iin: driverData.iin.toString().replace(/\D/g, ''),
        lastName: (driverData.lastName || "ВОДИТЕЛЬ").toUpperCase(),
        firstName: (driverData.firstName || "ВОДИТЕЛЬ").toUpperCase(),
        role: "1 - водитель транспортного средства",
        contacts: [],
        counteragentId: carrierId
    };
}
