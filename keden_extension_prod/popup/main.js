/**
 * KEDEN Extension - POPUP (Main Entry Point)
 */

document.getElementById('openTabBtn').onclick = () => {
    logButtonClick('openTabBtn');
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
};

document.getElementById('startBtn').onclick = async () => {
    logButtonClick('startBtn');
    const fileInput = document.getElementById('fileInput');
    const files = Array.from(fileInput.files);

    if (files.length === 0) {
        alert('Пожалуйста, выберите хотя бы один файл');
        return;
    }

    showLoading(true);

    try {
        const parts = [];
        let combinedText = "";

        for (const file of files) {
            const fileName = file.name.toLowerCase();
            const isImage = /\.(png|jpe?g|webp)$/.test(fileName);
            setStatus(`⏳ Обработка ${file.name}...`);

            if (fileName.endsWith('.pdf')) {
                try {
                    const text = await readPDF(file);
                    combinedText += `\n--- FILE: ${file.name} --- \n${text}\n`;
                } catch (e) {
                    const base64 = await fileToBase64(file);
                    parts.push({ inlineData: { data: base64, mimeType: 'application/pdf' } });
                }
            } else if (fileName.endsWith('.xlsx')) {
                const text = await readExcel(file);
                combinedText += `\n--- FILE: ${file.name} --- \n${text}\n`;
            } else if (isImage) {
                const base64 = await fileToBase64(file);
                let mimeType = file.type;
                if (!mimeType) {
                    if (fileName.endsWith('.png')) mimeType = 'image/png';
                    else if (fileName.endsWith('.webp')) mimeType = 'image/webp';
                    else mimeType = 'image/jpeg';
                }
                parts.push({ inlineData: { data: base64, mimeType: mimeType } });
            } else {
                const text = await file.text();
                combinedText += `\n--- FILE: ${file.name} --- \n${text}\n`;
            }
        }

        if (combinedText) {
            parts.push({ text: combinedText });
        }

        setStatus('🤖 Gemini анализирует всё...');
        const aiData = await askGeminiComplex(parts);

        showLoading(false);
        renderPreview(aiData);
        setStatus('✅ Анализ завершен. Проверьте данные ниже.');

    } catch (error) {
        console.error(error);
        setStatus('❌ ' + error.message);
        showLoading(false);
    }
};

document.getElementById('confirmFillBtn').onclick = async () => {
    logButtonClick('confirmFillBtn');
    const scrapedData = scrapePreviewData();
    if (!scrapedData) return;

    showLoading(true);
    setStatus('🚀 Заполнение ПИ...');

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // Check if we are on the production site. If not, look for a production tab.
        if (!tab || !tab.url || !tab.url.includes('keden.kgd.gov.kz') || tab.url.includes('test-keden')) {
            const tabs = await chrome.tabs.query({ url: "https://keden.kgd.gov.kz/*" });
            if (tabs.length > 0) tab = tabs[0];
            else throw new Error('Откройте вкладку Keden с ПИ декларацией (боевую)');
        }

        chrome.tabs.sendMessage(tab.id, { action: 'FILL_PI_DATA', data: scrapedData }, (response) => {
            if (chrome.runtime.lastError) {
                setStatus('❌ Ошибка: Обновите страницу Keden');
                showLoading(false);
                return;
            }
            if (response && response.success) {
                setStatus('✅ Готово!');
                setTimeout(() => window.close(), 2000);
            } else {
                setStatus('❌ ' + (response ? response.error : 'Ошибка'));
            }
            showLoading(false);
        });
    } catch (error) {
        console.error(error);
        setStatus('❌ ' + error.message);
        showLoading(false);
    }
};
