// KEDEN Extension - UI Preview (предпросмотр и scrape)
// Зависит от: ui_core.js, ui_files.js, ui_settings.js, ui_preview_validation.js

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

        if (kedenDirectorySettings.expDogNum) {
            if (!documents.some(d => d.type === '11005')) {
                documents.push({
                    filename: 'Справочник: Договор эксп.',
                    type: '11005',
                    number: kedenDirectorySettings.expDogNum,
                    date: kedenDirectorySettings.expDogDate || ''
                });
            }
        }
    }

    if (kedenDirectorySettings.customsCode) {
        if (!data.shipping) data.shipping = {};
        data.shipping.customsCode = kedenDirectorySettings.customsCode;
    }

    if (kedenDirectorySettings.destCustomsCode) {
        if (!data.shipping) data.shipping = {};
        data.shipping.destCustomsCode = kedenDirectorySettings.destCustomsCode;
    }

    if (kedenDirectorySettings.transportMode) {
        if (!data.shipping) data.shipping = {};
        data.shipping.transportMode = kedenDirectorySettings.transportMode;
    }

    if (kedenDirectorySettings.aeoCertNum) {
        if (!data.registry) data.registry = {};
        data.registry.number = kedenDirectorySettings.aeoCertNum;
        data.registry.date = kedenDirectorySettings.aeoCertDate || '';
    }
    // ----------------------------------------

    currentAIData = data;
    currentAIData.documents = documents;
    currentAIData.validation = validation;
    currentAIData.rawFiles = aiResponse.rawFiles || [];
    const previewArea = document.getElementById('previewArea');
    const previewContent = document.getElementById('previewContent');
    const container = document.getElementById('mainContainer');

    updateStepper(3); // Step 3: Verification
    previewContent.innerHTML = '';
    if (container) {
        container.classList.add('expanded');
        // В tab-режиме используем 100%, не фиксируем 800px
        if (window.innerWidth <= 860) {
            document.body.style.width = '800px';
        } else {
            document.body.style.width = '100vw';
        }
    }
    // Явно показываем preview panel
    if (previewArea) previewArea.style.display = 'block';
    const fillBtn = document.getElementById('confirmFillBtn');
    if (fillBtn) fillBtn.style.display = 'block';

    const conf = data.confidence || {};

    // 0. Render Validation Summary
    renderValidationSummary(validation);

    // 0.1 Render Editable Documents List (44 Graph)
    const docSection = document.createElement('div');
    docSection.className = 'preview-section';
    docSection.style.animation = 'fadeIn 0.3s ease-out forwards';
    docSection.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <h3 style="margin: 0;">📑 Документы (44 графа)</h3>
                ${getConfidenceHTML(conf.documents)}
            </div>
            <button id="addDocBtn" class="icon-btn" style="background: var(--accent); color: white; border-radius: 8px; width: 32px; height: 32px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
            <input type="file" id="manualDocInput" hidden accept=".pdf,.png,.jpg,.jpeg" multiple>
        </div>
    `;

    const tableContainer = document.createElement('div');
    tableContainer.id = 'docsTableContainer';
    tableContainer.innerHTML = `
        <div style="display: grid; grid-template-columns: 1.2fr 1.5fr 1fr 1fr 40px; gap: 12px; padding: 0 10px 10px 10px; color: #64748b; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">
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
        row.className = 'doc-row doc-item';
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '1.2fr 1.5fr 1fr 1fr 40px';
        row.style.gap = '12px';
        row.style.alignItems = 'center';
        row.style.marginBottom = '8px';
        row.style.padding = '10px';
        row.dataset.filename = (doc.filename || "").trim();
        const trimmedFilename = (doc.filename || "").trim();
        if (doc.groupId) row.dataset.groupId = doc.groupId;

        const typeOptions = [
            { val: '04021', label: 'Инвойс (04021)' },
            { val: '02015', label: 'CMR (02015)' },
            { val: '09011', label: 'Реестр (09011)' },
            { val: '04131', label: 'Упаков. лист (04131)' },
            { val: '09024', label: 'Свид. допущения (09024)' },
            { val: '10022', label: 'Паспорт/Довер/Тех (10022)' },
            { val: '11005', label: 'Договор эксп. (11005)' },
            { val: '04033', label: 'Договор перев. (04033)' },
            { val: '00000', label: 'Другое' }
        ];

        const typeToCode = {
            'INVOICE': '04021',
            'TRANSPORT_DOC': '02015',
            'REGISTRY': '09011',
            'VEHICLE_PERMIT': '09024',
            'DRIVER_ID': '10022',
            'POWER_OF_ATTORNEY': '10022',
            'VEHICLE_DOC': '10022',
            'PACKING_LIST': '04131',
            'CONTRACT': '11005',
            'CONTRACT_TRANSPORT': '04033',
            'OTHER': '00000'
        };
        const currentCode = typeToCode[doc.type] || doc.type || '00000';

        const optionsHtml = typeOptions.map(opt =>
            `<option value="${opt.val}" ${currentCode === opt.val ? 'selected' : ''}>${opt.label}</option>`
        ).join('');

        const filenameDiv = document.createElement('div');
        filenameDiv.style.cssText = 'font-size: 12px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        filenameDiv.title = doc.filename || '';
        filenameDiv.textContent = doc.filename || '';

        const typeSelect = document.createElement('select');
        typeSelect.className = 'preview-input doc-type-select';
        typeSelect.style.padding = '6px 10px';
        typeSelect.innerHTML = optionsHtml; // optionsHtml is safe: only static labels + hardcoded values

        const numInput = document.createElement('input');
        numInput.type = 'text';
        numInput.className = 'preview-input doc-num-input';
        numInput.value = doc.number || '';
        numInput.placeholder = 'б/н';
        numInput.style.padding = '6px 10px';

        const dateInput = document.createElement('input');
        dateInput.type = 'text';
        dateInput.className = 'preview-input doc-date-input';
        dateInput.value = doc.date || '';
        dateInput.dataset.validate = 'date';
        dateInput.placeholder = 'ДД.ММ.ГГГГ';
        dateInput.style.padding = '6px 10px';

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-doc-btn';
        delBtn.textContent = '×';

        row.appendChild(filenameDiv);
        row.appendChild(typeSelect);
        row.appendChild(numInput);
        row.appendChild(dateInput);
        row.appendChild(delBtn);

        delBtn.onclick = () => {
            row.style.opacity = '0';
            row.style.transform = 'translateX(20px)';
            setTimeout(() => row.remove(), 200);
        };
        rowsList.appendChild(row);
    }

    documents.forEach((doc, i) => addDocRow(doc, i));

    // Handle Manual Add
    const addDocBtn = docSection.querySelector('#addDocBtn');
    const manualDocInput = docSection.querySelector('#manualDocInput');

    addDocBtn.onclick = () => manualDocInput.click();

    manualDocInput.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const groupId = files.length > 1 ? Date.now() : null;

        for (const file of files) {
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

                const docPayload = {
                    fileName: file.name,
                    parts: [filePart]
                };

                const response = await chrome.runtime.sendMessage({
                    action: 'ANALYZE_SINGLE',
                    payload: {
                        document: docPayload,
                        iin: currentUserInfo ? currentUserInfo.iin : '000000000000'
                    }
                });

                if (!response || !response.success) {
                    throw new Error(response?.error || 'Unknown extractions error');
                }

                const result = response.result;

                // ИИ теперь возвращает массив documents
                const docObj = (result.documents && result.documents.length > 0)
                    ? result.documents[0]
                    : (result.document || {});

                const newDoc = {
                    filename: file.name,
                    type: docObj.type || 'OTHER',
                    number: docObj.number || '',
                    date: docObj.date || '',
                    groupId: groupId
                };

                // Add to current data
                const newIdx = currentAIData.documents.length;
                currentAIData.documents.push(newDoc);

                // Add raw file for upload
                currentAIData.rawFiles.push({
                    name: file.name,
                    base64: base64,
                    mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
                    isBinary: true,
                    groupId: groupId
                });

                addDocRow(newDoc, newIdx);
                setStatus(`✅ Файл ${file.name} добавлена.`);
            } catch (err) {
                console.error(err);
                setStatus(`❌ Ошибка анализа файла ${file.name}: ${err.message}`);
            }
        }
        setStatus(`✅ Добавлено ${files.length} файл(ов).`);
        e.target.value = ''; // Reset input
    };

    // 1. Vehicles Section
    if (data.vehicles) {
        const v = data.vehicles;
        const section = document.createElement('div');
        section.className = 'preview-section';
        const vWarning = (conf.vehicles < 0.6) ? 'input-warning' : '';
        section.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                    <h3>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="1" y="3" width="15" height="13"></rect>
                            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                            <circle cx="5.5" cy="18.5" r="2.5"></circle>
                            <circle cx="18.5" cy="18.5" r="2.5"></circle>
                        </svg>
                        Транспорт и Маршрут
                    </h3>
                    ${getConfidenceHTML(conf.vehicles)}
                </div>
                
                <div class="preview-grid" style="grid-template-columns: 1fr 1fr; margin-bottom: 24px;">
                    <div class="preview-field-group">
                        <label class="preview-label">Тягач (Номер)</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-tractor-num" value="${v.tractorRegNumber || ''}">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Страна ТС</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-tractor-country" value="${v.tractorCountry || ''}">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Прицеп (Номер)</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-trailer-num" value="${v.trailerRegNumber || ''}">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Страна ТС</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-trailer-country" value="${v.trailerCountry || ''}">
                    </div>
                </div>
                
                <div class="preview-grid" style="grid-template-columns: 1fr 1fr; border-top: 1px solid var(--glass-border); padding-top: 20px; margin-bottom: 16px;">
                    <div class="preview-field-group">
                        <label class="preview-label">Страна отправления</label>
                        <input type="text" class="preview-input" id="prev-departure-country" value="${data.countries?.departureCountry || ''}" placeholder="ISO (например, CN)">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Страна назначения</label>
                        <input type="text" class="preview-input" id="prev-destination-country" value="${data.countries?.destinationCountry || ''}" placeholder="ISO (например, AF)">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Пост отправления (код)</label>
                        <input type="text" class="preview-input" id="prev-customs-code" value="${data.shipping?.customsCode || ''}" placeholder="Например: 57505">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Пост назначения (код)</label>
                        <input type="text" class="preview-input" id="prev-dest-customs-code" value="${data.shipping?.destCustomsCode || ''}" placeholder="Например: 55510">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Вид транспорта (код)</label>
                        <input type="text" class="preview-input" id="prev-transport-mode" value="${data.shipping?.transportMode || ''}" placeholder="Например: 31">
                    </div>
                </div>

                <div class="preview-grid" style="grid-template-columns: 1fr 120px; border-top: 1px solid var(--glass-border); padding-top: 20px;">
                    <div class="preview-field-group">
                        <label class="preview-label">Осн. транспортный док. (09011 / Реестр)</label>
                        <input type="text" class="preview-input" id="prev-registry-num" value="${data.registry?.number || ''}" placeholder="Номер">
                    </div>
                    <div class="preview-field-group">
                        <label class="preview-label">Дата</label>
                        <input type="text" class="preview-input" id="prev-registry-date" value="${data.registry?.date || ''}" placeholder="ДД.ММ.ГГГГ">
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
        section.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                <h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    Контрагенты
                </h3>
                <div style="display: flex; gap: 8px;">
                    ${getConfidenceHTML(ca.consignor?.confidence || conf.consignor)}
                    ${getConfidenceHTML(ca.consignee?.confidence || conf.consignee)}
                </div>
            </div>
        `;

        const agents = [
            { id: 'consignor', label: 'Отправитель (Имя)', data: ca.consignor },
            { id: 'consignee', label: 'Получатель (БИН/ИИН)', data: ca.consignee },
            { id: 'carrier', label: 'Перевозчик (БИН/ИИН)', data: ca.carrier },
            { id: 'declarant', label: 'Декларант (БИН/ИИН)', data: ca.declarant }
        ];

        agents.forEach(agent => {
            if (agent.data && (agent.data.present !== false)) {
                const agentCountry = (agent.data.addresses?.[0]?.countryCode || '').toUpperCase();
                const isNonResident = ['NON_RESIDENT_LEGAL', 'NON_RESIDENT_PERSON', 'NON_RESIDENT'].includes(agent.data.entityType)
                    || (agentCountry && agentCountry !== 'KZ');
                const rawBin = agent.id === 'filler' ? (agent.data.iin || '') : (isNonResident ? '' : (agent.data.legal?.bin || agent.data.person?.iin || ''));
                const bin = String(rawBin).replace(/\D/g, '').length === 12 ? rawBin : '';
                const name = agent.id === 'filler' ? (agent.data.lastName || '') : (agent.data.legal?.nameRu || agent.data.nonResidentLegal?.nameRu || agent.data.person?.lastName || '');
                const addrObj = agent.data.addresses?.[0] || {};
                let address = addrObj.fullAddress || '';
                if (!address && (addrObj.city || addrObj.street)) {
                    address = [addrObj.region, addrObj.city, addrObj.district, addrObj.street, addrObj.house]
                        .filter(Boolean).join(', ');
                }
                if (!address) address = addrObj.district || '';
                const div = document.createElement('div');
                div.className = 'preview-field-group';
                div.style.marginBottom = '20px';
                const warningClass = (conf[agent.id] < 0.6) ? 'input-warning' : '';
                div.innerHTML = `
                    <label class="preview-label">${agent.label}</label>
                    <div class="preview-grid" style="grid-template-columns: 140px 1fr; gap: 10px;">
                        <input type="text" class="preview-input ${warningClass}" id="prev-agent-bin-${agent.id}" 
                            value="${bin}" data-validate="bin"
                            placeholder="БИН/ИИН">
                        <input type="text" class="preview-input ${warningClass}" id="prev-agent-name-${agent.id}" 
                            value="${name}" 
                            placeholder="Наименование">
                    </div>
                    <input type="text" class="preview-input ${warningClass}" id="prev-agent-address-${agent.id}" 
                        value="${address}" 
                        placeholder="Адрес" style="margin-top: 8px; font-size: 12px; opacity: 0.8;">
                `;

                // Specific for Declarant: Representative Certificate
                if (agent.id === 'declarant') {
                    const cert = agent.data.representativeCertificate || {};
                    const certHtml = `
                        <div style="margin-top: 10px; padding: 12px; background: rgba(255, 255, 255, 0.03); border-radius: 12px; border: 1px dashed var(--glass-border);">
                            <label class="preview-label" style="margin-bottom: 8px; color: var(--text-muted);">Свидетельство представителя</label>
                            <div class="preview-grid" style="grid-template-columns: 1fr 120px; gap: 8px;">
                                <input type="text" class="preview-input" id="prev-agent-cert-num" value="${cert.docNumber || ''}" placeholder="№ Свидетельства">
                                <input type="text" class="preview-input" id="prev-agent-cert-date" value="${cert.docDate || ''}" data-validate="date" placeholder="Дата">
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
        const dWarning = ((conf.driver || 1.0) < 0.6) ? 'input-warning' : '';
        section.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                <h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="8" r="4"></circle>
                        <path d="M12 12v8m-4-4h8"></path>
                    </svg>
                    Водитель
                </h3>
                ${getConfidenceHTML(conf.driver || 1.0)}
            </div>
            <div class="preview-grid" style="grid-template-columns: 1fr; margin-bottom: 12px;">
                <div class="preview-field-group">
                    <label class="preview-label">ИИН Водителя</label>
                    <input type="text" class="preview-input ${dWarning}" id="prev-driver-iin" value="${data.driver.iin || ''}" data-validate="bin" placeholder="ИИН">
                </div>
            </div>
            <div class="preview-grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="preview-field-group">
                    <label class="preview-label">Фамилия</label>
                    <input type="text" class="preview-input ${dWarning}" id="prev-driver-lastName" value="${data.driver.lastName || ''}" placeholder="Фамилия">
                </div>
                <div class="preview-field-group">
                    <label class="preview-label">Имя</label>
                    <input type="text" class="preview-input ${dWarning}" id="prev-driver-firstName" value="${data.driver.firstName || ''}" placeholder="Имя">
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
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                <h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
                        <path d="M3 6h18"></path>
                        <path d="M16 10a4 4 0 0 1-8 0"></path>
                    </svg>
                    Товары
                </h3>
                ${getConfidenceHTML(conf.products)}
            </div>
            <div class="table-container" style="overflow-x: auto; margin: 0 -24px; padding: 0 24px;">
                <table class="preview-table" style="width: 100%; min-width: 600px;">
                    <thead>
                        <tr>
                            <th style="width: 120px;">ТНВЭД</th>
                            <th>Наименование</th>
                            <th style="width: 80px;">Вес</th>
                            <th style="width: 60px;">Мест</th>
                            <th style="width: 100px;">Сумма</th>
                            <th style="width: 60px;">Вал.</th>
                        </tr>
                    </thead>
                    <tbody id="prev-products-body"></tbody>
                </table>
            </div>
        `;
        previewContent.appendChild(section);
        const tbody = section.querySelector('#prev-products-body');
        data.products.forEach((p, i) => {
            const tr = document.createElement('tr');
            tr.className = 'doc-item';
            const hasCyrillic = /[а-яА-ЯёЁ]/.test(p.commercialName || '');
            const nameStyle = hasCyrillic ? '' : 'border-color: #ef4444; background: rgba(239, 68, 68, 0.05);';

            tr.innerHTML = `
                <td style="padding: 6px 4px;"><input type="text" class="preview-input prev-prod-tnved" value="${p.tnvedCode || ''}" data-index="${i}" data-validate="tnved" style="padding: 6px 8px;"></td>
                <td style="padding: 6px 4px;"><input type="text" class="preview-input prev-prod-name" value="${p.commercialName || ''}" data-index="${i}" style="${nameStyle} padding: 6px 8px;"></td>
                <td style="padding: 6px 4px;"><input type="number" class="preview-input prev-prod-weight" value="${p.grossWeight || ''}" data-index="${i}" data-validate="positive" style="text-align: center; padding: 6px 8px;"></td>
                <td style="padding: 6px 4px;"><input type="number" class="preview-input prev-prod-qty" value="${p.quantity || ''}" data-index="${i}" data-validate="positive" style="text-align: center; padding: 6px 8px;"></td>
                <td style="padding: 6px 4px;"><input type="number" class="preview-input prev-prod-cost" value="${p.cost || ''}" data-index="${i}" data-validate="positive" style="text-align: center; padding: 6px 8px;"></td>
                <td style="padding: 6px 4px;"><input type="text" class="preview-input prev-prod-curr" value="${p.currencyCode || 'USD'}" data-index="${i}" style="text-align: center; padding: 6px 8px;"></td>
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
                totalsEl.style.cssText = 'margin-top: 16px; padding: 14px; background: rgba(59, 130, 246, 0.08); border: 1px solid var(--glass-border); border-radius: 12px; font-size: 12px; display: flex; gap: 20px; backdrop-filter: blur(10px);';
                section.appendChild(totalsEl);
            }
            totalsEl.innerHTML = `
                <div style="color: var(--text-muted);">Позиций: <span style="color: #fff; font-weight: 600;">${section.querySelectorAll('.prev-prod-weight').length}</span></div>
                <div style="color: var(--text-muted);">Вес: <span style="color: #fff; font-weight: 600;">${totalWeight.toFixed(2)}кг</span></div>
                <div style="color: var(--text-muted);">Мест: <span style="color: #fff; font-weight: 600;">${totalQty}</span></div>
                <div style="color: var(--text-muted);">Сумма: <span style="color: var(--accent-primary); font-weight: 700;">${totalCost.toFixed(2)} ${curr}</span></div>
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

    initInlineValidation();
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
    const destCustomsInput = document.getElementById('prev-dest-customs-code');
    const transportInput = document.getElementById('prev-transport-mode');

    if (depInput || destInput || customsInput || destCustomsInput || transportInput) {
        if (!newData.countries) newData.countries = {};
        newData.countries.departureCountry = depInput?.value || "";
        newData.countries.destinationCountry = destInput?.value || "";

        if (customsInput || destCustomsInput || transportInput) {
            if (!newData.shipping) newData.shipping = {};
            if (customsInput) newData.shipping.customsCode = customsInput.value;
            if (destCustomsInput) newData.shipping.destCustomsCode = destCustomsInput.value;
            if (transportInput) newData.shipping.transportMode = transportInput.value;
        }
    }

    const regNumInput = document.getElementById('prev-registry-num');
    const regDateInput = document.getElementById('prev-registry-date');
    if (regNumInput) {
        if (!newData.registry) newData.registry = {};
        newData.registry.number = regNumInput.value;
        newData.registry.date = regDateInput?.value || "";
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
                const agentEntityType = newData.counteragents[id]?.entityType || '';
                const agentAddrCountry = (newData.counteragents[id]?.addresses?.[0]?.countryCode || '').toUpperCase();
                const agentIsNonResident = ['NON_RESIDENT_LEGAL', 'NON_RESIDENT_PERSON', 'NON_RESIDENT'].includes(agentEntityType)
                    || (agentAddrCountry && agentAddrCountry !== 'KZ');
                if (bin && !agentIsNonResident) {
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

        const trimmedFilename = (filename || "").trim();
        activeFilenames.add(trimmedFilename);
        updatedDocuments.push({
            filename: trimmedFilename,
            type: typeSelect.value,
            number: numInput.value,
            date: dateInput.value,
            groupId: row.dataset.groupId || null
        });
    });

    newData.documents = updatedDocuments;

    // Filter rawFiles to only include those still in the documents list
    if (newData.rawFiles) {
        newData.rawFiles = newData.rawFiles.filter(f => activeFilenames.has((f.name || "").trim()));
    }

    // Registry scraping moved to documents list above
    return newData;
}
