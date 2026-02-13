function logButtonClick(buttonId) {
    console.log('[popup] Button click:', {
        buttonId,
        timestamp: new Date().toISOString()
    });
}

function setStatus(msg) {
    const el = document.getElementById('statusMessage');
    el.style.display = 'block';
    el.innerText = msg;
}

function showLoading(show) {
    document.getElementById('loader').style.display = show ? 'block' : 'none';
    document.getElementById('startBtn').disabled = show;
}

function handleFiles(files) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';

    if (files.length > 0) {
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'file-item';
            item.style.padding = '4px';
            item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
            item.innerText = `📄 ${file.name}`;
            fileList.appendChild(item);
        });
        document.getElementById('statusMessage').style.display = 'block';
        document.getElementById('statusMessage').innerText = `Выбрано файлов: ${files.length}`;
    }
}

// Drag and drop logic
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

if (dropZone && fileInput) {
    dropZone.onclick = () => fileInput.click();

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#3b82f6';
        dropZone.style.background = 'rgba(59, 130, 246, 0.05)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        dropZone.style.background = 'transparent';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        dropZone.style.background = 'transparent';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            handleFiles(Array.from(files));
        }
    });

    fileInput.onchange = (e) => {
        handleFiles(Array.from(e.target.files));
    };
}

let currentAIData = null;

