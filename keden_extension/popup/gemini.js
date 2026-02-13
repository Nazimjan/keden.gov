const GEMINI_API_KEY = 'AIzaSyBXIWN27uFhh5xKFHVwclFpkbE4ZDDc82M';

async function askGeminiComplex(inputParts) {
  console.log('Calling Gemini API (PI Fast Mode)...');
  setStatus('🤖 Gemini изучает документы...');

  const promptPart = {
    text: `
            Ты - эксперт по ПИ (Предварительное Информирование) в таможенной системе Keden.
            Твоя задача: проанализировать документы (инвойсы, CMR) и извлечь данные по контрагентам и транспортным средствам.
            
            ВАЖНО:
            1. Для страны используй только 2-буквенный код ISO (CN, KZ, AF, RU и т.д.).
            2. СТРАНЫ: Обязательно определи "Страну отправления" (departureCountry) и "Страну назначения" (destinationCountry). Обычно это CN (Китай) и AF (Афганистан) или KZ (Казахстан).
            3. ТРАНСПОРТ: Ищи регистрационные номера тягача (tractor) и прицепа (trailer).
            4. БИН/ИИН: ВСЕГДА должны состоять ровно из 12 цифр. Если в документе число меньше или больше 12 цифр - это НЕ БИН/ИИН, игнорируй его для этих полей.
            4. Если у контрагента есть БИН/ИИН (12 цифр) - это РЕЗИДЕНТ (entityType: "LEGAL" или "PERSON").
            5. Если БИН нет, но это иностранная компания - это НЕРЕЗИДЕНТ (entityType: "NON_RESIDENT_LEGAL").
            6. Для НЕРЕЗИДЕНТОВ город/населенный пункт пиши ТАКЖЕ в поле "district" ВЕРХНИМ РЕГИСТРОМ (например: "KHORGOS").
            7. Для Перевозчика (carrier) обязательно ищи адрес, если он нерезидент.
            8. ТОВАРЫ:
               - Извлеки список товаров.
               - Для каждого товара обязателен код ТН ВЭД (tnvedCode).
               - ВАЖНО: возвращай ТОЛЬКО первых 6 цифр кода ТН ВЭД. Это критически важно.
               - Если в документе 10 цифр, обрежь до 6.
            
            ПРАВИЛА ДЛЯ EXCEL (CSV):
            - Данные часто идут в колонках: Перевозчик, Отправитель, Получатель.
            - Будь внимателен: адрес во второй колонке относится к Отправителю, в третьей - к Получателю. 
            - Не перепутай БИН перевозчика с БИН получателя.
            - Если видишь "БИН 201040018125" - это Carrier, НЕ придумывай другие числа.

            ФОРМАТ JSON:
            {
              "counteragents": {
                "consignor": {
                  "present": true,
                  "entityType": "NON_RESIDENT_LEGAL",
                  "nonResidentLegal": { "nameRu": "НАЗВАНИЕ_КОМПАНИИ" },
                  "addresses": [{
                    "addressType": {"id": 2014, "code": "1", "ru": "Адрес регистрации"},
                    "countryCode": "CN",
                    "district": "ГОРОД_ВЕРХНИМ_РЕГИСТРОМ"
                  }]
                },
                "consignee": {
                  "present": true,
                  "entityType": "LEGAL или NON_RESIDENT_LEGAL",
                  "legal": { "bin": "БИН", "nameRu": "НАЗВАНИЕ" },
                  "nonResidentLegal": { "nameRu": "НАЗВАНИЕ" },
                  "addresses": [{
                    "addressType": {"id": 2014, "code": "1", "ru": "Адрес регистрации"},
                    "countryCode": "AF",
                    "district": "ГОРОД_ВЕРХНИМ_РЕГИСТРОМ"
                  }]
                },
                "carrier": {
                  "present": true,
                  "entityType": "LEGAL или NON_RESIDENT_LEGAL",
                  "legal": { "bin": "БИН_12_ЦИФР", "nameRu": "ДАННЫЕ_ПОДТЯНУТСЯ_ПО_БИН" },
                  "nonResidentLegal": { "nameRu": "НАЗВАНИЕ" },
                  "addresses": [{
                    "addressType": {"id": 2014, "code": "1", "ru": "Адрес регистрации"},
                    "countryCode": "ISO_CODE",
                    "district": "ГОРОД_ВЕРХНИМ_РЕГИСТРОМ"
                  }]
                },
                "declarant": {
                  "present": true,
                  "entityType": "LEGAL",
                  "legal": { "bin": "БИН_12_ЦИФР", "nameRu": "ДАННЫЕ_ПОДТЯНУТСЯ_ПО_БИН" }
                },
                "filler": {
                  "present": true,
                  "entityType": "PERSON",
                  "person": { "iin": "ИИН_12_ЦИФР", "lastName": "ФАМИЛИЯ", "firstName": "ИМЯ", "middleName": "ОТЧЕСТВО" }
                }
              },
              "countries": {
                "departureCountry": "CN",
                "destinationCountry": "AF"
              },
              "vehicles": {
                "tractorRegNumber": "НОМЕР_ТЯГАЧА",
                "tractorCountry": "ISO_CODE",
                "trailerRegNumber": "НОМЕР_ПРИЦЕПА_ЕСЛИ_ЕСТЬ",
                "trailerCountry": "ISO_CODE_ЕСЛИ_ЕСТЬ"
              },
              "driver": {
                "present": true,
                "iin": "ИИН_ВОДИТЕЛЯ_12_ЦИФР",
                "firstName": "ИМЯ",
                "lastName": "ФАМИЛИЯ"
              },
              "products": [
                {
                  "tnvedCode": "6_DIGITS_ONLY",
                  "commercialName": "DESCRIPTION",
                  "grossWeight": 100,
                  "cost": 500, // Total cost of this product line
                  "currencyCode": "USD", // ISO currency code
                  "quantity": 10, // Number of packages/seats (Кол-во мест)
                  "packageType": "PK" // Package type code (e.g., PK, BX, CT)
                }
              ]
            }
        `
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [promptPart, ...inputParts] }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json();
  console.log('Gemini raw response:', data);

  if (data.error) throw new Error('Gemini API Error: ' + data.error.message);
  const resultText = data.candidates[0].content.parts[0].text;
  return JSON.parse(resultText.replace(/```json/g, '').replace(/```/g, '').trim());
}
