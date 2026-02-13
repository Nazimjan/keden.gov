const VALID_ENTITY_TYPES = ["LEGAL", "NON_RESIDENT_LEGAL", "INDIVIDUAL", "NON_RESIDENT_PERSON", "ENTREPRENEUR", "NON_RESIDENT", "PERSON"];

function normalizeEntityType(entityType) {
    if (!entityType) return null;
    const upper = entityType.toUpperCase().replace(/[^A-Z_]/g, '');
    if (VALID_ENTITY_TYPES.includes(upper)) return upper;
    if (upper === "LEGAL_ENTITY" || upper === "LEGALENTITY") return "LEGAL";
    if (upper.includes("NON_RESIDENT") && upper.includes("LEGAL")) return "NON_RESIDENT_LEGAL";
    if (upper.includes("NON_RESIDENT") && upper.includes("PERSON")) return "NON_RESIDENT_PERSON";
    if (upper.includes("NON_RESIDENT")) return "NON_RESIDENT_LEGAL";
    if (upper.includes("LEGAL") || upper.includes("COMPANY") || upper.includes("LLC") || upper.includes("LTD")) return "LEGAL";
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

    const entityType = normalizeEntityType(source.entityType);
    if (entityType) payload.entityType = entityType;

    // Обработка адресов и кодов стран
    if (source.addresses) {
        payload.addresses = source.addresses.map(addr => {
            const mappedAddr = { ...addr };
            if (addr.countryCode && COUNTRY_MAP[addr.countryCode]) {
                mappedAddr.country = COUNTRY_MAP[addr.countryCode];
                delete mappedAddr.countryCode;
            } else if (addr.countryCode) {
                // Фоллбек, если кода нет в мапе (используем CN как дефолт, но предупреждаем)
                console.warn(`Unknown country code: ${addr.countryCode}, defaulting to China`);
                mappedAddr.country = COUNTRY_MAP["CN"];
                delete mappedAddr.countryCode;
            }

            // Для нерезидентов город/район ВСЕГДА в поле district и в ВЕРХНЕМ РЕГИСТРЕ
            if (entityType && entityType.includes("NON_RESIDENT")) {
                const cityVal = addr.city || addr.district || "";
                if (cityVal) {
                    mappedAddr.district = cityVal.toUpperCase();
                    delete mappedAddr.city;
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
        payload.legal = { ...source.legal };
        if (payload.legal.bin) {
            payload.legal.bin = payload.legal.bin.toString().replace(/\D/g, '');
        }
    }
    if (source.nonResidentLegal) payload.nonResidentLegal = source.nonResidentLegal;
    if (source.person) {
        payload.person = { ...source.person };
        if (payload.person.iin) {
            payload.person.iin = payload.person.iin.toString().replace(/\D/g, '');
        }
    }
    if (source.contacts !== undefined) payload.contacts = source.contacts;
    if (source.nonResidentPerson !== undefined) payload.nonResidentPerson = source.nonResidentPerson;

    return { ...payload, ...extra };
}
const VEHICLE_TYPE_MAP = {
    "TRACTOR": { "id": 1040, "code": "303", "ru": "Грузовой автомобиль общего назначения" },
    "TRAILER": { "id": 1049, "code": "312", "ru": "Грузовой прицеп общего назначения" }
};

const VEHICLE_KIND = { "id": 29, "code": "31", "ru": "Состав транспортных средств (тягач с полуприцепом или прицепом)" };

function buildVehiclePayload(vehiclesData) {
    if (!vehiclesData || !vehiclesData.tractorRegNumber) return null;

    const vehicles = [];

    // Tractor
    const tractor = {
        indexOrder: 0,
        country: COUNTRY_MAP[vehiclesData.tractorCountry] || COUNTRY_MAP["KZ"],
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
            country: COUNTRY_MAP[vehiclesData.trailerCountry] || COUNTRY_MAP[vehiclesData.tractorCountry] || COUNTRY_MAP["KZ"],
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
