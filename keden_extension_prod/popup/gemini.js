const GEMINI_API_KEY = 'AIzaSyBXIWN27uFhh5xKFHVwclFpkbE4ZDDc82M';

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 60;

/**
 * Extract retry delay from Gemini error message
 * @param {string} errorMessage - The error message from Gemini API
 * @returns {number} - Delay in seconds, or -1 if not found
 */
function extractRetryDelay(errorMessage) {
  if (!errorMessage) return -1;
  // Look for patterns like "retry in 31s" or "retry after 31 seconds"
  const match = errorMessage.match(/retry\s+(?:in|after)\s+(\d+)\s*s/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return -1;
}

/**
 * Wait for specified seconds and update status
 * @param {number} seconds - Seconds to wait
 * @param {string} customMessage - Custom message to show
 */
async function waitWithCountdown(seconds, customMessage) {
  for (let i = seconds; i > 0; i--) {
    setStatus(`⏳ ${customMessage} ${i}s...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Make API request with retry logic for quota errors (429)
 * @param {string} url - API URL
 * @param {object} options - Fetch options
 * @param {number} attempt - Current attempt number
 * @returns {Promise<object>} - API response data
 */
async function fetchWithRetry(url, options, attempt = 1) {
  const response = await fetch(url, options);
  const data = await response.json();

  // Check for quota error (429)
  if (data.error && data.error.code === 429) {
    const errorMessage = data.error.message || '';

    // Try to extract retry delay from error message
    let retryDelay = extractRetryDelay(errorMessage);

    // If no delay found in message, use exponential backoff
    if (retryDelay <= 0) {
      retryDelay = Math.min(BASE_DELAY_SECONDS * Math.pow(2, attempt - 1), MAX_DELAY_SECONDS);
    }

    // Cap the delay to MAX_DELAY_SECONDS
    retryDelay = Math.min(retryDelay, MAX_DELAY_SECONDS);

    if (attempt >= MAX_RETRIES) {
      throw new Error(`Квота исчерпана. Превышено максимальное количество попыток (${MAX_RETRIES}). Попробуйте позже.`);
    }

    console.log(`Quota exceeded (429). Attempt ${attempt}/${MAX_RETRIES}. Waiting ${retryDelay}s before retry...`);
    await waitWithCountdown(retryDelay, `Квота исчерпана, повтор через`);

    // Retry with increased attempt number
    return fetchWithRetry(url, options, attempt + 1);
  }

  // Throw other errors
  if (data.error) {
    throw new Error('Gemini API Error: ' + data.error.message);
  }

  return data;
}

async function askGeminiComplex(inputParts) {
  console.log('Calling Gemini API (PI Fast Mode)...');
  setStatus('🤖 Gemini изучает документы...');

  const promptPart = {
    text: `
            Ты - эксперт по ПИ (Предварительное Информирование) в таможенной системе Keden.
            Твоя задача: проанализировать документы (инвойсы, CMR) и извлечь данные по контрагентам и транспортным средствам.
            
            ВАЖНО:
            1. Для страны используй только 2-буквенный код ISO (CN, KZ, AF, RU и т.д.).
            2. ТРАНСПОРТ: Ищи регистрационные номера тягача (tractor) и прицепа (trailer).
            3. БИН/ИИН: ВСЕГДА должны состоять ровно из 12 цифр. Если в документе число меньше или больше 12 цифр - это НЕ БИН/ИИН, игнорируй его для этих полей.
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const body = JSON.stringify({
    contents: [{ parts: [promptPart, ...inputParts] }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  });

  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body
  });

  console.log('Gemini raw response:', data);

  const resultText = data.candidates[0].content.parts[0].text;
  return JSON.parse(resultText.replace(/```json/g, '').replace(/```/g, '').trim());
}
