const OPENROUTER_API_KEY = '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';
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Стратегия:
const MODEL_VISION = "google/gemini-3-flash-preview"; // Основная модель
const MODEL_TEXT = "google/gemini-3-flash-preview";   // Теперь тоже Gemini

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_SECONDS = 5;
const MAX_DELAY_SECONDS = 10;

/**
 * Wait for specified seconds and update status
 */
async function waitWithCountdown(seconds, customMessage) {
  for (let i = seconds; i > 0; i--) {
    setStatus(`⏳ ${customMessage} ${i}s...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Common fetch with retry logic for OpenRouter
 */
async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const response = await fetch(url, options);
    let data;
    try {
      data = await response.json();
    } catch (e) {
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      throw e;
    }

    // Quota/Rate limit check
    if (response.status === 429 || (data.error && data.error.code === 429)) {
      let retryDelay = Math.min(BASE_DELAY_SECONDS * Math.pow(2, attempt - 1), MAX_DELAY_SECONDS);
      if (attempt >= MAX_RETRIES) throw new Error(`Лимит запросов исчерпан.`);
      console.log(`429 Error. Waiting ${retryDelay}s...`);
      await waitWithCountdown(retryDelay, `Лимит исчерпан, повтор через`);
      return fetchWithRetry(url, options, attempt + 1);
    }

    if (data.error) {
      throw new Error(`API Error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    if (!response.ok) throw new Error(`API failed with status ${response.status}`);

    return data;
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    console.warn(`⚠️ Попытка ${attempt}/${MAX_RETRIES}: ${err.message}`);
    await waitWithCountdown(3, 'Ошибка, повтор через');
    return fetchWithRetry(url, options, attempt + 1);
  }
}

/**
 * Converts internal parts to OpenAI-style content for OpenRouter
 */
function convertToOpenAIContent(filePart, promptText) {
  const content = [{ type: "text", text: promptText }];

  const parts = Array.isArray(filePart) ? filePart : [filePart];

  for (const part of parts) {
    if (part.text) {
      content.push({ type: "text", text: part.text });
    } else if (part.inlineData) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
        }
      });
    }
  }
  return content;
}

/**
 * Балансировщик скобок для исправления обрезанного JSON
 */
function repairJSON(text) {
  let stack = [];
  let isInsideString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') {
      isInsideString = !isInsideString;
      continue;
    }
    if (!isInsideString) {
      if (c === '{') stack.push('}');
      else if (c === '[') stack.push(']');
      else if (c === '}' || c === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === c) {
          stack.pop();
        }
      }
    }
  }

  let repaired = text.trim();

  // Если мы внутри строки, закрываем её
  if (isInsideString) repaired += '"';

  // Убираем их, чтобы JSON был валидным после закрытия скобок
  repaired = repaired.replace(/[:,\s]+$/, "");

  // Удаляем "висячий" ключ без значения, который мог остаться в конце (например, `,"date"`)
  repaired = repaired.replace(/(?:[{,])\s*"[^"]*"?\s*$/, function (match) {
    if (match.trim().startsWith('{')) return '{';
    return '';
  });

  // Закрываем все открытые скобки
  repaired += stack.reverse().join('');
  return repaired;
}

/**
 * Robust JSON extraction and parsing
 */
function safeParseJSON(text) {
  if (!text) throw new Error("Получен пустой ответ от AI");

  try {
    return JSON.parse(text);
  } catch (initialError) {
    console.log("⚠️ Прямой парсинг не удался, пытаюсь очистить и починить JSON...");
    let cleaned = text.trim();

    // 1. Ищем ГРАНИЦЫ. Если JSON явно закончился (есть и { и }), 
    // отрезаем всё лишнее снаружи. Это лечит "мусор в конце".
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      // ПРОВЕРКА: Если между скобками есть другие }, мы можем отрезать лишнее.
      // Но если это просто оборванный JSON, то lastBrace - это просто последняя доступная скобка.
      // Решение: сначала пробуем распарсить кусок ДО последней скобки.
      const candidate = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (e) {
        // Если не вышло, значит JSON внутри битый/оборванный. Идем к шагу 2.
        cleaned = cleaned.substring(firstBrace);
      }
    } else if (firstBrace !== -1) {
      cleaned = cleaned.substring(firstBrace);
    }

    // 2. Базовая чистка
    cleaned = cleaned.replace(/\/\/.*$/gm, "");
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
    cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
    cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

    // 3. Достраиваем скобки
    cleaned = repairJSON(cleaned);

    try {
      return JSON.parse(cleaned);
    } catch (secondError) {
      console.error("❌ Критическая ошибка JSON. Длина текста:", cleaned.length);
      console.error("Текст (последние 100 симв):", cleaned.slice(-100));
      throw new Error(`Ошибка парсинга JSON: ${secondError.message}. Попробуйте отправить файлы еще раз или по одному.`);
    }
  }
}

/**
 * Агент для ПАКЕТНОЙ обработки всех загруженных файлов разом.
 * Теперь отправляет запрос через Background script в Supabase Cloud
 */
async function analyzeAllFilesAgent(fileParts, fileNames) {
  const iin = currentUserInfo && currentUserInfo.iin ? currentUserInfo.iin : '000000000000';

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'ANALYZE_BATCH',
      payload: { iin, fileParts, fileNames }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Ошибка связи: ${chrome.runtime.lastError.message}`));
        return;
      }
      if (response && response.success) {
        resolve(response.result);
      } else {
        reject(new Error(response?.error || 'Облачный ИИ вернул ошибку.'));
      }
    });
  });
}

// Заглушки для legacy (теперь всё идет через пакетный анализ)
async function analyzeSingleFile(filePart, fileName = "legacy_file") {
  return await analyzeAllFilesAgent([filePart], [fileName]);
}

async function askGeminiComplex(inputParts) {
  return await analyzeAllFilesAgent([inputParts], ["legacy_complex"]);
}

