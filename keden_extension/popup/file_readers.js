async function readExcel(file) {
    const data = await file.arrayBuffer();
    // cellFormula: false — вычисляет формулы и возвращает значения, а не "=SUM(A1:A5)"
    const workbook = XLSX.read(data, { cellFormula: false, cellNF: false });
    let fullText = "";
    workbook.SheetNames.forEach(name => {
        const sheet = workbook.Sheets[name];
        fullText += `--- Лист: ${name} ---\n`;
        // blankrows: false — убирает пустые строки для экономии токенов
        fullText += XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) + "\n";
    });
    return fullText;
}

async function readPDF(file) {
    const data = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(item => item.str).join(" ") + "\n";
    }
    return fullText;
}

/** Рендерит страницы PDF в изображения для отправки в ИИ как сканы */
async function renderPDFPagesAsImages(file, maxPages = 2) {
    const data = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const images = [];

    // Берем первые maxPages страниц, чтобы не превысить лимиты
    const pagesToProcess = Math.min(pdf.numPages, maxPages);

    for (let i = 1; i <= pagesToProcess; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.1 }); // Оптимально для скорости и OCR

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // Сжимаем в JPEG 0.7
        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        images.push({
            inlineData: {
                data: base64.split(',')[1],
                mimeType: 'image/jpeg'
            }
        });
    }
    return images;
}

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/** Сжимает изображение перед отправкой в ИИ для ускорения работы */
async function fileToOptimizedBase64(file, maxWidth = 1500) {
    const fileName = file.name.toLowerCase();
    const isImage = /\.(jpe?g|png|webp)$/.test(fileName);

    if (!isImage) return fileToBase64(file);

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxWidth) {
                    if (width > height) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    } else {
                        width = Math.round((width * maxWidth) / height);
                        height = maxWidth;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Качество 0.7 достаточно для текста, но экономит 70% размера
                const base64 = canvas.toDataURL('image/jpeg', 0.7);
                resolve(base64.split(',')[1]);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
