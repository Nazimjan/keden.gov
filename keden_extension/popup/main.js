/**
 * KEDEN Extension - POPUP (Main Entry Point)
 * Swarm Agent Architecture: 2-Phase Processing
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
        // =====================================================
        // ФАЗА 1: Подготовка файлов (последовательно, быстро)
        // =====================================================
        const fileJobs = [];

        for (const file of files) {
            const fileName = file.name.toLowerCase();
            const isImage = /\.(png|jpe?g|webp)$/.test(fileName);
            const isExcel = /\.(xlsx|xls)$/.test(fileName);
            let filePart = null;
            let mimeType = file.type || 'application/octet-stream';

            try {
                if (fileName.endsWith('.pdf')) {
                    try {
                        let text = await readPDF(file);
                        // Если PDF цифровой (есть текст), используем текст - это быстрее и дешевле
                        if (text.trim().length < 100) throw new Error('Scan detected');

                        const MAX_CHARS = 30000;
                        if (text.length > MAX_CHARS) {
                            text = text.substring(0, MAX_CHARS) + '\n... [TRUNCATED]';
                        }
                        filePart = { text: `--- FILE: ${file.name} (PDF Content) ---\n${text}\n` };
                    } catch (pdfErr) {
                        console.log(`📎 ${file.name}: скан PDF, рендерим страницы как изображения...`);
                        filePart = await renderPDFPagesAsImages(file, 5); // рендерим первые 5 страниц
                    }
                } else if (isExcel) {
                    console.log(`📊 ${file.name}: Excel, отправляем в MiniMax...`);
                    const text = await readExcel(file);
                    if (!text || text.length < 10) {
                        throw new Error("Файл Excel пустой или не читается");
                    }
                    filePart = { text: `--- FILE: ${file.name} (Excel Content) ---\n${text}\n` };
                } else if (isImage) {
                    console.log(`🖼️ ${file.name}: изображение, отправляем в Qwen 3.5...`);
                    const base64 = await fileToOptimizedBase64(file);
                    filePart = { inlineData: { data: base64, mimeType: 'image/jpeg' } };
                } else {
                    let text = await file.text();
                    const MAX_CHARS = 30000;
                    if (text.length > MAX_CHARS) {
                        text = text.substring(0, MAX_CHARS) + '\n... [TRUNCATED]';
                    }
                    filePart = { text: `--- FILE: ${file.name} (Text Content) ---\n${text}\n` };
                }
            } catch (prepErr) {
                console.warn(`Ошибка подготовки ${file.name}:`, prepErr);
                filePart = { text: `--- FILE: ${file.name} (Could not read) ---\n` };
            }

            fileJobs.push({ file, filePart, mimeType });
        }

        // =====================================================
        // ФАЗА 2: Агенты работают с ограничением параллелизма (макс 3 одновременно)
        // =====================================================
        // --- ЗАПУСК АГЕНТОВ (РАБОЧИЙ ПУЛ) ---
        const MAX_CONCURRENT = 15; // Максимальная скорость
        setStatus(`🤖 ${files.length} файлов, обработка по ${MAX_CONCURRENT} параллельно...`);
        let completed = 0;

        const results = [];
        const queue = [...fileJobs];

        async function processJob(job) {
            try {
                const result = await analyzeFileAgent(job.filePart, job.file.name);
                completed++;
                setStatus(`🤖 Готово ${completed}/${files.length} файлов...`);
                return { status: 'ok', result, job };
            } catch (err) {
                completed++;
                console.warn(`Ошибка агента ${job.file.name}:`, err);
                setStatus(`🤖 Готово ${completed}/${files.length} файлов...`);
                return {
                    status: 'error', job,
                    result: {
                        filename: job.file.name,
                        error: err.message,
                        document: { type: 'UNKNOWN', number: '', date: '' },
                        counteragents: { consignor: { present: false }, consignee: { present: false }, carrier: { present: false } },
                        products: [],
                        vehicles: {},
                        driver: { present: false }
                    }
                };
            }
        }

        // Пул воркеров: строго MAX_CONCURRENT одновременно
        async function runPool() {
            const workers = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                workers.push((async () => {
                    while (queue.length > 0) {
                        const job = queue.shift();
                        if (!job) break;
                        const res = await processJob(job);
                        results.push(res);
                    }
                })());
            }
            await Promise.all(workers);
        }
        await runPool();

        const settled = results;

        const agentResults = settled.map(s => s.result);
        const processedFiles = settled.map(s => {
            const fp = s.job.filePart;
            const base64 = fp.inlineData ? fp.inlineData.data :
                btoa(unescape(encodeURIComponent(fp.text || '')));
            return {
                name: s.job.file.name,
                base64: base64,
                mimeType: s.job.mimeType,
                isBinary: !!fp.inlineData
            };
        });

        // Debug: показываем размер результатов
        const resultsJson = JSON.stringify(agentResults);
        console.log(`📊 Agent results size: ${resultsJson.length} chars (~${Math.round(resultsJson.length / 4)} tokens). Files: ${files.length}`);

        // =====================================================
        // ФАЗА 3: JS-мерж объединяет результаты (мгновенно)
        // =====================================================
        setStatus('🔧 Объединение результатов...');

        const finalData = mergeAgentResults(agentResults);
        finalData.rawFiles = processedFiles; // Attach raw files for later use

        showLoading(false);
        // Pass everything to renderPreview (data + validation + documents list)
        renderPreview(finalData);
        setStatus('✅ Анализ завершен. Проверьте данные и ошибки ниже.');

    } catch (error) {
        console.error(error);
        setStatus('❌ ' + error.message);
        showLoading(false);
    }
};

// Add listener to show file names when selected
document.getElementById('fileInput').onchange = (e) => {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        files.forEach(f => {
            const div = document.createElement('div');
            div.textContent = `📄 ${f.name}`;
            fileList.appendChild(div);
        });
    }
};

document.getElementById('confirmFillBtn').onclick = async () => {
    logButtonClick('confirmFillBtn');

    // Validation errors check removed as per user request to never block filling
    /*
    if (currentAIData && currentAIData.validation && currentAIData.validation.errors && currentAIData.validation.errors.length > 0) {
        alert('Пожалуйста, исправьте ошибки перед заполнением. ' + currentAIData.validation.errors[0].message);
        return;
    }
    */

    const scrapedData = scrapePreviewData();
    if (!scrapedData) return;

    showLoading(true);
    setStatus('🚀 Заполнение ПИ...');

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('keden.kgd.gov.kz')) {
            const tabs = await chrome.tabs.query({ url: "*://test-keden.kgd.gov.kz/*" });
            const kedenTab = tabs.find(t => t.url && t.url.includes('keden.kgd.gov.kz'));
            if (kedenTab) tab = kedenTab;
            else throw new Error('Откройте вкладку Keden с ПИ декларацией');
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
