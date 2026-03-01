// AI processing is handled via Supabase Edge Functions (background.js → index.ts).

/**
 * Агент для ПАКЕТНОЙ обработки всех загруженных файлов разом.
 * Отправляет запрос через Background script в Supabase Cloud.
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

// Legacy-обёртки: перенаправляют на пакетный анализ
async function analyzeSingleFile(filePart, fileName = "legacy_file") {
  return await analyzeAllFilesAgent([filePart], [fileName]);
}

async function askGeminiComplex(inputParts) {
  return await analyzeAllFilesAgent([inputParts], ["legacy_complex"]);
}
