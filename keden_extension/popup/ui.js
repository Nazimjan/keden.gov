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

window.appExtensionFiles = [];

function handleFiles(newFiles) {
    window.appExtensionFiles = window.appExtensionFiles.concat(newFiles);
    renderFileList();
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';

    if (window.appExtensionFiles.length > 0) {
        window.appExtensionFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'file-item';
            item.style.cssText = 'padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;';

            const nameSpan = document.createElement('span');
            nameSpan.innerText = `📄 ${file.name}`;
            nameSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px;';
            nameSpan.title = file.name;

            const removeBtn = document.createElement('button');
            removeBtn.innerText = '✖';
            removeBtn.style.cssText = 'background: none; border: none; color: #ef4444; cursor: pointer; font-size: 14px; padding: 0 4px; border-radius: 4px; transition: background 0.2s;';
            removeBtn.onmouseover = () => removeBtn.style.background = 'rgba(239, 68, 68, 0.1)';
            removeBtn.onmouseout = () => removeBtn.style.background = 'none';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                window.appExtensionFiles.splice(index, 1);
                renderFileList();
            };

            item.appendChild(nameSpan);
            item.appendChild(removeBtn);
            fileList.appendChild(item);
        });
        document.getElementById('statusMessage').style.display = 'block';
        document.getElementById('statusMessage').innerText = `Выбрано файлов: ${window.appExtensionFiles.length}`;
    } else {
        document.getElementById('statusMessage').style.display = 'none';
        document.getElementById('statusMessage').innerText = '';
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
            handleFiles(Array.from(files));
        }
    });

    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            handleFiles(Array.from(e.target.files));
        }
        // Сбрасываем input, чтобы можно было выбрать тот же файл еще раз, если его удалили из списка
        e.target.value = '';
    };
}

let kedenDirectorySettings = {};

// Загрузка настроек справочника
chrome.storage.local.get(['kedenDirectorySettings'], (result) => {
    if (result.kedenDirectorySettings) {
        kedenDirectorySettings = result.kedenDirectorySettings;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; }
        setVal('prefCarrierBin', kedenDirectorySettings.carrierBin);
        setVal('prefDeclarantBin', kedenDirectorySettings.declarantBin);

        setVal('prefCustomsCode', kedenDirectorySettings.customsCode);
        setVal('prefTransportMode', kedenDirectorySettings.transportMode);
        setVal('prefRepCertNum', kedenDirectorySettings.repCertNum);
        setVal('prefRepCertDate', kedenDirectorySettings.repCertDate);
        setVal('prefAeoCertNum', kedenDirectorySettings.aeoCertNum);
        setVal('prefAeoCertDate', kedenDirectorySettings.aeoCertDate);
        setVal('prefPoaNum', kedenDirectorySettings.poaNum);
        setVal('prefPoaDateStr', kedenDirectorySettings.poaDateStr);
        setVal('prefPoaDateEnd', kedenDirectorySettings.poaDateEnd);
    }
});

// Управление панелью настроек
document.getElementById('settingsBtn').onclick = () => {
    document.getElementById('settingsPanel').style.display = 'block';
};

document.getElementById('closeSettingsBtn').onclick = () => {
    document.getElementById('settingsPanel').style.display = 'none';
};

document.getElementById('saveSettingsBtn').onclick = () => {
    kedenDirectorySettings = {
        carrierBin: document.getElementById('prefCarrierBin').value.trim(),
        declarantBin: document.getElementById('prefDeclarantBin').value.trim(),

        customsCode: document.getElementById('prefCustomsCode').value.trim(),
        transportMode: document.getElementById('prefTransportMode').value.trim(),
        repCertNum: document.getElementById('prefRepCertNum').value.trim(),
        repCertDate: document.getElementById('prefRepCertDate').value.trim(),
        aeoCertNum: document.getElementById('prefAeoCertNum').value.trim(),
        aeoCertDate: document.getElementById('prefAeoCertDate').value.trim(),
        poaNum: document.getElementById('prefPoaNum').value.trim(),
        poaDateStr: document.getElementById('prefPoaDateStr').value.trim(),
        poaDateEnd: document.getElementById('prefPoaDateEnd').value.trim()
    };
    chrome.storage.local.set({ kedenDirectorySettings }, () => {
        const status = document.getElementById('settingsSaveStatus');
        status.style.display = 'block';
        setTimeout(() => status.style.display = 'none', 2000);
    });
};

