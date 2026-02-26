function logButtonClick(buttonId) {
    console.log('[popup] Button click:', {
        buttonId,
        timestamp: new Date().toISOString()
    });
}

function setStatus(msg) {
    const el = document.getElementById('statusMessage');
    if (el) {
        el.style.display = 'block';
        el.innerText = msg;
        el.style.animation = 'fadeIn 0.3s ease-out';
    }

    // Also update central loader status if exists
    const loaderStatus = document.getElementById('loaderStatus');
    if (loaderStatus) {
        loaderStatus.innerText = msg;
    }
}

function getConfidenceHTML(score) {
    if (score === undefined) return '';
    let cls = 'conf-high';
    let text = 'Высокая';
    let icon = '✅';

    if (score < 0.6) {
        cls = 'conf-low';
        text = 'Низкая (Проверьте!)';
        icon = '⚠️';
    } else if (score < 0.85) {
        cls = 'conf-medium';
        text = 'Средняя';
        icon = '❓';
    }

    return `<span class="conf-badge ${cls}">${icon} ${text} ${Math.round(score * 100)}%</span>`;
}

function updateStepper(stepNumber) {
    const steps = document.querySelectorAll('.step');
    steps.forEach(step => {
        const s = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');

        if (s < stepNumber) {
            step.classList.add('completed');
        } else if (s === stepNumber) {
            step.classList.add('active');
        }
    });
}