function renderPreview(data) {
    currentAIData = data;
    const previewArea = document.getElementById('previewArea');
    const previewContent = document.getElementById('previewContent');
    const container = document.getElementById('mainContainer');

    previewContent.innerHTML = '';
    if (container) container.classList.add('expanded');

    // previewArea is already display:block via .expanded .preview-panel in CSS
    // but we can ensure it here if needed, or just let CSS handle it.
    // However, the original code had previewArea.style.display = 'block';
    // Let's stick to adding classes for layout.


    // 1. Vehicles Section
    if (data.vehicles) {
        const v = data.vehicles;
        const section = document.createElement('div');
        section.className = 'preview-section';
        section.innerHTML = `
                <h3>Транспорт и Маршрут</h3>
                <div class="row" style="margin-bottom: 8px;">
                    <div style="flex: 1;">
                        <label style="font-size: 10px; color: #64748b;">Тягач (Номер)</label>
                        <input type="text" class="preview-input" id="prev-tractor-num" value="${v.tractorRegNumber || ''}">
                    </div>
                    <div style="width: 60px;">
                        <label style="font-size: 10px; color: #64748b;">Страна ТС</label>
                        <input type="text" class="preview-input" id="prev-tractor-country" value="${v.tractorCountry || ''}">
                    </div>
                </div>
                <div class="row" style="margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <label style="font-size: 10px; color: #64748b;">Прицеп (Номер)</label>
                        <input type="text" class="preview-input" id="prev-trailer-num" value="${v.trailerRegNumber || ''}">
                    </div>
                    <div style="width: 60px;">
                        <label style="font-size: 10px; color: #64748b;">Страна ТС</label>
                        <input type="text" class="preview-input" id="prev-trailer-country" value="${v.trailerCountry || ''}">
                    </div>
                </div>
                
                <div class="row" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                    <div style="flex: 1;">
                        <label style="font-size: 10px; color: #64748b;">Страна отправления</label>
                        <input type="text" class="preview-input" id="prev-departure-country" value="${data.countries?.departureCountry || ''}" placeholder="ISO (например, CN)">
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 10px; color: #64748b;">Страна назначения</label>
                        <input type="text" class="preview-input" id="prev-destination-country" value="${data.countries?.destinationCountry || ''}" placeholder="ISO (например, AF)">
                    </div>
                </div>
            `;
        previewContent.appendChild(section);
    }

    // 2. Counteragents Section
    if (data.counteragents) {
        const ca = data.counteragents;
        const section = document.createElement('div');
        section.className = 'preview-section';
        section.innerHTML = `<h3>Контрагенты</h3>`;

        const agents = [
            { id: 'consignee', label: 'Получатель (БИН/ИИН)', data: ca.consignee },
            { id: 'carrier', label: 'Перевозчик (БИН/ИИН)', data: ca.carrier },
            { id: 'declarant', label: 'Декларант (БИН/ИИН)', data: ca.declarant }
        ];

        agents.forEach(agent => {
            if (agent.data) {
                const bin = agent.data.legal?.bin || agent.data.person?.iin || '';
                const name = agent.data.legal?.nameRu || agent.data.nonResidentLegal?.nameRu || agent.data.person?.lastName || '';
                const div = document.createElement('div');
                div.style.marginBottom = '8px';
                div.innerHTML = `
                    <label style="font-size: 10px; color: #64748b; display: block; margin-bottom: 2px;">${agent.label}</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" class="preview-input" id="prev-agent-bin-${agent.id}" value="${bin}" placeholder="БИН/ИИН" style="width: 130px; flex-shrink: 0;">
                        <input type="text" class="preview-input" id="prev-agent-name-${agent.id}" value="${name}" placeholder="Название" style="flex: 1;">
                    </div>
                `;
                section.appendChild(div);
            }
        });
        previewContent.appendChild(section);
    }

    // 2.5 Driver Section
    if (data.driver && data.driver.present) {
        const section = document.createElement('div');
        section.className = 'preview-section';
        section.innerHTML = `
            <h3>Водитель</h3>
            <div class="preview-row">
                <span class="preview-label">ИИН:</span>
                <input type="text" class="preview-input" id="prev-driver-iin" value="${data.driver.iin || ''}" placeholder="ИИН">
            </div>
            <div class="preview-row">
                <span class="preview-label">ФИО:</span>
                <div style="display: flex; gap: 4px;">
                    <input type="text" class="preview-input" id="prev-driver-lastName" value="${data.driver.lastName || ''}" placeholder="Фамилия">
                    <input type="text" class="preview-input" id="prev-driver-firstName" value="${data.driver.firstName || ''}" placeholder="Имя">
                </div>
            </div>
        `;
        previewContent.appendChild(section);
    }

    // 3. Products Section
    if (data.products && data.products.length > 0) {
        const section = document.createElement('div');
        section.className = 'preview-section';
        section.innerHTML = `
            <h3>Товары</h3>
            <table class="preview-table" style="table-layout: fixed;">
                <thead>
                    <tr>
                        <th style="width: 12%;">ТНВЭД</th>
                        <th style="width: 38%;">Наименование</th>
                        <th style="width: 14%;">Вес(кг)</th>
                        <th style="width: 12%;">Мест</th>
                        <th style="width: 15%;">Сумма</th>
                        <th style="width: 9%;">Вал.</th>
                    </tr>
                </thead>
                <tbody id="prev-products-body"></tbody>
            </table>
        `;
        previewContent.appendChild(section);
        const tbody = section.querySelector('#prev-products-body');
        data.products.forEach((p, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" class="preview-input prev-prod-tnved" value="${p.tnvedCode || ''}" data-index="${i}"></td>
                <td><input type="text" class="preview-input prev-prod-name" value="${p.commercialName || ''}" data-index="${i}"></td>
                <td><input type="number" class="preview-input prev-prod-weight" value="${p.grossWeight || ''}" data-index="${i}" style="text-align: center;"></td>
                <td><input type="number" class="preview-input prev-prod-qty" value="${p.quantity || ''}" data-index="${i}" style="text-align: center;"></td>
                <td><input type="number" class="preview-input prev-prod-cost" value="${p.cost || ''}" data-index="${i}" style="text-align: center;"></td>
                <td><input type="text" class="preview-input prev-prod-curr" value="${p.currencyCode || 'USD'}" data-index="${i}" style="text-align: center;"></td>
            `;
            tbody.appendChild(tr);
        });

        // Add Totals Footer
        const totalsDiv = document.createElement('div');
        totalsDiv.id = 'preview-totals';
        totalsDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: rgba(168, 85, 247, 0.1); border-radius: 8px; border: 1px solid rgba(168, 85, 247, 0.2); font-size: 12px; display: flex; gap: 20px;';
        previewContent.appendChild(totalsDiv);

        function updateTotals() {
            let totalWeight = 0;
            let totalQty = 0;
            let totalCost = 0;

            document.querySelectorAll('.prev-prod-weight').forEach(el => totalWeight += parseFloat(el.value || 0));
            document.querySelectorAll('.prev-prod-qty').forEach(el => totalQty += parseFloat(el.value || 0));
            document.querySelectorAll('.prev-prod-cost').forEach(el => totalCost += parseFloat(el.value || 0));

            const curr = document.querySelector('.prev-prod-curr')?.value || 'USD';

            totalsDiv.innerHTML = `
                <div><strong>Итого вес:</strong> ${totalWeight.toFixed(2)} кг</div>
                <div><strong>Итого мест:</strong> ${totalQty}</div>
                <div><strong>Итого сумма:</strong> ${totalCost.toFixed(2)} ${curr}</div>
            `;
        }

        // Add listeners for real-time recalculation
        section.addEventListener('input', (e) => {
            if (e.target.classList.contains('preview-input')) {
                updateTotals();
            }
        });

        updateTotals();

        // Trigger TNVED validation after rendering products
        if (typeof validateAllVisibleTNVEDInputs === 'function') {
            // Add a small status indicator for validation progress
            const validationStatus = document.createElement('div');
            validationStatus.id = 'tnved-validation-status';
            validationStatus.style.cssText = 'margin-top: 8px; font-size: 11px; color: #94a3b8;';
            validationStatus.innerHTML = '🔄 Проверка кодов ТН ВЭД...';
            section.appendChild(validationStatus);

            validateAllVisibleTNVEDInputs().then(() => {
                const validCount = document.querySelectorAll('.prev-prod-tnved.tnved-valid').length;
                const invalidCount = document.querySelectorAll('.prev-prod-tnved.tnved-invalid').length;
                const total = validCount + invalidCount;

                if (invalidCount === 0) {
                    validationStatus.innerHTML = `✅ Анализ завершен. Проверьте данные ниже.`;
                    validationStatus.style.color = '#22c55e';
                } else {
                    validationStatus.innerHTML = `⚠️ Найдено ${invalidCount} из ${total} кодов с ошибками`;
                    validationStatus.style.color = '#ef4444';
                }
            });
        }
    }
}

function scrapePreviewData() {
    if (!currentAIData) return null;
    const newData = JSON.parse(JSON.stringify(currentAIData));

    // Scrape Vehicles & Countries
    if (newData.vehicles) {
        newData.vehicles.tractorRegNumber = document.getElementById('prev-tractor-num')?.value;
        newData.vehicles.tractorCountry = document.getElementById('prev-tractor-country')?.value;
        newData.vehicles.trailerRegNumber = document.getElementById('prev-trailer-num')?.value;
        newData.vehicles.trailerCountry = document.getElementById('prev-trailer-country')?.value;
    }

    const depInput = document.getElementById('prev-departure-country');
    const destInput = document.getElementById('prev-destination-country');
    if (depInput || destInput) {
        if (!newData.countries) newData.countries = {};
        newData.countries.departureCountry = depInput?.value || "";
        newData.countries.destinationCountry = destInput?.value || "";
    }

    // Scrape Counteragents ... (no changes needed)
    const agents = ['consignee', 'carrier', 'declarant'];
    agents.forEach(id => {
        const binInput = document.getElementById(`prev-agent-bin-${id}`);
        if (binInput && newData.counteragents[id]) {
            const bin = binInput.value;
            if (newData.counteragents[id].legal) newData.counteragents[id].legal.bin = bin;
            else if (newData.counteragents[id].person) newData.counteragents[id].person.iin = bin;
        }
    });

    // Scrape Driver
    const driverIinInput = document.getElementById('prev-driver-iin');
    const driverFirstInput = document.getElementById('prev-driver-firstName');
    const driverLastInput = document.getElementById('prev-driver-lastName');

    if (driverIinInput || driverFirstInput) {
        if (!newData.driver) newData.driver = { present: true };
        newData.driver.iin = driverIinInput?.value || "";
        newData.driver.firstName = driverFirstInput?.value || "";
        newData.driver.lastName = driverLastInput?.value || "";
        newData.driver.present = true;
    }

    // Scrape Products
    const prodTnveds = document.querySelectorAll('.prev-prod-tnved');
    const prodNames = document.querySelectorAll('.prev-prod-name');
    const prodWeights = document.querySelectorAll('.prev-prod-weight');
    const prodQtys = document.querySelectorAll('.prev-prod-qty');
    const prodCosts = document.querySelectorAll('.prev-prod-cost');
    const prodCurrs = document.querySelectorAll('.prev-prod-curr');

    prodTnveds.forEach((input, i) => {
        const index = parseInt(input.dataset.index);
        if (newData.products[index]) {
            newData.products[index].tnvedCode = input.value;
            newData.products[index].commercialName = prodNames[i].value;
            newData.products[index].grossWeight = prodWeights[i].value;
            newData.products[index].quantity = prodQtys[i].value;
            newData.products[index].cost = prodCosts[i].value;
            newData.products[index].currencyCode = prodCurrs[i].value;
        }
    });

    return newData;
}