let currentAIData = null;
let registryDocumentFileBase64 = null;
let registryDocumentMimeType = null;
let registryDocumentFileName = null;

function renderPreview(aiResponse) {
    // Handle both old and new structures
    const data = aiResponse.mergedData || aiResponse;
    const validation = aiResponse.validation || { errors: [], warnings: [] };
    let documents = aiResponse.documents || [];

    // --- ПРИМЕНЕНИЕ НАСТРОЕК (СПРАВОЧНИК) ---
    if (data.counteragents) {
        const ca = data.counteragents;

        // Вспомогательная функция для проставления БИН/ИИН, если справочник заполнен
        const applyBin = (agent, bin) => {
            if (bin) {
                if (!agent) agent = { present: true, entityType: 'LEGAL' };
                else agent.present = true;

                if (agent.entityType === 'PHYSICAL' || agent.entityType === 'IE') {
                    if (!agent.person) agent.person = {};
                    agent.person.iin = bin;
                } else {
                    if (!agent.legal) agent.legal = {};
                    agent.legal.bin = bin;
                }
            }
            return agent;
        };

        ca.carrier = applyBin(ca.carrier, kedenDirectorySettings.carrierBin);
        ca.declarant = applyBin(ca.declarant, kedenDirectorySettings.declarantBin);

        // Для Заполнителя у нас person.iin или сразу iin, но мы обычно используем iin и powerOfAttorney
        if (kedenDirectorySettings.fillerBin) {
            if (!ca.filler) ca.filler = { present: true, role: "FILLER_DECLARANT" };
            else ca.filler.present = true;
            ca.filler.iin = kedenDirectorySettings.fillerBin;
        }

        // Свидетельство представителя (для декларанта)
        if (kedenDirectorySettings.repCertNum || kedenDirectorySettings.repCertDate) {
            if (!ca.declarant) ca.declarant = { present: true, entityType: 'LEGAL' };
            ca.declarant.present = true;
            ca.declarant.representativeCertificate = {
                docNumber: kedenDirectorySettings.repCertNum || (ca.declarant.representativeCertificate?.docNumber || ""),
                docDate: kedenDirectorySettings.repCertDate || (ca.declarant.representativeCertificate?.docDate || "")
            };
        }

        // Доверенность (для заполнителя)
        if (kedenDirectorySettings.poaNum || kedenDirectorySettings.poaDateStr || kedenDirectorySettings.poaDateEnd) {
            if (!ca.filler) ca.filler = { present: true, role: "FILLER_DECLARANT" };
            ca.filler.present = true;
            ca.filler.powerOfAttorney = {
                docNumber: kedenDirectorySettings.poaNum || (ca.filler.powerOfAttorney?.docNumber || ""),
                docDate: kedenDirectorySettings.poaDateStr || (ca.filler.powerOfAttorney?.docDate || ""),
                startDate: kedenDirectorySettings.poaDateStr || (ca.filler.powerOfAttorney?.startDate || ""),
                endDate: kedenDirectorySettings.poaDateEnd || (ca.filler.powerOfAttorney?.endDate || "")
            };

            // Если доверенность указана в профиле, прокидываем её и в 44 графу если её там нет
            if (kedenDirectorySettings.poaNum && !documents.some(d => d.type === '09024')) {
                documents.push({
                    filename: 'Справочник: Доверенность',
                    type: '09024',
                    number: kedenDirectorySettings.poaNum,
                    date: kedenDirectorySettings.poaDateStr
                });
            }
        }

        // Свидетельство УЭО (09011)
        if (kedenDirectorySettings.aeoCertNum) {
            if (!documents.some(d => d.type === '09011')) {
                documents.push({
                    filename: 'Справочник: Свид. УЭО',
                    type: '09011',
                    number: kedenDirectorySettings.aeoCertNum,
                    date: kedenDirectorySettings.aeoCertDate || ''
                });
            }
        }
    }

    if (kedenDirectorySettings.customsCode) {
        if (!data.shipping) data.shipping = {};
        data.shipping.customsCode = kedenDirectorySettings.customsCode;
    }

    if (kedenDirectorySettings.transportMode) {
        if (!data.shipping) data.shipping = {};
        data.shipping.transportMode = kedenDirectorySettings.transportMode;
    }
    // ----------------------------------------

    currentAIData = data;
    currentAIData.documents = documents;
    currentAIData.validation = validation;
    currentAIData.rawFiles = aiResponse.rawFiles || [];
    const previewArea = document.getElementById('previewArea');
    const previewContent = document.getElementById('previewContent');
    const container = document.getElementById('mainContainer');

    previewContent.innerHTML = '';
    if (container) container.classList.add('expanded');

    // 0. Render Validation Summary
    renderValidationSummary(validation);

    // 0.1 Render Editable Documents List (44 Graph)
    const docSection = document.createElement('div');
    docSection.className = 'preview-section';
    docSection.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h3 style="margin: 0;">📑 Документы (44 графа)</h3>
            <button id="addDocBtn" style="background: var(--accent); border: none; border-radius: 4px; color: white; padding: 2px 8px; cursor: pointer; font-size: 14px;">+</button>
            <input type="file" id="manualDocInput" hidden accept=".pdf,.png,.jpg,.jpeg">
        </div>
    `;

    const tableContainer = document.createElement('div');
    tableContainer.id = 'docsTableContainer';
    tableContainer.style.fontSize = '11px';
    tableContainer.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 130px 80px 80px 30px; gap: 4px; padding-bottom: 4px; color: #64748b; font-weight: 600;">
            <div>Файл</div>
            <div>Тип / Код</div>
            <div>Номер</div>
            <div>Дата</div>
            <div></div>
        </div>
        <div id="docsRowsList"></div>
    `;
    docSection.appendChild(tableContainer);
    previewContent.appendChild(docSection);

    const rowsList = tableContainer.querySelector('#docsRowsList');

    function addDocRow(doc, idx) {
        const row = document.createElement('div');
        row.className = 'doc-row';
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '1fr 130px 80px 80px 30px';
        row.style.gap = '4px';
        row.style.marginBottom = '4px';
        row.style.padding = '4px';
        row.style.background = 'rgba(255,255,255,0.02)';
        row.style.borderRadius = '4px';
        row.dataset.filename = doc.filename;

        const typeOptions = [
            { val: '04021', label: 'Инвойс (04021)' },
            { val: '02015', label: 'CMR (02015)' },
            { val: '09011', label: 'Реестр (09011)' },
            { val: '11005', label: 'ТТН / Иные (11005)' },
            { val: '04131', label: 'Упаков. лист (04131)' },
            { val: '10022', label: 'Допущение ТС (10022)' },
            { val: '09024', label: 'Доверенность (09024)' },
            { val: '00000', label: 'Другое' }
        ];

        const typeToCode = {
            'INVOICE': '04021',
            'TRANSPORT_DOC': '02015',
            'REGISTRY': '09011',
            'POWER_OF_ATTORNEY': '09024',
            '11004': '09024',
            'OTHER': '11005'
        };
        const currentCode = typeToCode[doc.type] || doc.type || '00000';

        const optionsHtml = typeOptions.map(opt =>
            `<option value="${opt.val}" ${currentCode === opt.val ? 'selected' : ''}>${opt.label}</option>`
        ).join('');

        row.innerHTML = `
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${doc.filename}">${doc.filename}</div>
            <select class="preview-input doc-type-select" style="padding: 2px;">${optionsHtml}</select>
            <input type="text" class="preview-input doc-num-input" value="${doc.number || ''}" placeholder="б/н">
            <input type="text" class="preview-input doc-date-input" value="${doc.date || ''}" placeholder="ДД.ММ.ГГГГ">
            <button class="delete-doc-btn" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:16px; padding:0;">×</button>
        `;

        row.querySelector('.delete-doc-btn').onclick = () => {
            row.remove();
        };

        rowsList.appendChild(row);
    }

    documents.forEach((doc, i) => addDocRow(doc, i));

    // Handle Manual Add
    const addDocBtn = docSection.querySelector('#addDocBtn');
    const manualDocInput = docSection.querySelector('#manualDocInput');

    addDocBtn.onclick = () => manualDocInput.click();

    manualDocInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setStatus(`⌛ Анализ нового файла: ${file.name}...`);
        try {
            const base64 = await fileToBase64(file);
            let filePart;
            if (file.name.toLowerCase().endsWith('.pdf')) {
                try {
                    const text = await readPDF(file);
                    filePart = { text: `--- FILE: ${file.name} (PDF Content) --- \n${text}\n` };
                } catch (err) {
                    filePart = { inlineData: { data: base64, mimeType: 'application/pdf' } };
                }
            } else {
                filePart = { inlineData: { data: base64, mimeType: file.type || 'image/jpeg' } };
            }

            const result = await analyzeSingleFile(filePart, file.name);

            // ИИ теперь возвращает массив documents
            const docObj = (result.documents && result.documents.length > 0)
                ? result.documents[0]
                : (result.document || {});

            const newDoc = {
                filename: file.name,
                type: docObj.type || 'OTHER',
                number: docObj.number || '',
                date: docObj.date || ''
            };

            // Add to current data
            const newIdx = currentAIData.documents.length;
            currentAIData.documents.push(newDoc);

            // Add raw file for upload
            currentAIData.rawFiles.push({
                name: file.name,
                base64: base64,
                mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
                isBinary: true
            });

            addDocRow(newDoc, newIdx);
            setStatus(`✅ Файл ${file.name} добавлен и распознан.`);
        } catch (err) {
            console.error(err);
            setStatus(`❌ Ошибка анализа файла: ${err.message}`);
        }
    };

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

                <div class="row" style="margin-top: 8px; gap: 8px;">
                    <div style="flex: 1;">
                        <label style="font-size: 10px; color: #64748b;">Пост отправления (код)</label>
                        <input type="text" class="preview-input" id="prev-customs-code" value="${data.shipping?.customsCode || ''}" placeholder="Например: 57505">
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 10px; color: #64748b;">Вид транспорта (код)</label>
                        <input type="text" class="preview-input" id="prev-transport-mode" value="${data.shipping?.transportMode || ''}" placeholder="Например: 31">
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
            { id: 'consignor', label: 'Отправитель (Имя)', data: ca.consignor },
            { id: 'consignee', label: 'Получатель (БИН/ИИН)', data: ca.consignee },
            { id: 'carrier', label: 'Перевозчик (БИН/ИИН)', data: ca.carrier },
            { id: 'declarant', label: 'Декларант (БИН/ИИН)', data: ca.declarant }
        ];

        agents.forEach(agent => {
            if (agent.data && (agent.data.present !== false)) {
                const bin = agent.id === 'filler' ? (agent.data.iin || '') : (agent.data.legal?.bin || agent.data.person?.iin || '');
                const name = agent.id === 'filler' ? (agent.data.lastName || '') : (agent.data.legal?.nameRu || agent.data.nonResidentLegal?.nameRu || agent.data.person?.lastName || '');
                const addrObj = agent.data.addresses?.[0] || {};
                let address = addrObj.fullAddress || '';
                if (!address && (addrObj.city || addrObj.street)) {
                    address = [addrObj.region, addrObj.city, addrObj.district, addrObj.street, addrObj.house]
                        .filter(Boolean).join(', ');
                }
                if (!address) address = addrObj.district || '';
                const div = document.createElement('div');
                div.style.marginBottom = '8px';
                div.innerHTML = `
                    <label style="font-size: 10px; color: #64748b; display: block; margin-bottom: 2px;">${agent.label}</label>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" class="preview-input" id="prev-agent-bin-${agent.id}" value="${bin}" placeholder="БИН/ИИН" style="${agent.id === 'consignor' ? 'display:none;' : 'width: 130px; flex-shrink: 0;'}">
                            <input type="text" class="preview-input" id="prev-agent-name-${agent.id}" value="${name}" placeholder="Название" style="flex: 1;">
                            ${agent.id === 'declarant' ? `<input type="text" class="preview-input" id="prev-agent-shortname-declarant" value="${agent.data.legal?.shortNameRu || ''}" placeholder="Краткое наим." style="flex: 1;">` : ''}
                        </div>
                        <input type="text" class="preview-input" id="prev-agent-address-${agent.id}" value="${address}" placeholder="Адрес (город, улица, дом)" style="width: 100%;">
                    </div>
                `;

                // Specific for Declarant: Representative Certificate
                if (agent.id === 'declarant') {
                    const cert = agent.data.representativeCertificate || {};
                    const certHtml = `
                        <div style="margin-top: 4px; padding: 4px; background: rgba(148, 163, 184, 0.05); border-radius: 4px; border: 1px dashed #475569;">
                            <label style="font-size: 9px; color: #64748b; display: block;">Свидетельство представителя</label>
                            <div style="display: flex; gap: 4px;">
                                <input type="text" class="preview-input" id="prev-agent-cert-num" value="${cert.docNumber || ''}" placeholder="№ Свидетельства" style="flex: 2;">
                                <input type="text" class="preview-input" id="prev-agent-cert-date" value="${cert.docDate || ''}" placeholder="Дата" style="flex: 1;">
                            </div>
                        </div>
                    `;
                    div.insertAdjacentHTML('beforeend', certHtml);
                }



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
            <div class="row" style="margin-bottom: 4px;">
                <div style="flex: 1;">
                    <label style="font-size: 10px; color: #64748b;">ИИН Водителя</label>
                    <input type="text" class="preview-input" id="prev-driver-iin" value="${data.driver.iin || ''}" placeholder="ИИН">
                </div>
            </div>
            <div class="row" style="gap: 4px;">
                <div style="flex: 1;">
                    <label style="font-size: 10px; color: #64748b;">Фамилия</label>
                    <input type="text" class="preview-input" id="prev-driver-lastName" value="${data.driver.lastName || ''}" placeholder="Фамилия">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 10px; color: #64748b;">Имя</label>
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
            const hasCyrillic = /[а-яА-ЯёЁ]/.test(p.commercialName || '');
            const nameBg = hasCyrillic ? '' : 'background: rgba(239, 68, 68, 0.2); border-color: #ef4444;';

            tr.innerHTML = `
                <td><input type="text" class="preview-input prev-prod-tnved" value="${p.tnvedCode || ''}" data-index="${i}"></td>
                <td><input type="text" class="preview-input prev-prod-name" value="${p.commercialName || ''}" data-index="${i}" style="${nameBg}"></td>
                <td><input type="number" class="preview-input prev-prod-weight" value="${p.grossWeight || ''}" data-index="${i}" style="text-align: center;"></td>
                <td><input type="number" class="preview-input prev-prod-qty" value="${p.quantity || ''}" data-index="${i}" style="text-align: center;"></td>
                <td><input type="number" class="preview-input prev-prod-cost" value="${p.cost || ''}" data-index="${i}" style="text-align: center;"></td>
                <td><input type="text" class="preview-input prev-prod-curr" value="${p.currencyCode || 'USD'}" data-index="${i}" style="text-align: center;"></td>
            `;
            tbody.appendChild(tr);
        });

        // Totals update logic (simplified helper)
        const updateTotalsFull = () => {
            let totalWeight = 0; let totalQty = 0; let totalCost = 0;
            section.querySelectorAll('.prev-prod-weight').forEach(el => totalWeight += parseFloat(el.value || 0));
            section.querySelectorAll('.prev-prod-qty').forEach(el => totalQty += parseFloat(el.value || 0));
            section.querySelectorAll('.prev-prod-cost').forEach(el => totalCost += parseFloat(el.value || 0));
            const curr = section.querySelector('.prev-prod-curr')?.value || 'USD';

            let totalsEl = section.querySelector('.preview-totals-auto');
            if (!totalsEl) {
                totalsEl = document.createElement('div');
                totalsEl.className = 'preview-totals-auto';
                totalsEl.style.cssText = 'margin-top: 10px; padding: 10px; background: rgba(168, 85, 247, 0.1); border-radius: 8px; font-size: 11px; display: flex; gap: 15px;';
                section.appendChild(totalsEl);
            }
            totalsEl.innerHTML = `
                <div><strong>Позиций:</strong> ${section.querySelectorAll('.prev-prod-weight').length}</div>
                <div><strong>Вес:</strong> ${totalWeight.toFixed(2)}кг</div>
                <div><strong>Мест:</strong> ${totalQty}</div>
                <div><strong>Сумма:</strong> ${totalCost.toFixed(2)} ${curr}</div>
            `;
        };
        updateTotalsFull();
        section.addEventListener('input', updateTotalsFull);
    }

    // 4. Registry Section - REMOVED (Redundant, handled in Documents list)

    // After rendering everything, highlight fields based on validation
    highlightFieldsUI(validation);

    // Automated TNVED Validation
    validateAllVisibleTNVEDInputs();

    // Re-validate TNVED on manual edits
    document.querySelectorAll('.prev-prod-tnved').forEach(input => {
        input.addEventListener('change', async () => {
            setTNVEDValidationStatus(input, 'loading');
            const result = await validateTNVEDCode(input.value.trim());
            setTNVEDValidationStatus(input, result.valid ? 'valid' : 'invalid');
        });
    });

    // Automated BIN/IIN Enrichment (uchet.kz)
    const agentsToCheck = ['consignee', 'carrier', 'declarant'];
    agentsToCheck.forEach(type => {
        const binInput = document.getElementById(`prev-agent-bin-${type}`);
        const binValue = binInput ? binInput.value.trim() : '';
        if (binValue && binValue.length === 12) {
            enrichFieldByBIN(binValue, type);
        }

        // Also listen for manual changes
        if (binInput) {
            binInput.addEventListener('change', () => {
                const newBin = binInput.value.trim();
                if (newBin.length === 12) {
                    enrichFieldByBIN(newBin, type);
                }
            });
        }
    });
}