function initInlineValidation() {
    const inputs = document.querySelectorAll('.preview-input');
    inputs.forEach(input => {
        const type = input.dataset.validate;
        if (!type) return;

        const validate = () => {
            let isValid = true;
            let msg = '';
            const val = input.value.trim();

            if (type === 'bin') {
                isValid = /^\d{12}$/.test(val);
                msg = 'Должно быть 12 цифр';
            } else if (type === 'tnved') {
                isValid = /^\d{6}$/.test(val);
                msg = 'Должно быть 6 цифр';
            } else if (type === 'positive') {
                isValid = parseFloat(val) > 0;
                msg = 'Должно быть > 0';
            } else if (type === 'date') {
                const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(val);
                const localDate = /^\d{2}\.\d{2}\.\d{4}$/.test(val);
                isValid = (isoDate || localDate);
                if (isValid) {
                    const parts = localDate ? val.split('.').reverse() : val.split('-');
                    isValid = !isNaN(Date.parse(parts.join('-')));
                }
                msg = 'Формат ГГГГ-ММ-ДД или ДД.ММ.ГГГГ';
            } else if (type === 'required') {
                isValid = val.length > 0;
                msg = 'Обязательное поле';
            }

            if (!isValid && val.length > 0) {
                input.classList.add('input-error');
                let hint = input.nextElementSibling;
                if (!hint || !hint.classList.contains('validation-hint')) {
                    hint = document.createElement('div');
                    hint.className = 'validation-hint';
                    input.parentNode.insertBefore(hint, input.nextSibling);
                }
                hint.innerText = msg;
            } else {
                input.classList.remove('input-error');
            }
        };

        input.addEventListener('input', validate);
        validate(); // Initial check
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `
        <span style="font-size: 18px;">${icon}</span>
        <div style="flex: 1;">${message}</div>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Progress bar animation
    const progress = toast.querySelector('.toast-progress');
    const duration = 4000;
    progress.style.transition = `transform ${duration}ms linear`;
    progress.style.transform = 'scaleX(0)';

    const timeout = setTimeout(() => {
        toast.style.animation = 'toastOut 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 500);
    }, duration);

    toast.onclick = () => {
        clearTimeout(timeout);
        toast.style.animation = 'toastOut 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 500);
    };
}

function updatePreviewPlaceholder() {
    const previewArea = document.getElementById('previewArea');
    const previewContent = document.getElementById('previewContent');
    const container = document.getElementById('mainContainer');

    if (previewContent && !currentAIData) {
        previewContent.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: var(--text-secondary); text-align: center;">
                <div style="font-size: 48px; opacity: 0.2; margin-bottom: 24px;">🔍</div>
                <div style="font-size: 15px; font-weight: 500; color: #fff;">Ожидание документов</div>
                <div style="font-size: 12px; margin-top: 8px; max-width: 200px;">После анализа здесь появятся извлеченные данные и предпросмотр</div>
            </div>
        `;
    }
}

let _timerInterval = null;
let _timerStartTime = null;

function showLoading(show, message, forcedStartTime = null) {
    const loader = document.getElementById('loader');
    const startBtn = document.getElementById('startBtn');
    const confirmBtn = document.getElementById('confirmFillBtn');

    if (loader) loader.style.display = show ? 'block' : 'none';
    if (startBtn) startBtn.disabled = show;
    if (confirmBtn) confirmBtn.disabled = show;

    const previewContent = document.getElementById('previewContent');
    const existingTimer = document.getElementById('aiTimer');

    if (show) {
        // Only wipe previewContent if it's for initial analysis (not filling)
        // or if it doesn't have the timer yet.
        const isFilling = message && message.includes('Заполнение');

        if (previewContent && !existingTimer && !isFilling) {
            // Expand container and show preview panel to ensure timer is visible
            const container = document.getElementById('mainContainer');
            const previewArea = document.getElementById('previewArea');
            if (container) {
                container.classList.add('expanded');
                // Adjust width for popup vs tab
                if (window.innerWidth <= 860) {
                    document.body.style.width = '800px';
                } else {
                    document.body.style.width = '100vw';
                }
            }
            if (previewArea) previewArea.style.display = 'block';

            updateStepper(2); // Step 2: Analysis
            previewContent.innerHTML = `
                <div id="centralStatusOverlay" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 320px; text-align: center; animation: fadeIn 0.4s ease-out;">
                    <div class="loader central-spinner" style="display: block; margin-bottom: 28px; width: 48px; height: 48px; border-width: 4px; border-top-color: #007AFF;"></div>
                    <div id="loaderStatus" style="font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 24px; letter-spacing: -0.5px;">${message || 'AI анализирует документы...'}</div>
                    <div id="aiTimerContainer" style="position: relative; padding: 2px; border-radius: 14px; background: linear-gradient(135deg, rgba(0,122,255,0.4), rgba(88,86,214,0.4)); shadow: 0 10px 25px -5px rgba(0,0,0,0.5);">
                        <div id="aiTimer" style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: #fff; font-weight: 700; background: #0f172a; padding: 10px 24px; border-radius: 12px; min-width: 120px; box-shadow: inset 0 0 20px rgba(0,0,0,0.3); animation: pulse 2s infinite; display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 14px; opacity: 0.6; font-weight: 500;">⏱</span>
                            <span id="aiTimerValue">00:00.0</span>
                        </div>
                    </div>
                </div>
            `;
        } else if (existingTimer || isFilling) {
            if (isFilling) updateStepper(4); // Step 4: Done/Filling
            // Update the status on existing loader or show a non-destructive status
            const statusEl = document.getElementById('loaderStatus');
            if (statusEl) {
                statusEl.innerText = message || 'AI анализирует документы...';
            } else if (isFilling) {
                // If we are filling but no central overlay exists (already succeeded analysis), 
                // we might want to just show a notification or a small spinner.
                // For now, let's keep it simple and just set the status message area.
                setStatus(message);
            }
        }
        startTimer(forcedStartTime);
    } else {
        const finalTime = stopTimer();
        const spinner = document.querySelector('.central-spinner');
        if (spinner) spinner.style.display = 'none';

        const timer = document.getElementById('aiTimer');
        if (timer) {
            timer.style.animation = 'none';
            timer.style.color = '#4ade80';
            const container = document.getElementById('aiTimerContainer');
            if (container) container.style.background = 'linear-gradient(135deg, rgba(74,222,128,0.4), rgba(34,197,94,0.4))';
        }
        return finalTime;
    }
}

function startTimer(forcedStartTime = null) {
    if (_timerInterval) {
        // If already running but we have a forced start time, update it
        if (forcedStartTime) _timerStartTime = forcedStartTime;
        return;
    }
    _timerStartTime = forcedStartTime || Date.now();
    _timerInterval = setInterval(updateTimerUI, 100);
}

function stopTimer() {
    let finalTime = '00:00';
    if (_timerInterval) {
        const el = document.getElementById('aiTimerValue');
        if (el) finalTime = el.innerText;
        clearInterval(_timerInterval);
        _timerInterval = null;
    }
    return finalTime;
}

function updateTimerUI() {
    const el = document.getElementById('aiTimerValue');
    if (!el) return;

    const diff = (Date.now() - _timerStartTime) / 1000;
    const minutes = Math.floor(diff / 60);
    const seconds = Math.floor(diff % 60);
    const ms = Math.floor((diff % 1) * 10);

    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms}`;
    el.innerText = timeStr;
}

window.appExtensionFiles = [];

function handleFiles(newFiles) {
    window.appExtensionFiles = window.appExtensionFiles.concat(newFiles);
    renderFileList();
}

function showError(msg) {
    const previewContent = document.getElementById('previewContent');
    const container = document.getElementById('mainContainer');
    const previewArea = document.getElementById('previewArea');

    if (previewContent && container) {
        // Ensure container is expanded and preview area is visible to show error
        container.classList.add('expanded');
        if (window.innerWidth <= 860) {
            document.body.style.width = '800px';
        } else {
            document.body.style.width = '100vw';
        }
        if (previewArea) previewArea.style.display = 'block';

        previewContent.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #ef4444; text-align: center; padding: 20px;">
                <div style="font-size: 40px; margin-bottom: 16px;">⚠️</div>
                <div style="font-size: 14px; font-weight: 500; margin-bottom: 8px;">Ошибка анализа</div>
                <div style="font-size: 12px; color: #94a3b8;">${msg || 'Неизвестная ошибка'}</div>
                <button class="btn" id="retryAnalysisBtn" style="margin-top: 20px; width: auto; padding: 8px 16px;">ПОПРОБОВАТЬ СНОВА</button>
            </div>
        `;
        // Attach listener after rendering
        setTimeout(() => {
            const retryBtn = document.getElementById('retryAnalysisBtn');
            if (retryBtn) {
                retryBtn.onclick = () => {
                    const startBtn = document.getElementById('startBtn');
                    if (startBtn) startBtn.click();
                };
            }
        }, 0);
    }
    const fillBtn = document.getElementById('confirmFillBtn');
    if (fillBtn) fillBtn.style.display = 'none';
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    fileList.innerHTML = '';

    if (window.appExtensionFiles.length > 0) {
        window.appExtensionFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'file-item';
            item.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid var(--glass-border);
                border-radius: 12px;
                margin-bottom: 8px;
                animation: fadeIn 0.3s ease-out;
            `;

            const icon = document.createElement('span');
            icon.innerHTML = '📄';
            icon.style.fontSize = '18px';

            const nameWrap = document.createElement('div');
            nameWrap.style.flex = '1';
            nameWrap.style.overflow = 'hidden';

            const nameSpan = document.createElement('div');
            nameSpan.innerText = file.name;
            nameSpan.style.cssText = 'font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            nameSpan.title = file.name;

            const sizeSpan = document.createElement('div');
            sizeSpan.innerText = (file.size / 1024).toFixed(1) + ' KB';
            sizeSpan.style.cssText = 'font-size: 10px; color: var(--text-secondary);';

            nameWrap.appendChild(nameSpan);
            nameWrap.appendChild(sizeSpan);

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.style.cssText = 'background: rgba(255,255,255,0.05); border: none; color: #fff; cursor: pointer; font-size: 18px; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s;';
            removeBtn.onmouseover = () => removeBtn.style.background = 'rgba(255, 59, 48, 0.2)';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                window.appExtensionFiles.splice(index, 1);
                renderFileList();
            };

            item.appendChild(icon);
            item.appendChild(nameWrap);
            item.appendChild(removeBtn);
            fileList.appendChild(item);
        });
        document.getElementById('statusMessage').style.display = 'block';
        document.getElementById('statusMessage').innerText = `Готово к анализу: ${window.appExtensionFiles.length} файла(ов)`;
    } else {
        document.getElementById('statusMessage').style.display = 'none';
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

function initSmartDragAndDrop() {
    const overlay = document.getElementById('smart-drop-overlay');
    if (!overlay) return;

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        overlay.classList.add('visible');
    });

    overlay.addEventListener('dragleave', (e) => {
        // Only hide if we actually leave the overlay area (not just child elements)
        if (e.relatedTarget === null || !overlay.contains(e.relatedTarget)) {
            overlay.classList.remove('visible');
        }
    });

    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('visible');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(Array.from(files));
        }
    });
}

// Initialize Smart Drag & Drop immediately
initSmartDragAndDrop();

let kedenDirectorySettings = {};

// Загрузка настроек справочника
chrome.storage.local.get(['kedenDirectorySettings'], (result) => {
    if (result.kedenDirectorySettings) {
        kedenDirectorySettings = result.kedenDirectorySettings;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; }
        setVal('prefCarrierBin', kedenDirectorySettings.carrierBin);
        setVal('prefDeclarantBin', kedenDirectorySettings.declarantBin);

        setVal('prefCustomsCode', kedenDirectorySettings.customsCode);
        setVal('prefDestCustomsCode', kedenDirectorySettings.destCustomsCode);
        setVal('prefTransportMode', kedenDirectorySettings.transportMode);
        setVal('prefRepCertNum', kedenDirectorySettings.repCertNum);
        setVal('prefRepCertDate', kedenDirectorySettings.repCertDate);
        setVal('prefAeoCertNum', kedenDirectorySettings.aeoCertNum);
        setVal('prefAeoCertDate', kedenDirectorySettings.aeoCertDate);
        setVal('prefExpDogNum', kedenDirectorySettings.expDogNum);
        setVal('prefExpDogDate', kedenDirectorySettings.expDogDate);
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
        destCustomsCode: document.getElementById('prefDestCustomsCode').value.trim(),
        transportMode: document.getElementById('prefTransportMode').value.trim(),
        repCertNum: document.getElementById('prefRepCertNum').value.trim(),
        repCertDate: document.getElementById('prefRepCertDate').value.trim(),
        aeoCertNum: document.getElementById('prefAeoCertNum').value.trim(),
        aeoCertDate: document.getElementById('prefAeoCertDate').value.trim(),
        expDogNum: document.getElementById('prefExpDogNum').value.trim(),
        expDogDate: document.getElementById('prefExpDogDate').value.trim()
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

        row.innerHTML = `
            <div style="font-size: 12px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${doc.filename}">
                ${doc.filename}
            </div>
            <select class="preview-input doc-type-select" style="padding: 6px 10px;">${optionsHtml}</select>
            <input type="text" class="preview-input doc-num-input" value="${doc.number || ''}" placeholder="б/н" style="padding: 6px 10px;">
            <input type="text" class="preview-input doc-date-input" value="${doc.date || ''}" data-validate="date" placeholder="ДД.ММ.ГГГГ" style="padding: 6px 10px;">
            <button class="delete-doc-btn">×</button>
        `;

        row.querySelector('.delete-doc-btn').onclick = () => {
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
        section.style.animation = 'fadeIn 0.3s ease-out 0.1s forwards';
        section.style.opacity = '0';
        const vWarning = (conf.vehicles < 0.6) ? 'input-warning' : '';
        section.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <h3 style="margin: 0;">Транспорт и Маршрут</h3>
                    ${getConfidenceHTML(conf.vehicles)}
                </div>
                <div class="preview-row" style="grid-template-columns: 1fr 120px;">
                    <div>
                        <label class="preview-label">Тягач (Номер)</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-tractor-num" value="${v.tractorRegNumber || ''}">
                    </div>
                    <div>
                        <label class="preview-label">Страна ТС</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-tractor-country" value="${v.tractorCountry || ''}">
                    </div>
                </div>
                <div class="preview-row" style="grid-template-columns: 1fr 120px; margin-bottom: 24px;">
                    <div>
                        <label class="preview-label">Прицеп (Номер)</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-trailer-num" value="${v.trailerRegNumber || ''}">
                    </div>
                    <div>
                        <label class="preview-label">Страна ТС</label>
                        <input type="text" class="preview-input ${vWarning}" id="prev-trailer-country" value="${v.trailerCountry || ''}">
                    </div>
                </div>
                
                <div class="preview-row" style="grid-template-columns: 1fr 1fr; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px;">
                    <div>
                        <label class="preview-label">Страна отправления</label>
                        <input type="text" class="preview-input" id="prev-departure-country" value="${data.countries?.departureCountry || ''}" placeholder="ISO (например, CN)">
                    </div>
                    <div>
                        <label class="preview-label">Страна назначения</label>
                        <input type="text" class="preview-input" id="prev-destination-country" value="${data.countries?.destinationCountry || ''}" placeholder="ISO (например, AF)">
                    </div>
                </div>

                <div class="preview-row" style="grid-template-columns: 1fr 1fr;">
                    <div>
                        <label class="preview-label">Пост отправления (код)</label>
                        <input type="text" class="preview-input" id="prev-customs-code" value="${data.shipping?.customsCode || ''}" placeholder="Например: 57505">
                    </div>
                    <div>
                        <label class="preview-label">Пост назначения (код)</label>
                        <input type="text" class="preview-input" id="prev-dest-customs-code" value="${data.shipping?.destCustomsCode || ''}" placeholder="Например: 55510">
                    </div>
                </div>

                <div class="preview-row" style="grid-template-columns: 1fr 1fr;">
                     <div>
                        <label class="preview-label">Вид транспорта (код)</label>
                        <input type="text" class="preview-input" id="prev-transport-mode" value="${data.shipping?.transportMode || ''}" placeholder="Например: 31">
                    </div>
                    <div></div>
                </div>

                <div class="preview-row" style="grid-template-columns: 1fr 120px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px;">
                    <div>
                        <label class="preview-label">Осн. транспортный док. (09011 / Реестр)</label>
                        <input type="text" class="preview-input" id="prev-registry-num" value="${data.registry?.number || ''}" placeholder="Номер">
                    </div>
                    <div>
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
        section.style.animation = 'fadeIn 0.3s ease-out 0.2s forwards';
        section.style.opacity = '0';
        section.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <h3 style="margin: 0;">Контрагенты</h3>
                <div style="display: flex; gap: 8px;">
                    ${getConfidenceHTML(conf.consignor)}
                    ${getConfidenceHTML(conf.consignee)}
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
                div.style.marginBottom = '16px';
                const warningClass = (conf[agent.id] < 0.6) ? 'input-warning' : '';
                div.innerHTML = `
                    <label class="preview-label">${agent.label}</label>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <input type="text" class="preview-input ${warningClass}" id="prev-agent-bin-${agent.id}" 
                                value="${bin}" data-validate="bin"
                                placeholder="БИН/ИИН" style="flex: 0 0 140px;">
                            <input type="text" class="preview-input ${warningClass}" id="prev-agent-name-${agent.id}" 
                                value="${name}" 
                                placeholder="Наименование" style="flex: 1;">
                        </div>
                        <input type="text" class="preview-input ${warningClass}" id="prev-agent-address-${agent.id}" 
                            value="${address}" 
                            placeholder="Адрес (из СМР/Инвойса)" style="font-size: 12px; color: #cbd5e1;">
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
                                <input type="text" class="preview-input" id="prev-agent-cert-date" value="${cert.docDate || ''}" data-validate="date" placeholder="Дата" style="flex: 1;">
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
        section.style.animation = 'fadeIn 0.3s ease-out 0.25s forwards';
        section.style.opacity = '0';
        const dWarning = ((conf.driver || 1.0) < 0.6) ? 'input-warning' : '';
        section.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <h3 style="margin: 0;">Водитель</h3>
                ${getConfidenceHTML(conf.driver || 1.0)}
            </div>
            <div class="row" style="margin-bottom: 4px;">
                <div style="flex: 1;">
                    <label style="font-size: 10px; color: #64748b;">ИИН Водителя</label>
                    <input type="text" class="preview-input ${dWarning}" id="prev-driver-iin" value="${data.driver.iin || ''}" data-validate="bin" placeholder="ИИН">
                </div>
            </div>
            <div class="row" style="gap: 4px;">
                <div style="flex: 1;">
                    <label style="font-size: 10px; color: #64748b;">Фамилия</label>
                    <input type="text" class="preview-input ${dWarning}" id="prev-driver-lastName" value="${data.driver.lastName || ''}" placeholder="Фамилия">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 10px; color: #64748b;">Имя</label>
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
        section.style.animation = 'fadeIn 0.3s ease-out 0.3s forwards';
        section.style.opacity = '0';
        section.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <h3 style="margin: 0;">Товары</h3>
                ${getConfidenceHTML(conf.products)}
            </div>
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

    initInlineValidation();
}

