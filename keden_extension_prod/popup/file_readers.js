async function readExcel(file) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    let fullText = "";
    workbook.SheetNames.forEach(name => {
        const sheet = workbook.Sheets[name];
        fullText += `--- Лист: ${name} ---\n`;
        // Используем CSV формат, он лучше сохраняет структуру колонок для ИИ
        fullText += XLSX.utils.sheet_to_csv(sheet) + "\n";
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

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