function renderValidationSummary(validation) {
    const summaryEl = document.getElementById('validationSummary');
    if (!summaryEl) return;
    summaryEl.innerHTML = `<h3 style="margin-top:0;">🛡️ Отчет о кросс-валидации</h3>`;

    if (validation.errors.length === 0 && validation.warnings.length === 0) {
        summaryEl.innerHTML += '<div class="validation-item success">✅ Данные во всех документах совпадают. Противоречий не обнаружено.</div>';
        return;
    }

    validation.errors.forEach(err => {
        const div = document.createElement('div');
        div.className = 'validation-item error';
        div.innerHTML = `<strong>Ошибка:</strong> ${err.message}`;
        summaryEl.appendChild(div);
    });

    validation.warnings.forEach(warn => {
        const div = document.createElement('div');
        div.className = 'validation-item warning';
        div.innerHTML = `<strong>Внимание:</strong> ${warn.message}`;
        summaryEl.appendChild(div);
    });
}

function highlightFieldsUI(validation) {
    const map = {
        'consignor.name': 'prev-agent-name-consignor',
        'consignee.bin': 'prev-agent-bin-consignee',
        'consignee.name': 'prev-agent-name-consignee',
        'vehicle.tractor': 'prev-tractor-num',
        'vehicle.trailer': 'prev-trailer-num',
        'weight.brutto': 'prev-products-body'
    };

    [...validation.errors, ...validation.warnings].forEach(v => {
        const id = map[v.field];
        if (id) {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add(v.severity === 'ERROR' ? 'error-field' : 'warning-field');
                el.title = v.message;
            }
        }
    });
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
    const customsInput = document.getElementById('prev-customs-code');
    const transportInput = document.getElementById('prev-transport-mode');

    if (depInput || destInput || customsInput || transportInput) {
        if (!newData.countries) newData.countries = {};
        newData.countries.departureCountry = depInput?.value || "";
        newData.countries.destinationCountry = destInput?.value || "";

        if (customsInput || transportInput) {
            if (!newData.shipping) newData.shipping = {};
            if (customsInput) newData.shipping.customsCode = customsInput.value;
            if (transportInput) newData.shipping.transportMode = transportInput.value;
        }
    }

    // Scrape Counteragents
    const agentIds = ['consignor', 'consignee', 'carrier', 'declarant'];
    agentIds.forEach(id => {
        const binInput = document.getElementById(`prev-agent-bin-${id}`);
        const nameInput = document.getElementById(`prev-agent-name-${id}`);

        if (newData.counteragents[id]) {
            const binInput = document.getElementById(`prev-agent-bin-${id}`);
            const nameInput = document.getElementById(`prev-agent-name-${id}`);
            const addrInput = document.getElementById(`prev-agent-address-${id}`);

            if (binInput) {
                const bin = binInput.value;
                if (bin) {
                    if (!newData.counteragents[id].legal && !newData.counteragents[id].person && id !== 'consignor') {
                        newData.counteragents[id].legal = { bin: bin };
                        newData.counteragents[id].entityType = "LEGAL";
                    } else if (newData.counteragents[id].legal) {
                        newData.counteragents[id].legal.bin = bin;
                    } else if (newData.counteragents[id].person) {
                        newData.counteragents[id].person.iin = bin;
                    }
                }
            }
            if (nameInput) {
                const name = nameInput.value;
                if (newData.counteragents[id].legal) {
                    newData.counteragents[id].legal.nameRu = name;
                    if (id === 'declarant') {
                        const shortInput = document.getElementById('prev-agent-shortname-declarant');
                        if (shortInput) newData.counteragents[id].legal.shortNameRu = shortInput.value;
                    }
                }
                else if (newData.counteragents[id].nonResidentLegal) newData.counteragents[id].nonResidentLegal.nameRu = name;
                else if (newData.counteragents[id].person) newData.counteragents[id].person.lastName = name;
            }
            if (addrInput) {
                const currentVal = addrInput.value;
                if (!newData.counteragents[id].addresses) newData.counteragents[id].addresses = [];
                if (newData.counteragents[id].addresses.length === 0) {
                    newData.counteragents[id].addresses.push({ addressType: { id: 2014, code: "1", ru: "Адрес регистрации" }, fullAddress: currentVal });
                } else {
                    // Update the string but keep other fields if they were enriched
                    newData.counteragents[id].addresses[0].fullAddress = currentVal;
                }
            }

            // Declarant certificate
            if (id === 'declarant') {
                const numInput = document.getElementById('prev-agent-cert-num');
                const dateInput = document.getElementById('prev-agent-cert-date');
                if (numInput || dateInput) {
                    if (!newData.counteragents[id].representativeCertificate) {
                        newData.counteragents[id].representativeCertificate = {};
                    }
                    newData.counteragents[id].representativeCertificate.docNumber = numInput?.value || "";
                    newData.counteragents[id].representativeCertificate.docDate = dateInput?.value || "";
                }
            }


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
            newData.products[index].grossWeight = parseFloat(prodWeights[i].value || 0);
            newData.products[index].quantity = parseFloat(prodQtys[i].value || 0);
            newData.products[index].cost = parseFloat(prodCosts[i].value || 0);
            newData.products[index].currencyCode = prodCurrs[i].value;
        }
    });

    // Scrape Documents (44 Graph)
    const docRows = document.querySelectorAll('.doc-row');
    const updatedDocuments = [];
    const activeFilenames = new Set();

    docRows.forEach(row => {
        const typeSelect = row.querySelector('.doc-type-select');
        const numInput = row.querySelector('.doc-num-input');
        const dateInput = row.querySelector('.doc-date-input');
        const filename = row.dataset.filename;

        activeFilenames.add(filename);
        updatedDocuments.push({
            filename: filename,
            type: typeSelect.value,
            number: numInput.value,
            date: dateInput.value
        });
    });

    newData.documents = updatedDocuments;

    // Filter rawFiles to only include those still in the documents list
    if (newData.rawFiles) {
        newData.rawFiles = newData.rawFiles.filter(f => activeFilenames.has(f.name));
    }

    // Registry scraping moved to documents list above
    return newData;
}