function renderValidationSummary(validation) {
    const summaryEl = document.getElementById('validationSummary');
    if (!summaryEl) return;

    summaryEl.style.marginBottom = '24px';
    summaryEl.innerHTML = `<h3 style="margin: 0 0 16px 0; font-size: 16px; display: flex; align-items: center; gap: 10px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        Отчет о кросс-валидации
    </h3>`;

    if (validation.errors.length === 0 && validation.warnings.length === 0) {
        summaryEl.innerHTML += `
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 14px 18px; color: #34d399; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 18px;">✅</span>
                Данные во всех документах совпадают. Противоречий не обнаружено.
            </div>
        `;
        return;
    }

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';

    validation.errors.forEach(err => {
        const div = document.createElement('div');
        div.style.background = 'rgba(239, 68, 68, 0.08)';
        div.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        div.style.borderRadius = '12px';
        div.style.padding = '12px 16px';
        div.style.color = '#f87171';
        div.style.fontSize = '13px';
        div.innerHTML = `<span style="margin-right:8px;">❌</span> <strong>Ошибка:</strong> ${err.message}`;
        list.appendChild(div);
    });

    validation.warnings.forEach(warn => {
        const div = document.createElement('div');
        const isSuccess = warn.severity === 'SUCCESS';

        div.style.background = isSuccess ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)';
        div.style.border = isSuccess ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(245, 158, 11, 0.2)';
        div.style.borderRadius = '12px';
        div.style.padding = '12px 16px';
        div.style.color = isSuccess ? '#34d399' : '#fbbf24';
        div.style.fontSize = '13px';

        const icon = isSuccess ? '' : '<span style="margin-right:8px;">⚠️</span> ';
        const label = isSuccess ? '' : '<strong>Внимание:</strong> ';

        div.innerHTML = `${icon}${label}${warn.message}`;
        list.appendChild(div);
    });

    summaryEl.appendChild(list);
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

// --- Tab Switching Logic ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

            // Add active class to clicked tab
            tab.classList.add('active');
            // Show corresponding content
            const tabId = tab.getAttribute('data-tab');
            const targetContent = document.getElementById(tabId);
            if (targetContent) {
                targetContent.style.display = 'block';
                targetContent.style.animation = 'fadeIn 0.3s ease-out';

                // If switching to history tab, refresh list
                if (tabId === 'historyTab') {
                    renderHistory();
                }
            }
        });
    });

    // --- Clear History ---
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Вы уверены, что хотите очистить всю историю?')) {
                chrome.storage.local.set({ history: [] }, () => {
                    renderHistory();
                });
            }
        });
    }

    // --- Reset Functionality ---
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetApp);
    }
});

function resetApp() {
    window.appExtensionFiles = [];
    currentAIData = null;
    renderFileList();

    const container = document.getElementById('mainContainer');
    if (container) container.classList.remove('expanded');

    const previewContent = document.getElementById('previewContent');
    if (previewContent) updatePreviewPlaceholder();

    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) {
        statusMsg.innerText = '';
        statusMsg.style.display = 'none';
    }

    // Reset layout for popup mode
    if (window.innerWidth <= 860) {
        document.body.style.width = '380px';
    }
    updateStepper(1); // Reset Stepper to Step 1
}

// Visual feedback for online status
function updateOnlineStatus() {
    const dot = document.getElementById('onlineDot');
    if (dot) {
        const isOnline = navigator.onLine;
        dot.style.background = isOnline ? '#34C759' : '#FF3B30';
        dot.style.boxShadow = isOnline ? '0 0 12px #34C759' : '0 0 12px #FF3B30';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();


function renderHistory() {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    chrome.storage.local.get(['history'], (data) => {
        const history = data.history || [];
        if (history.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.3;">📂</div>
                    <div style="font-size: 13px;">История пока пуста</div>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        history.forEach((item, index) => {
            const date = new Date(item.timestamp).toLocaleString('ru-RU', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            });

            const tractor = item.result?.mergedData?.vehicles?.tractorRegNumber || '';
            const trailer = item.result?.mergedData?.vehicles?.trailerRegNumber || '';
            const vehicleText = tractor ? `${tractor}${trailer ? ' / ' + trailer : ''}` : (item.files[0] || 'Анализ');
            const filesText = item.files.join(', ');

            const card = document.createElement('div');
            card.className = 'history-item';
            card.innerHTML = `
                <div class="history-item-header">
                    <div style="display: flex; align-items: center;">
                        <div class="history-item-date">${date}</div>
                        <button class="history-delete-btn" title="Удалить">🗑️</button>
                    </div>
                    <div class="history-item-duration">${item.duration || ''}</div>
                </div>
                <div class="history-item-files" style="font-size: 15px; color: #fff; margin-bottom: 4px;" title="${filesText}">
                    ${tractor ? '🚚 ' : ''}${vehicleText}
                </div>
                <div class="history-item-meta">
                    ${item.files.length} док. • ${item.result?.mergedData?.products?.length || 0} позиций
                </div>
            `;

            const deleteBtn = card.querySelector('.history-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('Удалить эту запись?')) {
                        const newHistory = [...history];
                        newHistory.splice(index, 1);
                        chrome.storage.local.set({ history: newHistory }, () => {
                            renderHistory();
                        });
                    }
                });
            }

            card.addEventListener('click', () => {
                // Switch to uploadTab (where preview is)
                document.querySelector('.tab[data-tab="uploadTab"]').click();

                // Load result into preview
                currentAIData = item.result;
                renderPreview(item.result);

                // Expand container if not already
                const mainContainer = document.getElementById('mainContainer');
                if (mainContainer) mainContainer.classList.add('expanded');

                setStatus(`Загружено из истории (${date})`);
            });

            container.appendChild(card);
        });
    });
}
